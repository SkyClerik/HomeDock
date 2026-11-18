import json
import os
import re
import shutil
import subprocess
import zipfile


def parse_version(ver_str: str) -> tuple:
    """Преобразует строку версии ('v2.1.0' или '2.1') в кортеж чисел (2, 1, 0) для сравнения."""
    numbers = re.findall(r'\d+', str(ver_str))
    return tuple(int(n) for n in numbers) if numbers else (0, 0, 0)


def find_project_installations(search_root: str) -> list:
    """Ищет все папки, где одновременно лежат index.html и server.py (до 2 уровней вглубь)."""
    found = []
    for root, dirs, files in os.walk(search_root):
        # Вычисляем глубину вложенности относительно search_root
        rel_path = os.path.relpath(root, search_root)
        depth = 0 if rel_path == '.' else rel_path.count(os.sep) + 1
        if depth > 2:
            dirs[:] = []  # Глубже 2 уровней не идем
            continue

        # Игнорируем системные и уже собранные папки
        dirs[:] = [d for d in dirs if not d.startswith('.') and not d.startswith('HomeDock_Updated')]

        if 'index.html' in files and 'server.py' in files:
            manifest_path = os.path.join(root, 'manifest.json')
            ver_str = '0.0.0'
            proj_name = 'Home DOCK'

            if os.path.isfile(manifest_path):
                try:
                    with open(manifest_path, 'r', encoding='utf-8') as f:
                        mdata = json.load(f)
                        ver_str = mdata.get('version', '0.0.0')
                        proj_name = mdata.get('name', proj_name)
                except Exception:
                    pass

            found.append({
                'path': root,
                'version_str': ver_str,
                'version_tuple': parse_version(ver_str),
                'name': proj_name
            })
            dirs[:] = []  # Внутрь найденного корня проекта больше не спускаемся

    return found


def build_template_index(templates_dir: str) -> dict:
    """Связывает ID шаблона из manifest.json с путем к его архиву в templates/."""
    index = {}
    if not os.path.isdir(templates_dir):
        return index

    for fname in os.listdir(templates_dir):
        fpath = os.path.join(templates_dir, fname)
        if not os.path.isfile(fpath):
            continue

        ext = os.path.splitext(fname)[1].lower()
        if ext == '.zip':
            try:
                with zipfile.ZipFile(fpath, 'r') as zf:
                    mfile = next((n for n in zf.namelist() if n.endswith('manifest.json')), None)
                    if mfile:
                        mdata = json.loads(zf.read(mfile).decode('utf-8'))
                        if mdata.get('id'):
                            index[mdata['id']] = fpath
            except Exception as e:
                print(f"  [Предупреждение] Ошибка чтения {fname}: {e}")

        elif ext == '.rar':
            try:
                for cmd in (['unrar', 'p', '-inul', fpath, 'manifest.json'], ['rar', 'p', '-inul', fpath, 'manifest.json']):
                    res = subprocess.run(cmd, capture_output=True)
                    if res.returncode == 0 and res.stdout:
                        mdata = json.loads(res.stdout.decode('utf-8'))
                        if mdata.get('id'):
                            index[mdata['id']] = fpath
                        break
            except Exception:
                pass

    return index


def extract_archive(archive_path: str, target_dir: str):
    """Распаковывает .zip или .rar архив шаблона в папку вкладки."""
    ext = os.path.splitext(archive_path)[1].lower()
    if ext == '.zip':
        with zipfile.ZipFile(archive_path, 'r') as zf:
            zf.extractall(target_dir)
    elif ext == '.rar':
        for cmd in (['unrar', 'x', '-y', archive_path, target_dir + os.sep], ['rar', 'x', '-y', archive_path, target_dir + os.sep]):
            res = subprocess.run(cmd, capture_output=True)
            if res.returncode == 0:
                return
        raise RuntimeError(f"Для распаковки {archive_path} нужен WinRAR/UnRAR в PATH.")


def read_tab_title(tab_html_path: str) -> str:
    """Читает пользовательское название вкладки из <meta name="tab-title">."""
    if not os.path.isfile(tab_html_path):
        return ''
    with open(tab_html_path, 'r', encoding='utf-8') as f:
        match = re.search(r'<meta\s+name=["\']tab-title["\']\s+content=["\'](.*?)["\']', f.read(), re.IGNORECASE)
        return match.group(1) if match else ''


def write_tab_title(tab_html_path: str, title: str):
    """Записывает сохраненное пользовательское название в новый tab.html."""
    if not title or not os.path.isfile(tab_html_path):
        return
    with open(tab_html_path, 'r', encoding='utf-8') as f:
        html = f.read()

    safe_title = title.replace('"', '&quot;')
    pattern = re.compile(r'(<meta\s+name=["\']tab-title["\']\s+content=["\'])(.*?)(["\'])', re.IGNORECASE)
    if pattern.search(html):
        html = pattern.sub(rf'\g<1>{safe_title}\g<3>', html, count=1)
    else:
        html = f'<meta name="tab-title" content="{safe_title}">\n' + html

    with open(tab_html_path, 'w', encoding='utf-8') as f:
        f.write(html)


def copy_user_files(old_tab_dir: str, new_tab_dir: str):
    """Копирует из старой вкладки data.json, images/, wallpapers/ и всё, кроме файлов движка."""
    engine_files = {'tab.html', 'tab.js', 'tab.css', 'manifest.json'}

    for item in os.listdir(old_tab_dir):
        if item.lower() in engine_files:
            continue

        src_item = os.path.join(old_tab_dir, item)
        dst_item = os.path.join(new_tab_dir, item)

        if os.path.isdir(src_item):
            shutil.copytree(src_item, dst_item, dirs_exist_ok=True)
        elif os.path.isfile(src_item):
            shutil.copy2(src_item, dst_item)


def run_update():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(base_dir)

    print("=== Автоматическое обновление Home DOCK ===\n")

    # 1. Ищем папки с index.html и server.py
    installations = find_project_installations(base_dir)
    if len(installations) < 2:
        print(f"[Ошибка] Найдено папок проекта: {len(installations)}. Нужно ровно 2 (старая и новая версии) рядом со скриптом!")
        for inst in installations:
            print(f"  - Найдено: {inst['path']} (версия: {inst['version_str']})")
        return

    if len(installations) > 2:
        print("[Ошибка] Найдено больше 2 папок с проектом. Оставьте рядом только старую и новую версии:")
        for inst in installations:
            print(f"  - {inst['path']} (версия: {inst['version_str']})")
        return

    # Сортируем по версии: меньшая — старая, большая — новая
    installations.sort(key=lambda x: x['version_tuple'])
    old_proj, new_proj = installations[0], installations[1]

    if old_proj['version_tuple'] == new_proj['version_tuple']:
        print(f"[Внимание] Обе найденные папки имеют одинаковую версию ({old_proj['version_str']}). Обновление отменено.")
        return

    print(f"Старая версия ({old_proj['version_str']}): {old_proj['path']}")
    print(f"Новая версия  ({new_proj['version_str']}): {new_proj['path']}\n")

    # 2. Создаем третью папку и клонируем туда новую версию
    clean_ver = re.sub(r'[^0-9a-zA-Z._-]', '', new_proj['version_str'])
    result_dir = os.path.join(base_dir, f"HomeDock_Updated_v{clean_ver}")

    if os.path.exists(result_dir):
        shutil.rmtree(result_dir)
    shutil.copytree(new_proj['path'], result_dir)
    print(f"[1/4] Новая основа склонирована в: {result_dir}")

    # 3. Переносим общие настройки settings.json и папку bats/
    old_settings = os.path.join(old_proj['path'], 'settings.json')
    if os.path.isfile(old_settings):
        shutil.copy2(old_settings, os.path.join(result_dir, 'settings.json'))

    old_bats = os.path.join(old_proj['path'], 'bats')
    if os.path.isdir(old_bats):
        shutil.copytree(old_bats, os.path.join(result_dir, 'bats'), dirs_exist_ok=True)
    print("[2/4] Общие настройки (settings.json) и скрипты (bats/) перенесены.")

    # 4. Индексируем шаблоны новой версии и пересобираем вкладки пользователя
    templates_index = build_template_index(os.path.join(result_dir, 'templates'))
    print(f"[3/4] Доступные шаблоны в новой версии: {list(templates_index.keys())}")

    old_tabs_dir = os.path.join(old_proj['path'], 'tabs')
    res_tabs_dir = os.path.join(result_dir, 'tabs')
    os.makedirs(res_tabs_dir, exist_ok=True)

    # 4. Индексируем шаблоны новой версии и пересобираем вкладки пользователя
    templates_index = build_template_index(os.path.join(result_dir, 'templates'))
    print(f"[3/4] Доступные шаблоны в новой версии: {list(templates_index.keys())}")

    old_tabs_dir = os.path.join(old_proj['path'], 'tabs')
    res_tabs_dir = os.path.join(result_dir, 'tabs')
    os.makedirs(res_tabs_dir, exist_ok=True)

    if os.path.isdir(old_tabs_dir):
        for folder in sorted(os.listdir(old_tabs_dir)):
            old_tab_path = os.path.join(old_tabs_dir, folder)
            if not os.path.isdir(old_tab_path):
                continue

            # Создаем папку с ТОЧНО ТАКИМ ЖЕ уникальным именем, как у пользователя
            new_tab_path = os.path.join(res_tabs_dir, folder)
            manifest_path = os.path.join(old_tab_path, 'manifest.json')
            tpl_id = None

            if os.path.isfile(manifest_path):
                try:
                    with open(manifest_path, 'r', encoding='utf-8') as f:
                        tpl_id = json.load(f).get('id')
                except Exception:
                    pass

            if tpl_id and tpl_id in templates_index:
                os.makedirs(new_tab_path, exist_ok=True)
                extract_archive(templates_index[tpl_id], new_tab_path)

                # Восстанавливаем <meta name="tab-title"> из старого tab.html
                old_title = read_tab_title(os.path.join(old_tab_path, 'tab.html'))
                write_tab_title(os.path.join(new_tab_path, 'tab.html'), old_title)

                # Копируем data.json, images/, wallpapers/ из старой папки в новую
                copy_user_files(old_tab_path, new_tab_path)
                print(f"  -> Вкладка '{folder}' («{old_title}») обновлена по шаблону '{tpl_id}'.")
            else:
                shutil.copytree(old_tab_path, new_tab_path, dirs_exist_ok=True)
                print(f"  -> Вкладка '{folder}' перенесена без изменений (шаблон не найден).")

    print(f"\n[4/4] Готово! Полностью рабочая обновленная версия находится в:\n{result_dir}")


if __name__ == '__main__':
    run_update()
    input("\nНажмите Enter для выхода...")
