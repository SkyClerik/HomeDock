const HELPER_DIR = 'helper/';

// Словарь эмоций/артов персонажа
const HELPER_ARTS = {
  default: 'https://raw.githubusercontent.com/SkyClerik/HomeDock/main/docs/default.webp',
  welcome: 'https://raw.githubusercontent.com/SkyClerik/HomeDock/main/docs/welcome.webp',
  update:  'https://raw.githubusercontent.com/SkyClerik/HomeDock/main/docs/update.webp', // заменишь на арт обновления
  error:   'https://raw.githubusercontent.com/SkyClerik/HomeDock/main/docs/error.webp'  // заменишь на злой/грустный арт
};

window.showHelper = async function (options = {}) {
  const {
    contentFile = 'welcome.html', // Имя файла внутри папки helper/
    title = '👋 Добро пожаловать в Home DOCK',
    mood = 'default',             // Эмоция из словаря HELPER_ARTS
    artUrl = null,                // Прямая ссылка (если нужно переопределить mood)
    buttonText = 'Понятно',
    onClose = null
  } = options;

  const cssPath = `${HELPER_DIR}tutorial.css`;
  const filePath = contentFile.startsWith(HELPER_DIR) ? contentFile : `${HELPER_DIR}${contentFile}`;
  const finalArt = artUrl || HELPER_ARTS[mood] || HELPER_ARTS.welcome;

  // Подключаем стили из папки helper/
  if (!document.querySelector(`link[href="${cssPath}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssPath;
    document.head.appendChild(link);
  }

  // Загружаем текст (поддерживает .html и .md)
  let bodyHtml = `<p>Файл <code>${filePath}</code> не найден.</p>`;
  try {
    const textRes = await fetch(filePath);
    if (textRes.ok) {
      const rawText = await textRes.text();
      if (filePath.endsWith('.md') && typeof marked !== 'undefined') {
        bodyHtml = marked.parse(rawText);
      } else {
        bodyHtml = rawText;
      }
    }
  } catch (e) {}

  const existing = document.getElementById('vn-helper-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'vn-helper-modal';
  modal.className = 'settings-modal-backdrop open';
  modal.innerHTML = `
    <div class="settings-modal vn-modal-box">
      <div class="vn-left-art">
        <img src="${finalArt}" alt="Character">
      </div>

      <div class="vn-right-dialog">
        <div class="vn-header">
          <h3>${title}</h3>
        </div>

        <div class="vn-scroll-text">
          ${bodyHtml}
        </div>

        <div class="vn-footer">
          <button type="button" class="settings-save-btn" id="tut-close-btn">
            ${buttonText}
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('tut-close-btn').addEventListener('click', async () => {
    modal.remove();
    if (typeof onClose === 'function') {
      await onClose();
    }
  });
};

document.addEventListener('DOMContentLoaded', async () => {
  const SETTINGS_FILE = 'settings.json';
  const MANIFEST_FILE = 'manifest.json';

  let settings = {};
  let manifest = {};

  try {
    const [setRes, manRes] = await Promise.all([
      fetch(SETTINGS_FILE),
      fetch(MANIFEST_FILE)
    ]);
    if (setRes.ok) settings = await setRes.json();
    if (manRes.ok) manifest = await manRes.json();
  } catch (e) {}

  const currentVersion = String(manifest.version || '0');
  const savedVersion = String(settings.lastSeenVersion || '0');
  const appName = manifest.name || 'Home DOCK';

  if (savedVersion === currentVersion) return;

  const saveVersion = async () => {
    try {
      const res = await fetch(SETTINGS_FILE);
      const freshSettings = res.ok ? await res.json() : {};
      delete freshSettings.tutorialRead;
      freshSettings.lastSeenVersion = currentVersion;

      if (typeof window.saveTabData === 'function') {
        await window.saveTabData(SETTINGS_FILE, freshSettings);
      }
    } catch (e) {}
  };

    // Выносим показ окна "Что нового" в отдельную функцию
  const showWhatsNew = () => {
    window.showHelper({
      contentFile: 'whats-new.html',
      title: `🚀 Что нового в ${appName} v${currentVersion}`,
      mood: 'update',
      buttonText: 'Круто, погнали!',
      onClose: saveVersion // Записываем версию в JSON, когда пользователь дочитает и нажмет кнопку
    });
  };

  // Показ приветствия
  if (savedVersion === '0') {
    window.showHelper({
      contentFile: 'welcome.html',
      title: `👋 Добро пожаловать в ${appName} v${currentVersion}`,
      mood: 'default',
      artUrl: HELPER_ARTS.update,
      buttonText: 'Далее: что нового →',
      onClose: () => {
        // При нажатии кнопки сразу запускаем второе окно!
        showWhatsNew();
      }
    });
  } else {
    // Если приветствие уже было, но версия обновилась — показываем сразу "Что нового"
    showWhatsNew();
  }

});
