# =============================================================================
# ИМПОРТЫ СТАНДАРТНОЙ БИБЛИОТЕКИ
# =============================================================================

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
import mimetypes
import zipfile
import shutil
import random
from urllib import parse
from datetime import date

# =============================================================================
# МОДУЛИ ПРОЕКТА
# =============================================================================

import config

# =============================================================================
# СИСТЕМНЫЕ УТИЛИТЫ И НАСТРОЙКА СЕРВЕРА
# =============================================================================

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

# =============================================================================
# ОБРАБОТЧИК HTTP-ЗАПРОСОВ (API И СТАТИКА)
# =============================================================================

class HomeDockHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    # =========================================================================
    # МАРШРУТИЗАТОРЫ (do_GET)
    # =========================================================================

    def do_GET(self):
        parsed = parse.urlparse(self.path)

        # 1. Сканирование вкладок
        if parsed.path == '/api/tabs':
            tabs_list = self._get_tabs()
            self.send_json(tabs_list) # Отправляем полученный результат клиенту

        # 2. Случайные обои из папки wallpapers/ конкретной вкладки
        elif parsed.path == '/api/tab-wallpaper':
            wallpaper_data = self._get_tab_wallpaper(parsed.query)
            self.send_json(wallpaper_data)

        # 3. Прокси для получения YouTube oEmbed (обход CORS)
        elif parsed.path == '/api/yt-oembed':
            data, status = self._get_yt_oembed(parsed.query)
            self.send_json(data, status)

        # 4. Список шаблонов вкладок из папки templates
        elif parsed.path == '/api/templates':
            templates = self._get_templates()
            self.send_json(templates)


        # 5. Отдача локальной картинки с любого диска ПК
        elif parsed.path == '/api/local-image':
            self._serve_local_image(parsed.query)

        # 6. Метаданные приложения из config.py
        elif parsed.path == '/api/app-info':
            self.send_json(self._get_app_info())

        # 7. Стандартная раздача статических файлов (HTML, CSS, JS)
        else:
            super().do_GET()

    # 1. Сканирование вкладок
    def _get_tabs(self):
        tabs_list = []
        if os.path.exists(config.TABS_DIR):
            for folder in sorted(os.listdir(config.TABS_DIR)):
                folder_path = os.path.join(config.TABS_DIR, folder)
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
                        'dir': f'{config.TABS_DIR}/{folder}',
                        'file': f'{config.TABS_DIR}/{folder}/tab.html',
                        'title': title
                    })

        # Обязательно возвращаем собранный список наружу (в место вызова)
        return tabs_list

    # 2. Случайные обои из папки wallpapers/ конкретной вкладки
    def _get_tab_wallpaper(self, query):
        params = parse.parse_qs(query)
        dir_list = params.get('dir', [])
        tab_dir = dir_list.pop(0) if dir_list else ''
        norm_dir = os.path.normpath(tab_dir) if tab_dir else ''

        chosen_url = ''
        if norm_dir.startswith(config.TABS_DIR + os.sep):
            wp_dir = os.path.join(norm_dir, 'wallpapers')
            if os.path.isdir(wp_dir):
                exts = ('.jpg', '.jpeg', '.png', '.webp', '.gif')
                images = [f for f in os.listdir(wp_dir) if f.lower().endswith(exts)]
                if images:
                    chosen_file = random.choice(images)
                    chosen_url = f"{tab_dir}/wallpapers/{parse.quote(chosen_file)}"

        return {'url': chosen_url}

    # 3. Прокси для получения YouTube oEmbed (обход CORS)
    def _get_yt_oembed(self, query):
        params = parse.parse_qs(query)
        url_list = params.get('url', [])
        watch_url = url_list.pop(0) if url_list else ''

        if not watch_url:
            return {'status': 'error', 'message': 'URL не передан'}, 400

        oembed_base = ''.join(['https://', 'www.', 'youtube', '.com/oembed?format=json&url='])
        api_url = oembed_base + parse.quote(watch_url, safe='')
        try:
            req = request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
            with request.urlopen(req, timeout=8) as resp:
                raw = resp.read().decode('utf-8')
                return {'status': 'ok', 'data': json.loads(raw)}, 200
        except Exception as e:
            return {'status': 'error', 'message': str(e)}, 200

    # 4. Список шаблонов вкладок из папки templates
    def _get_templates(self):
        templates = []
        if not os.path.isdir(config.TEMPLATES_DIR):
            return templates

        for fname in sorted(os.listdir(config.TEMPLATES_DIR)):
            fpath = os.path.join(config.TEMPLATES_DIR, fname)
            if not os.path.isfile(fpath):
                continue

            ext = os.path.splitext(fname)[1].lower()
            if ext not in ('.zip', '.rar'):
                continue

            default_name = os.path.splitext(fname)[0]
            tpl_name, tpl_desc = self._read_template_manifest(fpath, ext, default_name)

            templates.append({
                'file': fname,
                'name': tpl_name,
                'description': tpl_desc
            })

        return templates

    def _read_template_manifest(self, fpath, ext, default_name):
        """Вспомогательный метод для чтения имени и описания из архива."""
        tpl_name = default_name
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

        return tpl_name, tpl_desc

    # 5. Отдача локальной картинки с любого диска ПК
    def _serve_local_image(self, query):
        params = parse.parse_qs(query)
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

    # 6. Метаданные приложения из config.py для фронтенда
    def _get_app_info(self):
        return {
            'author': config.APP_AUTHOR,
            'name': config.APP_NAME,
            'version': config.APP_VERSION,
            'full_title': config.APP_FULL_TITLE,
            'subtitles': config.SUBTITLES
        }

    # =========================================================================
    # МАРШРУТИЗАТОРЫ (do_POST)
    # =========================================================================

    def do_POST(self):
        parsed_path = parse.urlparse(self.path).path
        data = self._read_json_body()

        # POST-1. Сохранение порядка вкладок (префиксы папок) и их названий в tab.html
        if parsed_path == '/api/save-tabs-order':
            resp_data, status = self._save_tabs_order(data)
            self.send_json(resp_data, status)

        # POST-2. Удаление вкладки (в корзину backups/deleted_tabs или безвозвратно)
        elif parsed_path == '/api/delete-tab':
            resp_data, status = self._delete_tab(data)
            self.send_json(resp_data, status)

        # POST-3. Вызов системного окна выбора файла или папки
        elif parsed_path == '/api/pick-path':
            resp_data, status = self._pick_path(data)
            self.send_json(resp_data, status)

        # POST-4. Сохранение JSON-данных (вкладки или settings.json в корне)
        elif parsed_path == '/api/save-data':
            resp_data, status = self._save_data(data)
            self.send_json(resp_data, status)

        # POST-5. Открытие директории в проводнике по умолчанию
        elif parsed_path == '/api/open-dir':
            resp_data, status = self._open_dir(data)
            self.send_json(resp_data, status)

        # POST-6. Запуск файла на ПК
        elif parsed_path == '/api/run':
            resp_data, status = self._run_app(data)
            self.send_json(resp_data, status)

        # POST-7. Создание новой вкладки из шаблона
        elif parsed_path == '/api/create-tab':
            resp_data, status = self._create_tab(data)
            self.send_json(resp_data, status)

        # POST-8. Выключение сервера
        elif parsed_path == '/api/shutdown':
            resp_data, status = self._shutdown_server()
            self.send_json(resp_data, status)

        # POST-9. Перезагрузка сервера
        elif parsed_path == '/api/restart':
            resp_data, status = self._restart_server()
            self.send_json(resp_data, status)

        else:
            self.send_error(404)

    def _read_json_body(self) -> dict:
        """Читает и парсит JSON из тела POST-запроса."""
        content_length = int(self.headers.get('Content-Length', 0))
        if not content_length:
            return {}
        post_data = self.rfile.read(content_length).decode('utf-8')
        return json.loads(post_data)

    # POST-1. Сохранение порядка вкладок (префиксы папок) и их названий в tab.html
    def _save_tabs_order(self, data: dict):
        tabs_payload = data.get('tabs', [])
        if not isinstance(tabs_payload, list) or not os.path.isdir(config.TABS_DIR):
            return {'status': 'error', 'message': 'Некорректные данные вкладок'}, 400

        try:
            # Шаг 1: Сначала переименовываем во временные имена, чтобы избежать коллизий
            temp_items = []
            for idx, item in enumerate(tabs_payload):
                old_id = os.path.basename(item.get('id', '').strip())
                new_title = item.get('title', '').strip()
                old_path = os.path.join(config.TABS_DIR, old_id)
                if not old_id or not os.path.isdir(old_path):
                    continue
                tmp_id = f"__tmp_reorder_{idx}_{old_id}"
                tmp_path = os.path.join(config.TABS_DIR, tmp_id)
                os.rename(old_path, tmp_path)
                temp_items.append((idx, old_id, tmp_path, new_title))

            # Шаг 2: Присваиваем новые числовые префиксы (10_, 11_, 12_...) и обновляем <meta name="tab-title">
            renamed_map = {}
            for idx, old_id, tmp_path, new_title in temp_items:
                base_slug = re.sub(r'^\d+_', '', old_id)
                new_id = f"{10 + idx}_{base_slug}"
                new_path = os.path.join(config.TABS_DIR, new_id)
                os.rename(tmp_path, new_path)
                renamed_map[old_id] = new_id

                if new_title:
                    self._update_tab_meta_title(new_path, new_title)

            return {'status': 'ok', 'renamed': renamed_map}, 200
        except Exception as e:
            return {'status': 'error', 'message': str(e)}, 500

    def _update_tab_meta_title(self, tab_folder_path: str, new_title: str):
        """Вспомогательный метод для обновления <meta name="tab-title"> в tab.html."""
        tab_html_path = os.path.join(tab_folder_path, 'tab.html')
        if not os.path.isfile(tab_html_path):
            return

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

    # POST-2. Удаление вкладки (в корзину backups/deleted_tabs или безвозвратно)
    def _delete_tab(self, data: dict):
        tab_id = os.path.basename(data.get('id', '').strip())
        mode = data.get('mode', 'trash')  # 'trash' или 'permanent'
        target_path = os.path.join(config.TABS_DIR, tab_id)

        if not tab_id or not os.path.isdir(target_path):
            return {'status': 'error', 'message': 'Папка вкладки не найдена'}, 404

        try:
            if mode == 'permanent':
                shutil.rmtree(target_path)
                return {'status': 'ok', 'message': 'Вкладка удалена навсегда'}, 200

            trash_dir = os.path.join('backups', 'deleted_tabs')
            os.makedirs(trash_dir, exist_ok=True)
            timestamp = time.strftime('%Y%m%d_%H%M%S')
            dest_path = os.path.join(trash_dir, f"{tab_id}__{timestamp}")
            shutil.move(target_path, dest_path)
            os.utime(dest_path, None)  # Ставит текущую дату и время отправки в корзину
            return {'status': 'ok', 'message': f'Перемещено в {dest_path}'}, 200
        except Exception as e:
            return {'status': 'error', 'message': str(e)}, 500

    # POST-3. Вызов системного окна выбора файла или папки
    def _pick_path(self, data: dict):
        mode = data.get('mode', 'file')
        if mode == 'dir':
            chosen = pick_dialog('dir')
        elif mode == 'img':
            chosen = pick_dialog('file', [('Все файлы', '*.*'), ('Изображения', '*.png *.jpg *.jpeg *.webp *.gif *.ico *.svg')])
        elif mode == 'server':
            chosen = pick_dialog('file', [('Скрипты запуска сервера (*.bat, *.cmd, *.py)', '*.bat *.cmd *.py')])
        else:
            chosen = pick_dialog('file', [('Все файлы', '*.*')])
        return {'status': 'ok', 'path': chosen}, 200

    # POST-4. Сохранение JSON-данных (вкладки или settings.json в корне)
    def _save_data(self, data: dict):
        rel_path = data.get('path', '')
        payload = data.get('data', {})
        norm_path = os.path.normpath(rel_path)

        is_tab_json = norm_path.startswith(config.TABS_DIR + os.sep) and norm_path.endswith('.json')
        is_root_settings = (norm_path == 'settings.json')

        if not (is_tab_json or is_root_settings):
            return {'status': 'error', 'message': 'Недопустимый путь сохранения'}, 400

        try:
            parent_dir = os.path.dirname(norm_path)
            if parent_dir:
                os.makedirs(parent_dir, exist_ok=True)
            with open(norm_path, 'w', encoding='utf-8') as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            return {'status': 'ok', 'message': 'Сохранено'}, 200
        except Exception as e:
            return {'status': 'error', 'message': str(e)}, 500

    # POST-5. Открытие директории в проводнике по умолчанию
    def _open_dir(self, data: dict):
        dir_path = data.get('path', '').strip()
        if not dir_path:
            return {'status': 'error', 'message': 'Путь к директории не указан в карточке.'}, 200
        if not os.path.isdir(dir_path):
            return {'status': 'error', 'message': f'Указанная директория не найдена на диске:\n{dir_path}'}, 200

        try:
            os.startfile(os.path.normpath(dir_path))
            return {'status': 'ok', 'message': 'Папка открыта'}, 200
        except Exception as e:
            return {'status': 'error', 'message': f'Не удалось открыть папку: {e}'}, 200

    # POST-6. Запуск файла на ПК
    def _run_app(self, data: dict):
        app_path = data.get('path', '').strip()
        dir_path = data.get('dir', '').strip()
        app_args = data.get('args', '').strip()

        if not app_path:
            return {'status': 'error', 'message': 'Путь до файла запуска не указан в карточке.'}, 200
        if not os.path.isfile(app_path):
            return {'status': 'error', 'message': f'Файл запуска не найден на диске:\n{app_path}'}, 200
        if dir_path and not os.path.isdir(dir_path):
            return {'status': 'error', 'message': f'Указанная рабочая директория не найдена:\n{dir_path}'}, 200

        try:
            work_dir = dir_path if dir_path else os.path.dirname(app_path)
            ext = os.path.splitext(app_path)[1].lower()

            # Проверяем наличие нашего спец-ключа --hidden в аргументах
            is_hidden = '--hidden' in app_args
            clean_args = app_args.replace('--hidden', '').strip()

            if ext in ('.bat', '.cmd'):
                if is_hidden:
                    cmd = f'"{app_path}" {clean_args}'.strip()
                    subprocess.Popen(
                        cmd,
                        shell=True,
                        cwd=work_dir,
                        creationflags=subprocess.CREATE_NO_WINDOW
                    )
                else:
                    cmd = f'start "" cmd /c ""{app_path}" {clean_args}"'
                    subprocess.Popen(cmd, shell=True, cwd=work_dir)
            else:
                cmd = f'"{app_path}" {clean_args}'.strip()
                flags = subprocess.CREATE_NO_WINDOW if is_hidden else 0
                subprocess.Popen(cmd, shell=True, cwd=work_dir, creationflags=flags)

            return {'status': 'ok', 'message': 'Запущено'}, 200
        except Exception as e:
            return {'status': 'error', 'message': f'Ошибка запуска: {e}'}, 200

    # POST-7. Создание новой вкладки из шаблона
    def _create_tab(self, data: dict):
        tpl_file = data.get('template', '').strip()
        custom_title = data.get('title', '').strip()
        folder_name = data.get('folder', '').strip()

        archive_path = os.path.join(config.TEMPLATES_DIR, os.path.basename(tpl_file))
        if not tpl_file or not os.path.isfile(archive_path):
            return {'status': 'error', 'message': 'Файл шаблона не найден'}, 400

        if not folder_name:
            folder_name = f"tab_{int(time.time())}"
        folder_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', folder_name)
        target_dir = os.path.join(config.TABS_DIR, folder_name)

        if os.path.exists(target_dir):
            return {'status': 'error', 'message': f'Папка "{folder_name}" уже существует!'}, 400

        try:
            os.makedirs(target_dir, exist_ok=True)
            self._extract_template_archive(archive_path, target_dir)

            # Удаляем manifest.json из рабочей папки вкладки, чтобы не мешался
            manifest_in_tab = os.path.join(target_dir, 'manifest.json')
            if os.path.exists(manifest_in_tab):
                os.remove(manifest_in_tab)

            # Переиспользуем уже созданный ранее помощник для обновления заголовка
            if custom_title:
                self._update_tab_meta_title(target_dir, custom_title)

            return {'status': 'ok', 'folder': folder_name}, 200
        except Exception as e:
            return {'status': 'error', 'message': str(e)}, 500

    def _extract_template_archive(self, archive_path: str, target_dir: str):
        """Вспомогательный метод для распаковки .zip или .rar шаблона."""
        ext = os.path.splitext(archive_path)[1].lower()
        if ext == '.zip':
            with zipfile.ZipFile(archive_path, 'r') as zf:
                zf.extractall(target_dir)
        elif ext == '.rar':
            for cmd in (['unrar', 'x', '-y', archive_path, target_dir + os.sep], ['rar', 'x', '-y', archive_path, target_dir + os.sep]):
                res = subprocess.run(cmd, capture_output=True)
                if res.returncode == 0:
                    return
            raise RuntimeError('Для распаковки .rar нужен WinRAR/UnRAR в PATH. Используйте .zip.')

    # POST-8. Выключение сервера
    def _shutdown_server(self):
        threading.Thread(target=lambda: (time.sleep(0.3), os._exit(0)), daemon=True).start()
        return {'status': 'ok'}, 200

    # POST-9. Перезагрузка сервера
    def _restart_server(self):
        threading.Thread(target=lambda: (time.sleep(0.3), os.execv(sys.executable, ['python'] + sys.argv)), daemon=True).start()
        return {'status': 'ok'}, 200

# =============================================================================
# РЕЗЕРВНОЕ КОПИРОВАНИЕ (ЕЖЕДНЕВНЫЙ БЭКАП)
# =============================================================================

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
    if os.path.isdir(config.TABS_DIR):
        for folder in sorted(os.listdir(config.TABS_DIR)):
            src_json = os.path.join(config.TABS_DIR, folder, 'data.json')
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

# =============================================================================
# ТОЧКА ВХОДА И ЗАПУСК СЕРВЕРА
# =============================================================================

if __name__ == '__main__':
    # 1. Подготовка рабочей директории и базовых папок
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(config.TABS_DIR, exist_ok=True)
    os.makedirs(config.TEMPLATES_DIR, exist_ok=True)

    # 2. Очистка старой корзины и создание ежедневного бэкапа
    cleanup_deleted_tabs(days_to_keep=7)
    run_daily_backup()

    # 3. Запуск локального HTTP-сервера...
    with ReusableTCPServer((config.HOST, config.PORT), HomeDockHandler) as httpd:
        url = f"http://{config.HOST}:{config.PORT}/index.html"
        print(f"{config.APP_FULL_TITLE} запущен: {url}")
        if '--restarted' not in sys.argv:
            sys.argv.append('--restarted')
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nСервер остановлен.")
