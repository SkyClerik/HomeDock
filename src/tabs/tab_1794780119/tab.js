(async function () {
  const TAB_DIR = window.CURRENT_TAB_DIR;
  if (!TAB_DIR) return;
  const DATA_URL = `${TAB_DIR}/data.json`;

  let items = [];
  let activeCategoryFilter = 'all';
  // Запоминаем открытые категории, чтобы при перерисовке после перетаскивания они не схлопывались
  const expandedCategories = new Set();

  // Состояние перетаскивания
  let draggedIdx = null;
  let dropTargetIdx = null;
  let dropPosition = 'before'; // 'before' или 'after'
  let isDragging = false;

  const root = document.getElementById('links-categories-root');
  const filtersBox = document.getElementById('links-cat-filters');
  const modal = document.getElementById('link-modal');
  const statusText = document.getElementById('status-text');
  const searchInput = document.getElementById('search-input');

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

  function isImageIcon(val) {
    if (!val) return false;
    return /^(https?:\/\/|data:)/i.test(val) || /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(val);
  }

  function clearDragVisuals() {
    root.querySelectorAll('.drag-over-before, .drag-over-after, .drag-over-cat').forEach(el => {
      el.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-cat');
    });
  }

  // Перемещение элемента в массиве items и сохранение в JSON
  async function reorderItems(fromIdx, toIdx, position, targetCategory) {
    if (fromIdx === null || fromIdx < 0 || fromIdx >= items.length) return;

    const [movedItem] = items.splice(fromIdx, 1);
    movedItem.category = targetCategory;

    if (toIdx === null || toIdx < 0) {
      // Бросили в пустую область категории или на её заголовок -> ставим в конец этой категории
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
      // Корректируем индекс цели после вырезания movedItem
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
      block.className = `cat-block ${isExpanded ? '' : 'collapsed'}`;

      block.innerHTML = `
        <div class="cat-header">
          <div>
            <div class="cat-name">${cat}</div>
            <div class="cat-count">${catItems.length} ссылок</div>
          </div>
          <div style="opacity: 0.6; font-size: 12px;">▼</div>
        </div>
        <div class="cat-body">
          <div class="grid"></div>
        </div>
      `;

      block.querySelector('.cat-header').onclick = () => {
        block.classList.toggle('collapsed');
        if (block.classList.contains('collapsed')) {
          expandedCategories.delete(cat);
        } else {
          expandedCategories.add(cat);
        }
      };

      // Разрешаем бросать карточку прямо на блок категории (перенос между категориями)
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
        // Отключаем перетаскивание только во время активного поиска
        card.draggable = !isSearchActive;

        const fullDesc = item.description || '';
        const shortDesc = truncateText(fullDesc, 120);
        const hasLongDesc = fullDesc.length > 120;

        let thumbHtml = '';
        if (isImageIcon(item.icon)) {
          const imgSrc = window.resolveTabAsset(item.icon, TAB_DIR);
          const fallbackLetter = (item.name || '?').slice(0, 2).toUpperCase();
          thumbHtml = `<img src="${imgSrc}" referrerpolicy="no-referrer" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                       <div class="card-thumb-fallback" style="display:none;">${fallbackLetter}</div>`;
        } else {
          const textIcon = item.icon ? item.icon.slice(0, 3) : (item.name || '?').slice(0, 2).toUpperCase();
          thumbHtml = `<div class="card-thumb-fallback">${textIcon}</div>`;
        }

        let cleanHost = '';
        try { cleanHost = new URL(item.url).hostname.replace(/^www\./, ''); } catch (e) { cleanHost = item.url; }

        card.innerHTML = `
          ${!isSearchActive ? `<div class="drag-handle" title="Перетащить для сортировки">⋮⋮</div>` : ''}
          <div class="card-actions">
            <button class="card-act-btn btn-clone" title="Создать копию карточки">📄</button>
            <button class="card-act-btn btn-edit" title="Редактировать">✏️</button>
            <button class="card-act-btn btn-del" title="Удалить">🗑️</button>
          </div>
          <div class="card-inner">
            <div class="card-thumb">${thumbHtml}</div>
            <div class="card-right">
              <div class="card-title" title="${item.name}">${item.name}</div>
              <div class="card-url">${cleanHost}</div>
              ${fullDesc ? `<div class="card-desc">${shortDesc}</div>` : ''}
              <div class="card-meta-row">
                <span class="tag-pill">${item.tag || 'link'}</span>
                <span class="card-open">Открыть <span class="card-open-arrow">↗</span></span>
              </div>
            </div>
          </div>
        `;

        // События Drag & Drop на самой карточке
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
          const descEl = card.querySelector('.card-desc');
          card.addEventListener('mouseenter', () => { descEl.textContent = fullDesc; });
          card.addEventListener('mouseleave', () => { descEl.textContent = shortDesc; });
        }
        card.addEventListener('click', (e) => {
          if (isDragging) return;
          if (e.target.closest('.card-actions') || e.target.closest('.drag-handle')) return;
          if (item.url) window.open(item.url, '_blank');
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

  function getFormObject() {
    return {
      name: document.getElementById('field-name').value.trim(),
      url: document.getElementById('field-url').value.trim(),
      icon: document.getElementById('field-icon').value.trim(),
      category: document.getElementById('field-category').value.trim(),
      tag: document.getElementById('field-tag').value.trim(),
      description: document.getElementById('field-desc').value.trim()
    };
  }

  function fillFormFromObject(obj, isClone = false) {
    document.getElementById('field-name').value = isClone && obj.name ? `${obj.name} (копия)` : (obj.name || '');
    document.getElementById('field-url').value = obj.url || '';
    document.getElementById('field-icon').value = obj.icon || '';
    document.getElementById('field-category').value = obj.category || '';
    document.getElementById('field-tag').value = obj.tag || '';
    document.getElementById('field-desc').value = obj.description || '';
  }

  document.getElementById('btn-copy-link').onclick = async () => {
    const data = getFormObject();
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      const btn = document.getElementById('btn-copy-link');
      const oldText = btn.textContent;
      btn.textContent = '✅ Скопировано!';
      if (statusText) statusText.textContent = 'Данные ссылки скопированы в буфер';
      setTimeout(() => { btn.textContent = oldText; }, 1500);
    } catch (e) {
      alert('Браузер заблокировал доступ к буферу обмена.');
    }
  };
  document.getElementById('btn-paste-link').onclick = async () => {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch (e) {
      alert('Браузер запросил разрешение на чтение буфера обмена. Нажми «Разрешить» вверху и кликни «Вставить» ещё раз.');
      return;
    }
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('Неверный формат');
      fillFormFromObject(parsed, false);
      if (statusText) statusText.textContent = 'Данные вставлены из буфера';
    } catch (e) {
      alert('В буфере обмена нет корректных данных карточки (ожидается JSON от кнопки «Копировать»).');
    }
  };
  function openModal(idx = -1, templateObj = null) {
    document.getElementById('edit-link-index').value = idx;
    if (idx >= 0) {
      document.getElementById('link-modal-title').textContent = 'Редактировать ссылку';
      fillFormFromObject(items[idx], false);
    } else if (templateObj) {
      document.getElementById('link-modal-title').textContent = 'Копия ссылки';
      fillFormFromObject(templateObj, true);
    } else {
      document.getElementById('link-modal-title').textContent = 'Новая ссылка';
      fillFormFromObject({
        category: activeCategoryFilter !== 'all' ? activeCategoryFilter : 'link',
        tag: 'link'
      }, false);
    }
    modal.classList.add('open');
  }
  document.getElementById('btn-open-add-link').onclick = () => openModal(-1);
  document.getElementById('btn-cancel-link').onclick = () => modal.classList.remove('open');
  document.getElementById('btn-save-link').onclick = async () => {
    const idx = parseInt(document.getElementById('edit-link-index').value, 10);
    const newObj = getFormObject();
    if (!newObj.name) newObj.name = 'Без названия';
    if (!newObj.category) newObj.category = 'Прочее';
    if (!newObj.tag) newObj.tag = 'link';
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