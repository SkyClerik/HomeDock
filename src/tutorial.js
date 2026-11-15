document.addEventListener('DOMContentLoaded', async () => {
  const SETTINGS_FILE = 'settings.json';
  let settings = {};

  // 1. Читаем settings.json
  try {
    const res = await fetch(SETTINGS_FILE);
    if (res.ok) {
      settings = await res.json();
    }
  } catch (e) {
    // Если файла еще нет — считаем, что обучение не пройдено
  }

  // Если уже читали — просто выходим
  if (settings.tutorialRead === true) return;

  // 2. Создаем и показываем модальное окно с текстом
  const modal = document.createElement('div');
  modal.className = 'settings-modal-backdrop open';
  modal.innerHTML = `
    <div class="settings-modal" style="max-width: 540px;">
      <h3>👋 Добро пожаловать в Home Dock v2</h3>

      <div style="display: flex; flex-direction: column; gap: 10px; font-size: 13.5px; line-height: 1.5; color: #cbd5e1; margin: 14px 0;">
        <div><b>📑 Вкладки:</b> Переключайтесь в левом меню или создавайте новые из шаблонов через кнопку <b>📑</b> в шапке.</div>
        <div><b>🔍 Поиск:</b> Нажмите <b>Ctrl + K</b> для быстрого фильтра по названию, тегу или ссылке.</div>
        <div><b>🖼️ Обои:</b> Положите картинки в папку <code>wallpapers/</code> внутри любой вкладки — фон сменится сам.</div>
        <div><b>⚙️ Управление:</b> В правом верхнем углу находятся YouTube-помощник, настройки тем и перезапуск сервера.</div>
      </div>

      <div class="settings-footer">
        <button type="button" class="settings-save-btn" id="tut-close-btn" style="width: 100%; justify-content: center;">
          Понятно
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // 3. При закрытии записываем флаг в settings.json
  document.getElementById('tut-close-btn').addEventListener('click', async () => {
    modal.remove();
    try {
      // Перечитываем актуальный settings.json перед сохранением, чтобы не затереть настройки
      const res = await fetch(SETTINGS_FILE);
      const freshSettings = res.ok ? await res.json() : {};
      freshSettings.tutorialRead = true;

      if (typeof window.saveTabData === 'function') {
        await window.saveTabData(SETTINGS_FILE, freshSettings);
      }
    } catch (e) {
      // Игнорируем ошибку сети при закрытии
    }
  });
});
