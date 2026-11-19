document.addEventListener('DOMContentLoaded', async () => {
  const SETTINGS_FILE = 'settings.json';
  const themeLink = document.getElementById('theme-link');
  const openBtn = document.getElementById('btn-open-settings');
  const statusText = document.getElementById('status-text');

  let currentSettings = {
    theme: 'styles-gx.css'
  };

  // Генерируем разметку модального окна настроек автоматически
  const modalBackdrop = document.createElement('div');
  modalBackdrop.className = 'settings-modal-backdrop';
  modalBackdrop.id = 'settings-modal';
  modalBackdrop.innerHTML = `
    <div class="settings-modal">
      <h3>⚙️ Настройки Home Dock</h3>

      <div class="settings-group">
        <label>Тема оформления</label>
        <select id="cfg-theme">
          <option value="styles-gx.css">Opera GX</option>
          <option value="styles-cp2077.css">CP 2077</option>
          <option value="styles-genshin.css">Genshin</option>
          <option value="styles-nier.css">Nier Automata</option>
          <option value="styles-ubuntu.css">Ubuntu</option>
        </select>
      </div>

      <div class="settings-footer">
        <button type="button" class="srv-btn" id="cfg-cancel">Отмена</button>
        <button type="button" class="settings-save-btn" id="cfg-save">💾 Сохранить</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalBackdrop);

  const themeSelect = document.getElementById('cfg-theme');

  // Загрузка настроек из settings.json
  async function loadSettings() {
    try {
      const res = await fetch(SETTINGS_FILE);
      if (res.ok) {
        const data = await res.json();
        currentSettings = { ...currentSettings, ...data };
      }
    } catch (e) {
      // Если файла еще нет — используем дефолтные значения
    }
    if (themeLink && currentSettings.theme) {
      themeLink.href = currentSettings.theme;
    }
    window.DOCK_SETTINGS = currentSettings;
  }

  await loadSettings();

  // Открытие окна настроек
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      themeSelect.value = currentSettings.theme || 'styles-gx.css';
      modalBackdrop.classList.add('open');
    });
  }

  // Предпросмотр темы сразу при смене в списке
  themeSelect.addEventListener('change', () => {
    if (themeLink) themeLink.href = themeSelect.value;
  });

  // Отмена (возвращаем старую тему, если меняли для предпросмотра)
  document.getElementById('cfg-cancel').addEventListener('click', () => {
    if (themeLink && currentSettings.theme) {
      themeLink.href = currentSettings.theme;
    }
    modalBackdrop.classList.remove('open');
  });

  // Сохранение в settings.json
  document.getElementById('cfg-save').addEventListener('click', async () => {
    // Сначала перечитываем актуальный файл, чтобы не потерять tutorialRead и другие поля
    try {
      const freshRes = await fetch(SETTINGS_FILE);
      if (freshRes.ok) {
        currentSettings = await freshRes.json();
      }
    } catch (e) {}

    currentSettings.theme = themeSelect.value;
    delete currentSettings.serverStartPath;

    const ok = await window.saveTabData(SETTINGS_FILE, currentSettings);
    if (ok) {
      window.DOCK_SETTINGS = currentSettings;
      if (statusText) statusText.textContent = 'Настройки сохранены в settings.json';
      modalBackdrop.classList.remove('open');
    }
  });
});
