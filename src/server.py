import http.server
import socketserver
import json
import subprocess
import webbrowser
import os
import re
import sys
import threading
import time
import urllib.parse
import mimetypes
import zipfile
import shutil

PORT = 8080
TABS_DIR = 'tabs'
TEMPLATES_DIR = 'templates'

class ReusableTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

def pick_dialog(mode='file', filetypes=None):
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    result = ''
    if mode == 'dir':
        result = filedialog.askdirectory(title='Выберите директорию')
    else:
        ft = filetypes or [('Все файлы', '*.*')]
        result = filedialog.askopenfilename(title='Выберите файл', filetypes=ft)
    root.destroy()
    return os.path.normpath(result) if result else ''

def cleanup_deleted_tabs(days_to_keep=7):
    trash_dir = os.path.join('backups', 'deleted_tabs')
    if not os.path.isdir(trash_dir):
        return
    now = time.time()
    cutoff = now - (days_to_keep * 86400)
    for folder_name in os.listdir(trash_dir):
        folder_path = os.path.join(trash_dir, folder_name)
        if os.path.isdir(folder_path) and os.path.getmtime(folder_path) < cutoff:
            try:
                shutil.rmtree(folder_path)
                print(f"[AutoClean] Удалена старая вкладка из корзины: {folder_name}")
            except Exception as e:
                print(f"[AutoClean] Ошибка удаления {folder_name}: {e}")

cleanup_deleted_tabs(days_to_keep=7)

class HomeDockHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def do_GET(self):
        from urllib import parse, request
        parsed = parse.urlparse(self.path)

        # 1. Сканирование вкладок
        if parsed.path == '/api/tabs':
            tabs_list = []
            if os.path.exists(TABS_DIR):
                for folder in sorted(os.listdir(TABS_DIR)):
                    folder_path = os.path.join(TABS_DIR, folder)
                    tab_file = os.path.join(folder_path, 'tab.html')
                    if os.path.isdir(folder_path) and os.path.exists(tab_file):
                        title = folder
                        try:
                            with open(tab_file, 'r', encoding='utf-8') as f:
                                head_chunk = f.read(1024)
                                match = re.search(
                                    r'<meta\s+name=["\']tab-title["\']\s+content=["\'](.*?)["\']',
                                    head_chunk,
                                    re.IGNORECASE
                                )
                                if match:
                                    title = match.group(1)
                        except Exception:
                            pass
                        tabs_list.append({
                            'id': folder,
                            'dir': f'{TABS_DIR}/{folder}',
                            'file': f'{TABS_DIR}/{folder}/tab.html',
                            'title': title
                        })
            self.send_json(tabs_list)

        # 2. Случайные обои из папки wallpapers/ конкретной вкладки
        elif parsed.path == '/api/tab-wallpaper':
            import random
            params = parse.parse_qs(parsed.query)
            dir_list = params.get('dir', [])
            tab_dir = dir_list.pop(0) if dir_list else ''
            norm_dir = os.path.normpath(tab_dir) if tab_dir else ''

            chosen_url = ''
            if norm_dir.startswith(TABS_DIR + os.sep):
                wp_dir = os.path.join(norm_dir, 'wallpapers')
                if os.path.isdir(wp_dir):
                    exts = ('.jpg', '.jpeg', '.png', '.webp', '.gif')
                    images = [f for f in os.listdir(wp_dir) if f.lower().endswith(exts)]
                    if images:
                        chosen_file = random.choice(images)
                        chosen_url = f"{tab_dir}/wallpapers/{parse.quote(chosen_file)}"

            self.send_json({'url': chosen_url})

        # 3. Прокси для получения YouTube oEmbed (обход CORS)
        elif parsed.path == '/api/yt-oembed':
            params = parse.parse_qs(parsed.query)
            url_list = params.get('url', [])
            watch_url = url_list.pop(0) if url_list else ''

            if not watch_url:
                self.send_json({'status': 'error', 'message': 'URL не передан'}, 400)
                return

            oembed_base = ''.join(['https://', 'www.', 'youtube', '.com/oembed?format=json&url='])
            api_url = oembed_base + parse.quote(watch_url, safe='')
            try:
                req = request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
                with request.urlopen(req, timeout=8) as resp:
                    raw = resp.read().decode('utf-8')
                    self.send_json({'status': 'ok', 'data': json.loads(raw)})
            except Exception as e:
                self.send_json({'status': 'error', 'message': str(e)})

        # 4. Список шаблонов вкладок из папки templates
        elif parsed.path == '/api/templates':
            templates = []
            if os.path.isdir(TEMPLATES_DIR):
                for fname in sorted(os.listdir(TEMPLATES_DIR)):
                    fpath = os.path.join(TEMPLATES_DIR, fname)
                    if not os.path.isfile(fpath):
                        continue
                    ext = os.path.splitext(fname)[1].lower()
                    if ext not in ('.zip', '.rar'):
                        continue

                    tpl_name = os.path.splitext(fname)[0]
                    tpl_desc = ''

                    if ext == '.zip':
                        try:
                            with zipfile.ZipFile(fpath, 'r') as zf:
                                manifest_file = next((n for n in zf.namelist() if n.endswith('manifest.json')), None)
                                if manifest_file:
                                    mdata = json.loads(zf.read(manifest_file).decode('utf-8'))
                                    tpl_name = mdata.get('name', tpl_name)
                                    tpl_desc = mdata.get('description', '')
                        except Exception:
                            pass
                    elif ext == '.rar':
                        # Читаем manifest.json через консольный WinRAR/UnRAR, если он установлен в системе
                        try:
                            for cmd in (['unrar', 'p', '-inul', fpath, 'manifest.json'], ['rar', 'p', '-inul', fpath, 'manifest.json']):
                                res = subprocess.run(cmd, capture_output=True)
                                if res.returncode == 0 and res.stdout:
                                    mdata = json.loads(res.stdout.decode('utf-8'))
                                    tpl_name = mdata.get('name', tpl_name)
                                    tpl_desc = mdata.get('description', '')
                                    break
                        except Exception:
                            pass

                    templates.append({
                        'file': fname,
                        'name': tpl_name,
                        'description': tpl_desc
                    })
            self.send_json(templates)

        # 5. Отдача локальной картинки с любого диска ПК
        elif parsed.path == '/api/local-image':
            params = parse.parse_qs(parsed.query)
            img_paths = params.get('path', [])
            img_path = img_paths.pop(0) if img_paths else ''
            if img_path and os.path.isfile(img_path):
                mime, _ = mimetypes.guess_type(img_path)
                self.send_response(200)
                self.send_header('Content-Type', mime or 'application/octet-stream')
                self.end_headers()
                with open(img_path, 'rb') as f:
                    self.wfile.write(f.read())
            else:
                self.send_error(404, 'Image not found')

        else:
            super().do_GET()

    def do_POST(self):
        from urllib import parse
        parsed_path = parse.urlparse(self.path).path
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length).decode('utf-8') if content_length else '{}'
        data = json.loads(post_data)

        # 0. Сохранение порядка вкладок (префиксы папок) и их названий в tab.html
        if parsed_path == '/api/save-tabs-order':
            tabs_payload = data.get('tabs', [])
            if not isinstance(tabs_payload, list) or not os.path.isdir(TABS_DIR):
                self.send_json({'status': 'error', 'message': 'Некорректные данные вкладок'}, 400)
                return

            try:
                # Шаг 1: Сначала переименовываем во временные имена, чтобы избежать коллизий
                temp_items = []
                for idx, item in enumerate(tabs_payload):
                    old_id = os.path.basename(item.get('id', '').strip())
                    new_title = item.get('title', '').strip()
                    old_path = os.path.join(TABS_DIR, old_id)
                    if not old_id or not os.path.isdir(old_path):
                        continue
                    tmp_id = f"__tmp_reorder_{idx}_{old_id}"
                    tmp_path = os.path.join(TABS_DIR, tmp_id)
                    os.rename(old_path, tmp_path)
                    temp_items.append((idx, old_id, tmp_path, new_title))

                # Шаг 2: Присваиваем новые числовые префиксы (10_, 11_, 12_...) и обновляем <meta name="tab-title">
                renamed_map = {}
                for idx, old_id, tmp_path, new_title in temp_items:
                    # Убираем старый числовой префикс вида "10_" или "01_"
                    base_slug = re.sub(r'^\d+_', '', old_id)
                    new_id = f"{10 + idx}_{base_slug}"
                    new_path = os.path.join(TABS_DIR, new_id)
                    os.rename(tmp_path, new_path)
                    renamed_map[old_id] = new_id

                    # Обновляем тег <meta name="tab-title" content="..."> в tab.html
                    tab_html_path = os.path.join(new_path, 'tab.html')
                    if new_title and os.path.isfile(tab_html_path):
                        with open(tab_html_path, 'r', encoding='utf-8') as f:
                            html_text = f.read()

                        safe_title = new_title.replace('"', '&quot;')
                        meta_pattern = re.compile(
                            r'(<meta\s+name=["\']tab-title["\']\s+content=["\'])(.*?)(["\'])',
                            re.IGNORECASE
                        )
                        if meta_pattern.search(html_text):
                            html_text = meta_pattern.sub(rf'\g<1>{safe_title}\g<3>', html_text, count=1)
                        else:
                            html_text = f'<meta name="tab-title" content="{safe_title}">\n' + html_text

                        with open(tab_html_path, 'w', encoding='utf-8') as f:
                            f.write(html_text)

                self.send_json({'status': 'ok', 'renamed': renamed_map})
            except Exception as e:
                self.send_json({'status': 'error', 'message': str(e)}, 500)
            return

        # 0.1. Удаление вкладки (в корзину backups/deleted_tabs или безвозвратно)
        elif parsed_path == '/api/delete-tab':
            tab_id = os.path.basename(data.get('id', '').strip())
            mode = data.get('mode', 'trash')  # 'trash' или 'permanent'
            target_path = os.path.join(TABS_DIR, tab_id)

            if not tab_id or not os.path.isdir(target_path):
                self.send_json({'status': 'error', 'message': 'Папка вкладки не найдена'}, 404)
                return

            try:
                if mode == 'permanent':
                    shutil.rmtree(target_path)
                    self.send_json({'status': 'ok', 'message': 'Вкладка удалена навсегда'})
                else:
                    trash_dir = os.path.join('backups', 'deleted_tabs')
                    os.makedirs(trash_dir, exist_ok=True)
                    timestamp = time.strftime('%Y%m%d_%H%M%S')
                    dest_path = os.path.join(trash_dir, f"{tab_id}__{timestamp}")
                    shutil.move(target_path, dest_path)
                    os.utime(dest_path, None)  # Ставит текущую дату и время отправки в корзину
                    self.send_json({'status': 'ok', 'message': f'Перемещено в {dest_path}'})
            except Exception as e:
                self.send_json({'status': 'error', 'message': str(e)}, 500)
            return

        # 1. Вызов системного окна выбора файла или папки
        elif self.path == '/api/pick-path':
            mode = data.get('mode', 'file')
            if mode == 'dir':
                chosen = pick_dialog('dir')
            elif mode == 'img':
                chosen = pick_dialog('file', [('Все файлы', '*.*'), ('Изображения', '*.png *.jpg *.jpeg *.webp *.gif *.ico *.svg')])
            elif mode == 'server':
                chosen = pick_dialog('file', [('Скрипты запуска сервера (*.bat, *.cmd, *.py)', '*.bat *.cmd *.py')])
            else:
                chosen = pick_dialog('file', [('Все файлы', '*.*')])
            self.send_json({'status': 'ok', 'path': chosen})

        # 2. Сохранение JSON-данных (вкладки или settings.json в корне)
        elif self.path == '/api/save-data':
            rel_path = data.get('path', '')
            payload = data.get('data', {})
            norm_path = os.path.normpath(rel_path)

            is_tab_json = norm_path.startswith(TABS_DIR + os.sep) and norm_path.endswith('.json')
            is_root_settings = (norm_path == 'settings.json')

            if not (is_tab_json or is_root_settings):
                self.send_json({'status': 'error', 'message': 'Недопустимый путь сохранения'}, 400)
                return

            try:
                parent_dir = os.path.dirname(norm_path)
                if parent_dir:
                    os.makedirs(parent_dir, exist_ok=True)
                with open(norm_path, 'w', encoding='utf-8') as f:
                    json.dump(payload, f, ensure_ascii=False, indent=2)
                self.send_json({'status': 'ok', 'message': 'Сохранено'})
            except Exception as e:
                self.send_json({'status': 'error', 'message': str(e)}, 500)

        # 3. Открытие директории в проводнике по умолчанию
        elif self.path == '/api/open-dir':
            dir_path = data.get('path', '').strip()
            if not dir_path:
                self.send_json({'status': 'error', 'message': 'Путь к директории не указан в карточке.'})
                return
            if not os.path.isdir(dir_path):
                self.send_json({'status': 'error', 'message': f'Указанная директория не найдена на диске:\n{dir_path}'})
                return
            try:
                os.startfile(os.path.normpath(dir_path))
                self.send_json({'status': 'ok', 'message': 'Папка открыта'})
            except Exception as e:
                self.send_json({'status': 'error', 'message': f'Не удалось открыть папку: {e}'})

        # 4. Запуск файла на ПК
        elif self.path == '/api/run':
            app_path = data.get('path', '').strip()
            dir_path = data.get('dir', '').strip()
            app_args = data.get('args', '').strip()

            if not app_path:
                self.send_json({'status': 'error', 'message': 'Путь до файла запуска не указан в карточке.'})
                return
            if not os.path.isfile(app_path):
                self.send_json({'status': 'error', 'message': f'Файл запуска не найден на диске:\n{app_path}'})
                return
            if dir_path and not os.path.isdir(dir_path):
                self.send_json({'status': 'error', 'message': f'Указанная рабочая директория не найдена:\n{dir_path}'})
                return

            try:
                work_dir = dir_path if dir_path else os.path.dirname(app_path)
                ext = os.path.splitext(app_path)[1].lower()

                # Проверяем наличие нашего спец-ключа --hidden в аргументах
                is_hidden = '--hidden' in app_args
                clean_args = app_args.replace('--hidden', '').strip()

                if ext in ('.bat', '.cmd'):
                    if is_hidden:
                        # Тихий запуск в фоне без окна
                        cmd = f'"{app_path}" {clean_args}'.strip()
                        subprocess.Popen(
                            cmd,
                            shell=True,
                            cwd=work_dir,
                            creationflags=subprocess.CREATE_NO_WINDOW
                        )
                    else:
                        # По умолчанию: видимое отдельное окно консоли (cmd /k оставит окно открытым даже после ошибки)
                        cmd = f'start "" cmd /c ""{app_path}" {clean_args}"'
                        subprocess.Popen(cmd, shell=True, cwd=work_dir)
                else:
                    # Обычные программы (.exe, .ahk и т.д.)
                    cmd = f'"{app_path}" {clean_args}'.strip()
                    flags = subprocess.CREATE_NO_WINDOW if is_hidden else 0
                    subprocess.Popen(cmd, shell=True, cwd=work_dir, creationflags=flags)

                self.send_json({'status': 'ok', 'message': 'Запущено'})
            except Exception as e:
                self.send_json({'status': 'error', 'message': f'Ошибка запуска: {e}'})


        # 5. Создание новой вкладки из шаблона
        elif self.path == '/api/create-tab':
            tpl_file = data.get('template', '').strip()
            custom_title = data.get('title', '').strip()
            folder_name = data.get('folder', '').strip()

            archive_path = os.path.join(TEMPLATES_DIR, os.path.basename(tpl_file))
            if not tpl_file or not os.path.isfile(archive_path):
                self.send_json({'status': 'error', 'message': 'Файл шаблона не найден'}, 400)
                return

            # Если имя папки не ввели — генерируем автоматически (например, 30_tab_1731350000)
            if not folder_name:
                folder_name = f"tab_{int(time.time())}"
            # Убираем запрещенные символы из имени папки
            folder_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', folder_name)
            target_dir = os.path.join(TABS_DIR, folder_name)

            if os.path.exists(target_dir):
                self.send_json({'status': 'error', 'message': f'Папка "{folder_name}" уже существует!'}, 400)
                return

            try:
                os.makedirs(target_dir, exist_ok=True)
                ext = os.path.splitext(archive_path)[1].lower()
                if ext == '.zip':
                    with zipfile.ZipFile(archive_path, 'r') as zf:
                        zf.extractall(target_dir)
                elif ext == '.rar':
                    extracted = False
                    for cmd in (['unrar', 'x', '-y', archive_path, target_dir + os.sep], ['rar', 'x', '-y', archive_path, target_dir + os.sep]):
                        res = subprocess.run(cmd, capture_output=True)
                        if res.returncode == 0:
                            extracted = True
                            break
                    if not extracted:
                        raise RuntimeError('Для распаковки .rar нужен WinRAR/UnRAR в PATH. Используйте .zip.')

                # Удаляем manifest.json из рабочей папки вкладки, чтобы не мешался
                manifest_in_tab = os.path.join(target_dir, 'manifest.json')
                if os.path.exists(manifest_in_tab):
                    os.remove(manifest_in_tab)

                # Если указали новое название вкладки — обновляем <meta name="tab-title"> в tab.html
                tab_html_path = os.path.join(target_dir, 'tab.html')
                if custom_title and os.path.isfile(tab_html_path):
                    with open(tab_html_path, 'r', encoding='utf-8') as f:
                        html = f.read()
                    html = re.sub(
                        r'(<meta\s+name=["\']tab-title["\']\s+content=["\'])(.*?)(["\'])',
                        rf'\g<1>{custom_title}\g<3>',
                        html,
                        count=1,
                        flags=re.IGNORECASE
                    )
                    with open(tab_html_path, 'w', encoding='utf-8') as f:
                        f.write(html)

                self.send_json({'status': 'ok', 'folder': folder_name})
            except Exception as e:
                self.send_json({'status': 'error', 'message': str(e)}, 500)

        # 6. Выключение / перезагрузка сервера
        elif self.path == '/api/shutdown':
            self.send_json({'status': 'ok'})
            threading.Thread(target=lambda: (time.sleep(0.3), os._exit(0)), daemon=True).start()

        elif self.path == '/api/restart':
            self.send_json({'status': 'ok'})
            threading.Thread(target=lambda: (time.sleep(0.3), os.execv(sys.executable, ['python'] + sys.argv)), daemon=True).start()

        else:
            self.send_error(404)

def run_daily_backup():
    import shutil
    from datetime import date

    backup_dir = 'backups'
    marker_file = os.path.join(backup_dir, '.last_backup')
    today_str = date.today().isoformat()  # Например: '2026-11-11'

    # 1. Проверяем, делался ли бэкап сегодня
    if os.path.isfile(marker_file):
        try:
            with open(marker_file, 'r', encoding='utf-8') as f:
                if f.read().strip() == today_str:
                    return  # Сегодня уже делали, выходим
        except Exception:
            pass

    # 2. Чистим папку с резервными копиями и создаем заново
    if os.path.exists(backup_dir):
        shutil.rmtree(backup_dir, ignore_errors=True)
    os.makedirs(backup_dir, exist_ok=True)

    # 3. Собираем data.json из всех папок в tabs/
    copied_count = 0
    if os.path.isdir(TABS_DIR):
        for folder in sorted(os.listdir(TABS_DIR)):
            src_json = os.path.join(TABS_DIR, folder, 'data.json')
            if os.path.isfile(src_json):
                dst_json = os.path.join(backup_dir, f'{folder}__data.json')
                shutil.copy2(src_json, dst_json)
                copied_count += 1

    # На всякий случай сохраняем и settings.json, если он есть
    if os.path.isfile('settings.json'):
        shutil.copy2('settings.json', os.path.join(backup_dir, 'settings.json'))

    # 4. Записываем сегодняшнюю дату в метку
    with open(marker_file, 'w', encoding='utf-8') as f:
        f.write(today_str)

    print(f"[Backup] Резервная копия за {today_str} создана ({copied_count} вкладок).")


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(TABS_DIR, exist_ok=True)
    os.makedirs(TEMPLATES_DIR, exist_ok=True)
    run_daily_backup()
    with ReusableTCPServer(("127.0.0.1", PORT), HomeDockHandler) as httpd:
        url = f"http://127.0.0.1:{PORT}/index.html"
        print(f"SkyClerik Home DOCK v2 запущен: {url}")
        if '--restarted' not in sys.argv:
            sys.argv.append('--restarted')
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nСервер остановлен.")
