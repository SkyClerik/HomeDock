document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('btn-open-tabSettings');
  if (!openBtn) return;

  // Создаём модальное окно по аналогии с settings.js
  const modalBackdrop = document.createElement('div');
  modalBackdrop.className = 'settings-modal-backdrop';
  modalBackdrop.id = 'tab-manager-modal';
  modalBackdrop.innerHTML = `
    <div class="settings-modal">
      <h3>📑 Управление вкладками</h3>

      <div class="settings-group">
        <label>Выберите шаблон из папки templates</label>
        <div id="tpl-list-box" style="display: flex; flex-direction: column; gap: 8px; max-height: 220px; overflow-y: auto; margin-top: 6px;">
          <div style="opacity: 0.6; font-size: 13px;">Загрузка шаблонов...</div>
        </div>
      </div>

      <div class="settings-group">
        <label>Название вкладки в меню (с иконкой)</label>
        <input type="text" id="new-tab-title" placeholder="Например: 🎮 Игры">
      </div>

      <div class="settings-group">
        <label>Имя папки в tabs/ (латиницей, необязательно)</label>
        <input type="text" id="new-tab-folder" placeholder="Например: 30_games (если пусто — создастся само)">
      </div>

      <div class="settings-footer">
        <button type="button" class="srv-btn" id="tpl-cancel">Отмена</button>
        <button type="button" class="settings-save-btn" id="tpl-create">➕ Создать вкладку</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalBackdrop);

  const listBox = document.getElementById('tpl-list-box');
  const titleInput = document.getElementById('new-tab-title');
  const folderInput = document.getElementById('new-tab-folder');
  const createBtn = document.getElementById('tpl-create');
  const cancelBtn = document.getElementById('tpl-cancel');

  let selectedTemplate = null;

  async function loadTemplates() {
    listBox.innerHTML = '<div style="opacity: 0.6; font-size: 13px;">Поиск архивов...</div>';
    selectedTemplate = null;
    try {
      const res = await fetch('/api/templates');
      const templates = await res.json();

      if (!templates || templates.length === 0) {
        listBox.innerHTML = '<div style="opacity: 0.6; font-size: 13px;">Положите .zip архивы с manifest.json в папку <b>Templates/</b></div>';
        return;
      }

      listBox.innerHTML = '';
      templates.forEach((tpl, idx) => {
        const item = document.createElement('label');
        item.style.cssText = 'display: flex; align-items: flex-start; gap: 10px; padding: 10px; border-radius: 8px; background: rgba(255,255,255,0.05); cursor: pointer; border: 1px solid rgba(255,255,255,0.08);';
        item.innerHTML = `
          <input type="radio" name="tpl-choice" value="${tpl.file}" ${idx === 0 ? 'checked' : ''} style="width: 16px; height: 16px; margin-top: 3px; flex-shrink: 0;">
          <div>
            <div style="font-weight: 600; font-size: 14px;">${tpl.name}</div>
            ${tpl.description ? `<div style="font-size: 12px; opacity: 0.7; margin-top: 2px;">${tpl.description}</div>` : ''}
            <div style="font-size: 11px; opacity: 0.45; margin-top: 2px;">Архив: ${tpl.file}</div>
          </div>
        `;

        const radio = item.querySelector('input');
        if (idx === 0) {
          selectedTemplate = tpl.file;
          titleInput.value = tpl.name;
        }

        radio.addEventListener('change', () => {
          selectedTemplate = tpl.file;
          titleInput.value = tpl.name;
        });

        listBox.appendChild(item);
      });
    } catch (e) {
      listBox.innerHTML = '<div style="color: #ff5555; font-size: 13px;">Ошибка загрузки списка шаблонов</div>';
    }
  }

  openBtn.addEventListener('click', () => {
    modalBackdrop.classList.add('open');
    loadTemplates();
  });

  cancelBtn.addEventListener('click', () => modalBackdrop.classList.remove('open'));
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) modalBackdrop.classList.remove('open');
  });

  createBtn.addEventListener('click', async () => {
    if (!selectedTemplate) {
      alert('Сначала выберите шаблон из списка!');
      return;
    }
    createBtn.disabled = true;
    createBtn.textContent = 'Создание...';
    try {
      const res = await fetch('/api/create-tab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: selectedTemplate,
          title: titleInput.value.trim(),
          folder: folderInput.value.trim()
        })
      });
      const result = await res.json();
      if (result.status === 'ok') {
        modalBackdrop.classList.remove('open');
        // Перезагружаем страницу, чтобы новая вкладка сразу появилась в левом меню
        location.reload();
      } else {
        alert('Ошибка: ' + result.message);
      }
    } catch (e) {
      alert('Нет связи с сервером');
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = '➕ Создать вкладку';
    }
  });
});
