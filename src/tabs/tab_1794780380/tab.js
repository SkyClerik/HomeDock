(async function() {
  const TAB_DIR = window.CURRENT_TAB_DIR;
  if (!TAB_DIR) return;
  const DATA_URL = `${TAB_DIR}/data.json`;

  let items = [];
  let activeCategoryFilter = 'all';

  const root = document.getElementById('soft-categories-root');
  const filtersBox = document.getElementById('soft-cat-filters');
  const modal = document.getElementById('soft-modal');
  const alertModal = document.getElementById('soft-alert-modal');
  const alertText = document.getElementById('soft-alert-text');
  const statusText = document.getElementById('status-text');

  const searchInput = document.getElementById('search-input');
  const expandedCategories = new Set();
  let draggedIdx = null;
  let dropTargetIdx = null;
  let dropPosition = 'before';
  let isDragging = false;

  function showDockAlert(message) {
    alertText.textContent = message;
    alertModal.classList.add('open');
  }
  document.getElementById('btn-close-alert').onclick = () => alertModal.classList.remove('open');

  async function loadItems() {
    try {
      const res = await fetch(DATA_URL);
      items = res.ok ? await res.json() : [];
    } catch (e) {
      items = [];
    }
    renderAll();
  }

  function truncateText(text, limit = 120) {
    if (!text) return '';
    return text.length > limit ? text.slice(0, limit).trim() + '…' : text;
  }

  function buildThumbHtml(iconVal, nameVal) {
    const fallbackLetter = (nameVal || '?').slice(0, 2).toUpperCase();
    if (!iconVal) {
      return `<div class="card-thumb-fallback">${fallbackLetter}</div>`;
    }
    const val = iconVal.trim();
    const isWeb = /^(https?:\/\/|data:)/i.test(val);
    const isLocalPath = /^[a-zA-Z]:[\\/]/.test(val) || val.startsWith('\\\\') || val.includes('\\') || val.includes('/') || /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(val);

    if (isWeb) {
      return `<img src="${val}" referrerpolicy="no-referrer" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
              <div class="card-thumb-fallback" style="display:none;">${fallbackLetter}</div>`;
    }
    if (isLocalPath) {
      const encoded = encodeURIComponent(val);
      return `<img src="/api/local-image?path=${encoded}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
              <div class="card-thumb-fallback" style="display:none;">${fallbackLetter}</div>`;
    }
    return `<div class="card-thumb-fallback">${val.slice(0, 3)}</div>`;
  }

  async function openFolder(dirPath) {
    if (!dirPath) {
      showDockAlert('Путь к директории не указан в карточке.');
      return;
    }
    try {
      const res = await fetch('/api/open-dir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath })
      });
      const data = await res.json();
      if (data.status !== 'ok') {
        showDockAlert(data.message || 'Папка не найдена!');
        if (statusText) statusText.textContent = 'Ошибка: папка не найдена';
      } else {
        if (statusText) statusText.textContent = `Открыта папка: ${dirPath}`;
      }
    } catch (e) {
      showDockAlert('Нет связи с сервером server.py');
    }
  }

  async function launchSoft(item) {
    if (!item.exePath) {
      showDockAlert('Путь до файла запуска не указан в карточке.');
      return;
    }
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: item.exePath,
          dir: item.dirPath || '',
          args: item.args || ''
        })
      });
      const data = await res.json();
      if (data.status !== 'ok') {
        showDockAlert(data.message || 'Файл запуска или директория не найдены!');
        if (statusText) statusText.textContent = 'Ошибка запуска';
      } else {
        if (statusText) statusText.textContent = `Запущено: ${item.name}`;
      }
    } catch (e) {
      showDockAlert('Нет связи с сервером server.py');
    }
  }

  function clearDragVisuals() {
    root.querySelectorAll('.drag-over-before, .drag-over-after, .drag-over-cat').forEach(el => {
      el.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-cat');
    });
  }

  async function reorderItems(fromIdx, toIdx, position, targetCategory) {
    if (fromIdx === null || fromIdx < 0 || fromIdx >= items.length) return;

    const [movedItem] = items.splice(fromIdx, 1);
    movedItem.category = targetCategory;

    if (toIdx === null || toIdx < 0) {
      let lastCatPos = -1;
      items.forEach((it, i) => {
        if ((it.category || 'Прочее').trim() === targetCategory) lastCatPos = i;
      });
      if (lastCatPos >= 0) {
        items.splice(lastCatPos + 1, 0, movedItem);
      } else {
        items.push(movedItem);
      }
    } else {
      let insertIdx = toIdx > fromIdx ? toIdx - 1 : toIdx;
      if (position === 'after') insertIdx += 1;
      insertIdx = Math.max(0, Math.min(items.length, insertIdx));
      items.splice(insertIdx, 0, movedItem);
    }

    expandedCategories.add(targetCategory);
    renderAll();
    await window.saveTabData(DATA_URL, items);
  }

  function renderAll() {
    const categories = [...new Set(items.map(i => (i.category || 'Прочее').trim()))];
    const isSearchActive = searchInput && searchInput.value.trim().length > 0;

    filtersBox.innerHTML = `<button class="filter-chip ${activeCategoryFilter === 'all' ? 'active' : ''}" data-cat="all">Все (${items.length})</button>`;
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = `filter-chip ${activeCategoryFilter === cat ? 'active' : ''}`;
      btn.textContent = cat;
      btn.onclick = () => {
        activeCategoryFilter = cat;
        expandedCategories.add(cat);
        renderAll();
      };
      filtersBox.appendChild(btn);
    });
    filtersBox.querySelector('[data-cat="all"]').onclick = () => {
      activeCategoryFilter = 'all';
      renderAll();
    };

    root.innerHTML = '';
    const catsToShow = activeCategoryFilter === 'all' ? categories : [activeCategoryFilter];

    catsToShow.forEach(cat => {
      const catItems = items
        .map((item, idx) => ({ ...item, _idx: idx }))
        .filter(i => (i.category || 'Прочее').trim() === cat);

      if (catItems.length === 0) return;

      const block = document.createElement('div');
      const isExpanded = expandedCategories.has(cat) || activeCategoryFilter !== 'all';
      block.className = `soft-cat-block ${isExpanded ? '' : 'collapsed'}`;

      block.innerHTML = `
        <div class="soft-cat-header">
          <div>
            <div class="soft-cat-name">${cat}</div>
            <div class="soft-cat-count">${catItems.length} элементов</div>
          </div>
          <div style="opacity: 0.6; font-size: 12px;">▼</div>
        </div>
        <div class="soft-cat-body">
          <div class="grid"></div>
        </div>
      `;

      block.querySelector('.soft-cat-header').onclick = () => {
        block.classList.toggle('collapsed');
        if (block.classList.contains('collapsed')) {
          expandedCategories.delete(cat);
        } else {
          expandedCategories.add(cat);
        }
      };

      block.addEventListener('dragover', (e) => {
        if (draggedIdx === null || isSearchActive) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        block.classList.add('drag-over-cat');
      });

      block.addEventListener('dragleave', (e) => {
        if (!block.contains(e.relatedTarget)) {
          block.classList.remove('drag-over-cat');
        }
      });

      block.addEventListener('drop', async (e) => {
        if (draggedIdx === null || isSearchActive) return;
        e.preventDefault();
        e.stopPropagation();

        const from = draggedIdx;
        const targetCardIdx = dropTargetIdx;
        const pos = dropPosition;

        draggedIdx = null;
        dropTargetIdx = null;
        clearDragVisuals();

        if (from === targetCardIdx) return;
        await reorderItems(from, targetCardIdx, pos, cat);
      });

      const grid = block.querySelector('.grid');

      catItems.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card card-item';
        card.draggable = !isSearchActive;

        const fullDesc = item.description || '';
        const shortDesc = truncateText(fullDesc, 120);
        const hasLongDesc = fullDesc.length > 120;

        let cleanHost = '';
        if (item.url) {
          try { cleanHost = new URL(item.url).hostname.replace(/^www\./, ''); } catch (e) { cleanHost = item.url; }
        }

        const subLine = cleanHost || item.dirPath || item.exePath || '';

        card.innerHTML = `
          ${!isSearchActive ? `<div class="drag-handle" title="Перетащить для сортировки">⋮⋮</div>` : ''}
          <div class="soft-card-actions">
            <button class="soft-act-btn btn-clone" title="Создать копию карточки">📄</button>
            <button class="soft-act-btn btn-edit" title="Редактировать">✏️</button>
            <button class="soft-act-btn btn-del" title="Удалить">🗑️</button>
          </div>
          <div class="card-inner">
            <div class="card-thumb">${buildThumbHtml(item.icon, item.name)}</div>
            <div class="card-right">
              <div class="card-title" title="${item.name}">${item.name}</div>
              ${subLine ? `<div class="card-url" title="${subLine}">${subLine}</div>` : ''}
              ${fullDesc ? `<div class="soft-desc">${shortDesc}</div>` : ''}
              <div class="soft-card-footer">
                <span class="tag-pill">${item.tag || 'soft'}</span>
                <div class="soft-card-btns">
                  <button class="soft-btn-action btn-open-dir" title="${item.dirPath || 'Директория не указана'}">📂 Папка</button>
                  <button class="soft-btn-action run btn-run-exe" title="${item.exePath || 'Файл не указан'}">▶ Запуск</button>
                  ${item.url ? `<span class="card-open" style="margin-left:4px;">Открыть <span class="card-open-arrow">↗</span></span>` : ''}
                </div>
              </div>
            </div>
          </div>
        `;

        card.addEventListener('dragstart', (e) => {
          if (isSearchActive) {
            e.preventDefault();
            return;
          }
          isDragging = true;
          draggedIdx = item._idx;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(item._idx));
          setTimeout(() => card.classList.add('dragging'), 0);
        });

        card.addEventListener('dragover', (e) => {
          if (draggedIdx === null || draggedIdx === item._idx || isSearchActive) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';

          const rect = card.getBoundingClientRect();
          const isRightHalf = (e.clientX - rect.left) > rect.width / 2;

          root.querySelectorAll('.drag-over-before, .drag-over-after').forEach(el => {
            if (el !== card) el.classList.remove('drag-over-before', 'drag-over-after');
          });

          dropTargetIdx = item._idx;
          if (isRightHalf) {
            dropPosition = 'after';
            card.classList.remove('drag-over-before');
            card.classList.add('drag-over-after');
          } else {
            dropPosition = 'before';
            card.classList.remove('drag-over-after');
            card.classList.add('drag-over-before');
          }
        });

        card.addEventListener('dragleave', (e) => {
          if (!card.contains(e.relatedTarget)) {
            card.classList.remove('drag-over-before', 'drag-over-after');
            if (dropTargetIdx === item._idx) dropTargetIdx = null;
          }
        });

        card.addEventListener('dragend', () => {
          card.classList.remove('dragging');
          draggedIdx = null;
          dropTargetIdx = null;
          clearDragVisuals();
          setTimeout(() => { isDragging = false; }, 50);
        });

        if (hasLongDesc) {
          const descEl = card.querySelector('.soft-desc');
          card.addEventListener('mouseenter', () => { descEl.textContent = fullDesc; });
          card.addEventListener('mouseleave', () => { descEl.textContent = shortDesc; });
        }

        card.addEventListener('click', (e) => {
          if (isDragging) return;
          if (e.target.closest('.soft-card-actions') || e.target.closest('.soft-btn-action') || e.target.closest('.drag-handle')) return;
          if (item.url) window.open(item.url, '_blank');
        });

        card.querySelector('.btn-open-dir').addEventListener('click', (e) => {
          if (isDragging) return;
          e.stopPropagation();
          openFolder(item.dirPath);
        });

        card.querySelector('.btn-run-exe').addEventListener('click', (e) => {
          if (isDragging) return;
          e.stopPropagation();
          launchSoft(item);
        });

        card.querySelector('.btn-clone').addEventListener('click', (e) => {
          e.stopPropagation();
          openModal(-1, item);
        });

        card.querySelector('.btn-edit').addEventListener('click', (e) => {
          e.stopPropagation();
          openModal(item._idx);
        });

        card.querySelector('.btn-del').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`Удалить «${item.name}»?`)) return;
          items.splice(item._idx, 1);
          await window.saveTabData(DATA_URL, items);
          renderAll();
        });

        grid.appendChild(card);
      });

      root.appendChild(block);
    });

    window.updateDockCounter();
  }

  // Системный диалог выбора пути
  document.querySelectorAll('.btn-pick-dialog').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.pick;
      const targetInput = document.getElementById(btn.dataset.target);
      btn.disabled = true;
      try {
        const res = await fetch('/api/pick-path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode })
        });
        const data = await res.json();
        if (data.status === 'ok' && data.path) {
          targetInput.value = data.path;
        }
      } catch (e) {
        showDockAlert('Не удалось открыть окно выбора: нет связи с server.py');
      } finally {
        btn.disabled = false;
      }
    });
  });

  // Сбор данных из полей формы в объект
  function getFormObject() {
    return {
      name: document.getElementById('soft-name').value.trim(),
      url: document.getElementById('soft-url').value.trim(),
      dirPath: document.getElementById('soft-dir').value.trim(),
      exePath: document.getElementById('soft-exe').value.trim(),
      icon: document.getElementById('soft-icon').value.trim(),
      category: document.getElementById('soft-category').value.trim(),
      tag: document.getElementById('soft-tag').value.trim(),
      args: document.getElementById('soft-args').value.trim(),
      description: document.getElementById('soft-desc').value.trim()
    };
  }

  // Заполнение полей формы из объекта
  function fillFormFromObject(obj, isClone = false) {
    document.getElementById('soft-name').value = isClone && obj.name ? `${obj.name} (копия)` : (obj.name || '');
    document.getElementById('soft-url').value = obj.url || '';
    document.getElementById('soft-dir').value = obj.dirPath || '';
    document.getElementById('soft-exe').value = obj.exePath || '';
    document.getElementById('soft-icon').value = obj.icon || '';
    document.getElementById('soft-category').value = obj.category || '';
    document.getElementById('soft-tag').value = obj.tag || '';
    document.getElementById('soft-args').value = obj.args || '';
    document.getElementById('soft-desc').value = obj.description || '';
  }

  // Кнопка «📋 Копировать» в буфер обмена
  document.getElementById('btn-copy-soft').onclick = async () => {
    const data = getFormObject();
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      const btn = document.getElementById('btn-copy-soft');
      const oldText = btn.textContent;
      btn.textContent = '✅ Скопировано!';
      if (statusText) statusText.textContent = 'Данные карточки скопированы в буфер';
      setTimeout(() => { btn.textContent = oldText; }, 1500);
    } catch (e) {
      showDockAlert('Браузер заблокировал доступ к буферу обмена.');
    }
  };


  // Кнопка «📥 Вставить» из буфера обмена
  document.getElementById('btn-paste-soft').onclick = async () => {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch (e) {
      showDockAlert('Браузер запросил разрешение на чтение буфера обмена. Нажми «Разрешить» вверху и кликни «Вставить» ещё раз.');
      return;
    }

    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('Неверный формат');
      fillFormFromObject(parsed, false);
      if (statusText) statusText.textContent = 'Данные вставлены из буфера';
    } catch (e) {
      showDockAlert('В буфере обмена нет корректных данных карточки (ожидается JSON от кнопки «Копировать»).');
    }
  };


  function openModal(idx = -1, templateObj = null) {
    document.getElementById('edit-soft-index').value = idx;
    if (idx >= 0) {
      document.getElementById('soft-modal-title').textContent = 'Редактировать карточку';
      fillFormFromObject(items[idx], false);
    } else if (templateObj) {
      document.getElementById('soft-modal-title').textContent = 'Копия карточки';
      fillFormFromObject(templateObj, true);
    } else {
      document.getElementById('soft-modal-title').textContent = 'Новая карточка';
      fillFormFromObject({
        category: activeCategoryFilter !== 'all' ? activeCategoryFilter : 'Программы',
        tag: 'soft'
      }, false);
    }
    modal.classList.add('open');
  }

  document.getElementById('btn-open-add-soft').onclick = () => openModal(-1);
  document.getElementById('btn-cancel-soft').onclick = () => modal.classList.remove('open');

  document.getElementById('btn-save-soft').onclick = async () => {
    const idx = parseInt(document.getElementById('edit-soft-index').value, 10);
    const newObj = getFormObject();
    if (!newObj.name) newObj.name = 'Без названия';
    if (!newObj.category) newObj.category = 'Прочее';
    if (!newObj.tag) newObj.tag = 'soft';

    if (idx >= 0) {
      items[idx] = newObj;
    } else {
      items.push(newObj);
    }

    expandedCategories.add(newObj.category);
    const ok = await window.saveTabData(DATA_URL, items);
    if (ok) {
      modal.classList.remove('open');
      renderAll();
    }
  };

  await loadItems();
})();
