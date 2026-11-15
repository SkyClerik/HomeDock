window.CURRENT_TAB_DIR = '';

// Хелпер: превращает имя файла ("google.png") в путь внутри папки текущей вкладки, а URL оставляет как есть
window.resolveTabAsset = function(iconValue, tabDir = window.CURRENT_TAB_DIR) {
  if (!iconValue) return '';
  const val = iconValue.trim();
  if (/^(https?:\/\/|data:|\/)/i.test(val)) {
    return val;
  }
  return `${tabDir}/${val}`;
};

// Хелпер: отправка обновленного массива данных в data.json через server.py
window.saveTabData = async function(jsonPath, dataArray) {
  const statusText = document.getElementById('status-text');
  statusText.textContent = 'Сохранение...';
  try {
    const res = await fetch('/api/save-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: jsonPath, data: dataArray })
    });
    const result = await res.json();
    statusText.textContent = result.status === 'ok' ? 'Сохранено в JSON' : `Ошибка: ${result.message}`;
    return result.status === 'ok';
  } catch (err) {
    statusText.textContent = 'Нет связи с сервером';
    return false;
  }
};

// Хелпер: обновление счетчика карточек в шапке
window.updateDockCounter = function() {
  const tabContent = document.getElementById('tab-content');
  const linkCount = document.getElementById('link-count');
  if (!tabContent || !linkCount) return;
  const allCards = tabContent.querySelectorAll('.card-item');
  const visibleCards = Array.from(allCards).filter(c => c.style.display !== 'none');
  linkCount.textContent = `${visibleCards.length} элементов`;
};


// Глобальное всплывающее уведомление внизу экрана (по умолчанию на 10 секунд)
window.showDockToast = function(title, message, duration = 10000) {
  let container = document.getElementById('dock-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'dock-toast-container';
    container.className = 'dock-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'dock-toast';
  toast.innerHTML = `
    <div class="dock-toast-title">
      <span>${title}</span>
      <button type="button" class="dock-toast-close" title="Закрыть">✕</button>
    </div>
    <div style="color: #cbd5e1;">${message}</div>
  `;

  const removeToast = () => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  };

  toast.querySelector('.dock-toast-close').onclick = removeToast;
  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(removeToast, duration);
  }
};

// Автоматический перехват битых картинок (404 / блокировка хостинга) на всех вкладках
window.addEventListener('error', (e) => {
  const target = e.target;
  if (target && target.tagName === 'IMG') {
    const brokenSrc = target.getAttribute('src') || 'неизвестный адрес';
    // Игнорируем предпросмотр в окне YouTube, если видео без обложки
    if (target.id === 'yt-preview-img') return;

    const card = target.closest('.card');
    const cardTitle = card ? (card.querySelector('.card-title')?.textContent || 'Карточка') : 'Изображение';

    window.showDockToast(
      `⚠️ Картинка не загрузилась (${cardTitle})`,
      `Файл не найден (404) или заблокирован сайтом:<br><span style="opacity: 0.75; font-size: 11px;">${brokenSrc}</span>`,
      10000
    );
  }
}, true);


document.addEventListener('DOMContentLoaded', () => {
  const sidebarNav = document.getElementById('sidebar-nav');
  const tabContent = document.getElementById('tab-content');
  const themeSelect = document.getElementById('theme-select');
  const themeLink = document.getElementById('theme-link');
  const searchInput = document.getElementById('search-input');
  const statusText = document.getElementById('status-text');

  function executeTabScripts(container) {
    const scripts = container.querySelectorAll('script');
    scripts.forEach(oldScript => {
      const newScript = document.createElement('script');
      Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
      newScript.textContent = oldScript.textContent;
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
  }

  async function applyTabWallpaper(tabDir) {
    try {
      const res = await fetch(`/api/tab-wallpaper?dir=${encodeURIComponent(tabDir)}`);
      const data = await res.json();
      if (data.url) {
        const img = new Image();
        img.onload = () => {
          document.body.style.backgroundImage = `url("${data.url}")`;
          document.body.style.backgroundSize = 'cover';
          document.body.style.backgroundPosition = 'center';
          document.body.style.backgroundAttachment = 'fixed';
        };
        img.src = data.url;
      } else {
        // Возвращаем дефолтные обои из активного CSS-файла темы
        document.body.style.backgroundImage = '';
      }
    } catch (e) {
      document.body.style.backgroundImage = '';
    }
  }

  // Новая функция: сама подключает tab.css и tab.js из папки текущей вкладки
  function loadTabAssets(tabDir) {
    // 1. Подключаем стили вкладки
    let tabCss = document.getElementById('dynamic-tab-css');
    if (!tabCss) {
      tabCss = document.createElement('link');
      tabCss.id = 'dynamic-tab-css';
      tabCss.rel = 'stylesheet';
      document.head.appendChild(tabCss);
    }
    tabCss.href = `${tabDir}/tab.css?v=${Date.now()}`;

    // 2. Подключаем скрипт вкладки
    const oldScript = document.getElementById('dynamic-tab-js');
    if (oldScript) oldScript.remove();

    const tabScript = document.createElement('script');
    tabScript.id = 'dynamic-tab-js';
    tabScript.src = `${tabDir}/tab.js?v=${Date.now()}`;
    document.body.appendChild(tabScript);
  }

  async function loadTabContent(tabObj) {
    try {
      statusText.textContent = 'Загрузка...';
      window.CURRENT_TAB_DIR = tabObj.dir;
      applyTabWallpaper(tabObj.dir);

      const response = await fetch(tabObj.file);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      tabContent.innerHTML = await response.text();
      executeTabScripts(tabContent);

      // Автоматически грузим стили и скрипт из актуальной папки
      loadTabAssets(tabObj.dir);

      localStorage.setItem('homedock-active-tab', tabObj.id);
      searchInput.value = '';
      window.updateDockCounter();
      statusText.textContent = 'Готово к работе';
    } catch (err) {
      tabContent.innerHTML = `<div style="padding: 20px; color: #ff5555;">
        Ошибка загрузки <b>${tabObj.file}</b>.
      </div>`;
      statusText.textContent = 'Ошибка загрузки';
    }
  }

  let isSidebarEditMode = false;
  let cachedTabs = [];

  function renderSidebar() {
    sidebarNav.innerHTML = '';

    // Панель управления режимом редактирования меню
    const editBar = document.createElement('div');
    editBar.className = 'sidebar-edit-bar';

    if (!isSidebarEditMode) {
      const editBtn = document.createElement('button');
      editBtn.className = 'sidebar-mode-btn';
      editBtn.textContent = '✏️ Меню';
      editBtn.title = 'Изменить порядок и названия вкладок';
      editBtn.onclick = () => {
        isSidebarEditMode = true;
        renderSidebar();
      };
      editBar.appendChild(editBtn);
    } else {
      const saveBtn = document.createElement('button');
      saveBtn.className = 'sidebar-mode-btn save';
      saveBtn.textContent = '💾 Сохранить';
      saveBtn.onclick = async () => {
        // Собираем актуальные названия из инпутов в текущем порядке DOM
        const editRows = Array.from(sidebarNav.querySelectorAll('.tab-edit-item'));
        const updatedList = editRows.map(row => ({
          id: row.dataset.tabId,
          title: row.querySelector('.tab-edit-input').value.trim() || row.dataset.tabId
        }));

        saveBtn.disabled = true;
        saveBtn.textContent = '...';
        statusText.textContent = 'Сохранение меню...';

        try {
          const res = await fetch('/api/save-tabs-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tabs: updatedList })
          });
          const result = await res.json();
          if (result.status === 'ok') {
            const oldActive = localStorage.getItem('homedock-active-tab');
            if (oldActive && result.renamed && result.renamed[oldActive]) {
              localStorage.setItem('homedock-active-tab', result.renamed[oldActive]);
            }
            isSidebarEditMode = false;
            await initTabs();
            statusText.textContent = 'Меню сохранено';
          } else {
            alert('Ошибка сохранения: ' + (result.message || 'неизвестно'));
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Сохранить';
          }
        } catch (e) {
          alert('Нет связи с server.py');
          saveBtn.disabled = false;
          saveBtn.textContent = '💾 Сохранить';
        }
      };

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'sidebar-mode-btn';
      cancelBtn.textContent = '✕';
      cancelBtn.title = 'Отменить изменения';
      cancelBtn.onclick = () => {
        isSidebarEditMode = false;
        renderSidebar();
      };

      editBar.appendChild(saveBtn);
      editBar.appendChild(cancelBtn);
    }

    sidebarNav.appendChild(editBar);

    if (!cachedTabs || cachedTabs.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.style.cssText = 'opacity: 0.5; font-size: 13px; padding: 10px;';
      emptyMsg.textContent = 'Создайте папку в tabs/ с файлом tab.html';
      sidebarNav.appendChild(emptyMsg);
      return;
    }

    // Обычный режим просмотра вкладок
    if (!isSidebarEditMode) {
      const savedTabId = localStorage.getItem('homedock-active-tab');
      cachedTabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.className = 'tab-btn';
        if (savedTabId === tab.id) btn.classList.add('active');
        btn.dataset.tabId = tab.id;
        btn.textContent = tab.title;
        btn.title = tab.title;

        btn.addEventListener('click', () => {
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          loadTabContent(tab);
        });

        sidebarNav.appendChild(btn);
      });
      return;
    }

    // Режим редактирования (Drag & Drop + Input)
    let draggedRow = null;

    cachedTabs.forEach(tab => {
      const row = document.createElement('div');
      row.className = 'tab-edit-item';
      row.dataset.tabId = tab.id;
      row.draggable = true;

      row.innerHTML = `
        <span class="tab-drag-grip" title="Перетащить">⋮⋮</span>
        <input type="text" class="tab-edit-input" value="${tab.title.replace(/"/g, '&quot;')}">
      `;

      // Чтобы выделение текста мышкой в input не запускало перетаскивание блока
      const input = row.querySelector('.tab-edit-input');
      input.addEventListener('focus', () => { row.draggable = false; });
      input.addEventListener('blur', () => { row.draggable = true; });

      row.addEventListener('dragstart', (e) => {
        draggedRow = row;
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => row.classList.add('dragging'), 0);
      });

      row.addEventListener('dragover', (e) => {
        if (!draggedRow || draggedRow === row) return;
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        const isBottom = (e.clientY - rect.top) > rect.height / 2;
        row.classList.remove('drag-over-top', 'drag-over-bottom');
        row.classList.add(isBottom ? 'drag-over-bottom' : 'drag-over-top');
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over-top', 'drag-over-bottom');
        if (!draggedRow || draggedRow === row) return;

        const rect = row.getBoundingClientRect();
        const isBottom = (e.clientY - rect.top) > rect.height / 2;
        if (isBottom) {
          row.after(draggedRow);
        } else {
          row.before(draggedRow);
        }
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        sidebarNav.querySelectorAll('.tab-edit-item').forEach(el => {
          el.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        draggedRow = null;
      });

      sidebarNav.appendChild(row);
    });

    // Зона корзины внизу левой панели (появляется только в режиме редактирования)
    const trashZone = document.createElement('div');
    trashZone.className = 'sidebar-trash-zone';
    trashZone.innerHTML = '🗑️ Перетащите вкладку сюда<br><span style="font-size:10.5px; opacity:0.75; font-weight:400;">для удаления</span>';

    trashZone.addEventListener('dragover', (e) => {
      if (!draggedRow) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      trashZone.classList.add('drag-over');
    });

    trashZone.addEventListener('dragleave', () => {
      trashZone.classList.remove('drag-over');
    });

    trashZone.addEventListener('drop', (e) => {
      e.preventDefault();
      trashZone.classList.remove('drag-over');
      if (!draggedRow) return;

      const tabId = draggedRow.dataset.tabId;
      const currentTitle = draggedRow.querySelector('.tab-edit-input').value.trim() || tabId;
      openTabDeleteModal(tabId, currentTitle);
    });

    sidebarNav.appendChild(trashZone);
  }

  // Модальное окно подтверждения удаления вкладки
  function openTabDeleteModal(tabId, tabTitle) {
    let backdrop = document.getElementById('tab-delete-modal-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'tab-delete-modal-backdrop';
      backdrop.className = 'tab-del-backdrop';
      document.body.appendChild(backdrop);
    }

    backdrop.innerHTML = `
      <div class="tab-del-modal">
        <h3>🗑️ Удаление вкладки</h3>
        <div style="font-size: 13px; color: #cbd5e1; line-height: 1.45;">
          Вы собираетесь удалить вкладку <b style="color: #fff;">${tabTitle}</b>
          <span style="opacity: 0.6; font-size: 11.5px;">(папка: ${tabId})</span>.
        </div>

        <div class="tab-del-box">
          <div style="font-size: 12px; font-weight: 600; color: #7dd3fc;">Вариант 1: Безопасное скрытие</div>
          <div style="font-size: 11.5px; color: #94a3b8;">Перенести папку вкладки во временную папку <code>backups/deleted_tabs/</code>.</div>
          <button type="button" class="tab-del-btn-trash" id="btn-del-tab-trash">📦 Переместить в корзину</button>
        </div>

        <div class="tab-del-box danger">
          <div style="font-size: 12px; font-weight: 600; color: #fda4af;">Вариант 2: Безвозвратное удаление</div>
          <div style="font-size: 11.5px; color: #94a3b8;">
            Все ссылки, картинки и обои внутри вкладки будут стерты навсегда. Введите название <b style="color:#fff;">${tabTitle}</b> для разблокировки кнопки:
          </div>
          <input type="text" class="tab-del-input" id="input-confirm-tab-name" placeholder="Введите точное название вкладки...">
          <button type="button" class="tab-del-btn-perm" id="btn-del-tab-perm" disabled>🔥 Удалить навсегда</button>
        </div>

        <div style="display: flex; justify-content: flex-end;">
          <button type="button" class="srv-btn" id="btn-del-tab-cancel">Отмена</button>
        </div>
      </div>
    `;

    backdrop.classList.add('open');

    const closeModal = () => backdrop.classList.remove('open');
    document.getElementById('btn-del-tab-cancel').onclick = closeModal;
    backdrop.onclick = (e) => { if (e.target === backdrop) closeModal(); };

    const confirmInput = document.getElementById('input-confirm-tab-name');
    const permBtn = document.getElementById('btn-del-tab-perm');
    const trashBtn = document.getElementById('btn-del-tab-trash');

    confirmInput.addEventListener('input', () => {
      permBtn.disabled = confirmInput.value.trim() !== tabTitle;
    });

    async function executeDelete(mode) {
      trashBtn.disabled = true;
      permBtn.disabled = true;
      statusText.textContent = 'Удаление вкладки...';

      try {
        const res = await fetch('/api/delete-tab', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: tabId, mode })
        });
        const result = await res.json();
        if (result.status === 'ok') {
          closeModal();
          if (localStorage.getItem('homedock-active-tab') === tabId) {
            localStorage.removeItem('homedock-active-tab');
          }
          isSidebarEditMode = false;
          await initTabs();
          statusText.textContent = result.message || 'Вкладка удалена';
        } else {
          alert('Ошибка: ' + (result.message || 'не удалось удалить'));
          trashBtn.disabled = false;
        }
      } catch (e) {
        alert('Нет связи с server.py');
        trashBtn.disabled = false;
      }
    }

    trashBtn.onclick = () => executeDelete('trash');
    permBtn.onclick = () => executeDelete('permanent');
  }
  
  async function initTabs() {
    try {
      const res = await fetch('/api/tabs');
      cachedTabs = await res.json();

      if (!cachedTabs || cachedTabs.length === 0) {
        renderSidebar();
        return;
      }

      const savedTabId = localStorage.getItem('homedock-active-tab');
      let tabToOpen = cachedTabs.find(t => t.id === savedTabId) || cachedTabs[0];
      localStorage.setItem('homedock-active-tab', tabToOpen.id);

      renderSidebar();
      loadTabContent(tabToOpen);
    } catch (err) {
      sidebarNav.innerHTML = '<div style="color: #ff5555; font-size: 13px; padding: 10px;">Нет связи с сервером</div>';
      statusText.textContent = 'Сервер недоступен';
    }
  }

  initTabs();

  // Живой поиск + Ctrl+K
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyK' || e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      e.stopPropagation();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }
  }, true);

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    const cards = tabContent.querySelectorAll('.card-item');
    cards.forEach(card => {
      const text = card.textContent.toLowerCase();
      const isMatch = text.includes(query);
      card.style.display = isMatch ? '' : 'none';

      if (query && isMatch) {
        const catBlock = card.closest('.cat-block, .soft-cat-block');
        if (catBlock) catBlock.classList.remove('collapsed');
      }
    });
    window.updateDockCounter();
  });


});

// Запуск программ
async function runLocalApp(exePath, args = '') {
  const statusText = document.getElementById('status-text');
  statusText.textContent = `Запуск: ${exePath}...`;
  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: exePath, args: args })
    });
    const data = await res.json();
    statusText.textContent = data.status === 'ok' ? `Запущено: ${exePath}` : `Ошибка: ${data.message}`;
  } catch (err) {
    statusText.textContent = 'Нет связи с server.py';
  }
}

// Управление сервером
async function controlServer(action) {
  const statusText = document.getElementById('status-text');
  const statusDot = document.querySelector('.status-dot');
  if (action === 'shutdown') {
    statusText.textContent = 'Сервер остановлен';
    if (statusDot) statusDot.style.background = '#ff4444';
    await fetch('/api/shutdown', { method: 'POST' }).catch(() => {});
  } else if (action === 'restart') {
    statusText.textContent = 'Перезапуск сервера...';
    await fetch('/api/restart', { method: 'POST' }).catch(() => {});
    setTimeout(() => location.reload(), 1000);
  }
}
