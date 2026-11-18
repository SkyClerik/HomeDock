(async function () {
  const TAB_DIR = window.CURRENT_TAB_DIR;
  if (!TAB_DIR) return;
  const DATA_URL = `${TAB_DIR}/data.json`;

  let treeData = [];
  let selectedId = null;
  let isEditMode = false;
  let saveTimer = null;
  let draggedNodeId = null;
  let clipboardNode = null;

  const treeRoot = document.getElementById("hp-tree-root");
  const treeHeader = document.querySelector(".hp-tree-pane .hp-pane-header");
  const headerActions = document.querySelector(".hp-header-actions");
  const emptyState = document.getElementById("hp-empty-state");
  const inspector = document.getElementById("hp-inspector");

  const fieldTitle = document.getElementById("hp-field-title");
  const fieldType = document.getElementById("hp-field-type");
  const fieldTags = document.getElementById("hp-field-tags");
  const colorDots = document.querySelectorAll(".hp-color-dot");
  const fieldDone = document.getElementById("hp-field-done");
  const fieldShowCb = document.getElementById("hp-field-show-cb");
  const doneText = document.getElementById("hp-done-text");

  const btnModeView = document.getElementById("hp-mode-view");
  const btnModeEdit = document.getElementById("hp-mode-edit");
  const editorToolbar = document.getElementById("hp-editor-toolbar");
  const mdPreview = document.getElementById("hp-md-preview");
  const mdEditor = document.getElementById("hp-md-editor");

  // Добавляем кнопки буфера в шапку левой панели автоматически
  const btnCopyHeader = document.createElement("button");
  btnCopyHeader.type = "button";
  btnCopyHeader.className = "hp-btn";
  btnCopyHeader.title = "Копировать выбранный элемент в буфер";
  btnCopyHeader.textContent = "📋";

  const btnPasteHeader = document.createElement("button");
  btnPasteHeader.type = "button";
  btnPasteHeader.className = "hp-btn";
  btnPasteHeader.title = "Вставить из буфера в корень";
  btnPasteHeader.textContent = "📥";
  btnPasteHeader.style.opacity = "0.45";

  headerActions.insertBefore(btnPasteHeader, headerActions.firstChild);
  headerActions.insertBefore(btnCopyHeader, headerActions.firstChild);

  // Инициализация кнопки сворачивания дерева в компактную вертикальную полоску
  function initCompactToggle() {
    const workspace = document.querySelector(".hp-workspace");
    if (!workspace || !headerActions) return;

    const btnCompact = document.createElement("button");
    btnCompact.type = "button";
    btnCompact.id = "hp-toggle-compact-btn";
    btnCompact.className = "hp-btn";
    btnCompact.title = "Свернуть дерево в компактную полоску";
    btnCompact.textContent = "◧";

    headerActions.appendChild(btnCompact);

    const COMPACT_STORAGE_KEY = "hp_tree_compact_mode";
    if (localStorage.getItem(COMPACT_STORAGE_KEY) === "1") {
      workspace.classList.add("tree-compact");
      btnCompact.classList.add("active");
    }

    btnCompact.addEventListener("click", () => {
      const isCompact = workspace.classList.toggle("tree-compact");
      btnCompact.classList.toggle("active", isCompact);
      btnCompact.title = isCompact
        ? "Развернуть структуру проекта"
        : "Свернуть дерево в компактную полоску";
      localStorage.setItem(COMPACT_STORAGE_KEY, isCompact ? "1" : "0");
    });
  }

  async function loadData() {
    try {
      const res = await fetch(DATA_URL);
      treeData = res.ok ? await res.json() : [];
    } catch (e) {
      treeData = [];
    }
    if (!Array.isArray(treeData)) treeData = [];
    if (treeData.length > 0 && !selectedId) {
      selectedId = treeData[0].id;
    }
    renderTree();
    renderInspector();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (typeof window.saveTabData === "function") {
        window.saveTabData(DATA_URL, treeData);
      }
    }, 350);
  }

  function findNode(nodes, id) {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children && node.children.length) {
        const found = findNode(node.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  // Извлекает узел из дерева и возвращает его (нужно для перетаскивания)
  function extractNodeById(nodes, id) {
    const idx = nodes.findIndex((n) => n.id === id);
    if (idx !== -1) {
      return nodes.splice(idx, 1)[0];
    }
    for (const node of nodes) {
      if (node.children) {
        const extracted = extractNodeById(node.children, id);
        if (extracted) return extracted;
      }
    }
    return null;
  }

  // Проверка: не является ли targetId потомком parentNode (защита от зацикливания)
  function isDescendant(parentNode, targetId) {
    if (!parentNode.children) return false;
    for (const child of parentNode.children) {
      if (child.id === targetId || isDescendant(child, targetId)) return true;
    }
    return false;
  }

  // Глубокое клонирование ветки с генерацией новых ID
  function cloneBranch(node, isRootClone = true) {
    const copy = JSON.parse(JSON.stringify(node));
    copy.id = "node_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
    if (isRootClone) {
      copy.title = (copy.title || "Элемент") + " (копия)";
    }
    if (Array.isArray(copy.children)) {
      copy.children = copy.children.map((ch) => cloneBranch(ch, false));
    }
    return copy;
  }

  function copyNodeToClipboard(node) {
    if (!node) return;
    clipboardNode = JSON.parse(JSON.stringify(node));
    btnPasteHeader.style.opacity = "1";
    renderTree();
    if (typeof window.showDockToast === "function") {
      window.showDockToast(
        "📋 Скопировано в буфер",
        `Элемент «${node.title}» готов к вставке.`,
        3000,
      );
    }
  }

  function pasteFromClipboard(targetParentNode = null) {
    if (!clipboardNode) return;
    const cloned = cloneBranch(clipboardNode, true);
    if (targetParentNode) {
      if (!Array.isArray(targetParentNode.children))
        targetParentNode.children = [];
      targetParentNode.children.push(cloned);
      targetParentNode.expanded = true;
    } else {
      treeData.push(cloned);
    }
    selectedId = cloned.id;
    renderTree();
    renderInspector();
    scheduleSave();
  }

  function calcProgress(node) {
    if (!node.children || node.children.length === 0) {
      return node.done ? 100 : 0;
    }
    let total = 0;
    let completed = 0;
    function walk(list) {
      for (const item of list) {
        total++;
        if (item.done) completed++;
        if (item.children && item.children.length) walk(item.children);
      }
    }
    walk(node.children);
    return total === 0 ? 0 : Math.round((completed / total) * 100);
  }

  // Настройка шапки как зоны сброса для возврата элемента в корень
  if (treeHeader) {
    treeHeader.title =
      "Перетащите элемент сюда, чтобы вынести его в корень списка";
    treeHeader.addEventListener("dragover", (e) => {
      if (!draggedNodeId) return;
      e.preventDefault();
      treeHeader.classList.add("drag-over");
    });
    treeHeader.addEventListener("dragleave", () => {
      treeHeader.classList.remove("drag-over");
    });
    treeHeader.addEventListener("drop", (e) => {
      e.preventDefault();
      treeHeader.classList.remove("drag-over");
      if (!draggedNodeId) return;
      const moved = extractNodeById(treeData, draggedNodeId);
      if (moved) {
        treeData.push(moved);
        renderTree();
        scheduleSave();
      }
      draggedNodeId = null;
    });
  }


  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // =========================================================================
  // ОТРИСОВКА ДЕРЕВА ЭЛЕМЕНТОВ
  // =========================================================================

  function renderTree() {
    const searchVal = (document.getElementById("search-input")?.value || "")
      .toLowerCase()
      .trim();
    treeRoot.innerHTML = "";

    renderTreeLevel(treeData, 0, searchVal);

    if (typeof window.updateDockCounter === "function") {
      window.updateDockCounter();
    }
  }

  function renderTreeLevel(nodes, depth, searchVal) {
    for (const node of nodes) {
      const hasChildren =
        Array.isArray(node.children) && node.children.length > 0;
      const row = createTreeRow(node, depth, searchVal, hasChildren);

      treeRoot.appendChild(row);

      if (hasChildren && (node.expanded !== false || searchVal)) {
        renderTreeLevel(node.children, depth + 1, searchVal);
      }
    }
  }

  function createTreeRow(node, depth, searchVal, hasChildren) {
    const progress = calcProgress(node);
    const row = document.createElement("div");

    row.className =
      "hp-tree-row card-item" + (node.id === selectedId ? " selected" : "");
    if (hasChildren) {
      row.classList.add("has-children");
    }

    row.style.paddingLeft = 10 + depth * 20 + "px";
    row.draggable = true;

    if (node.color) {
      row.style.borderLeft = "4px solid " + node.color;
      row.style.setProperty("--node-color", node.color);
    }

    // Всплывающая подсказка для компактного режима
    const indentPrefix = depth > 0 ? "↳ ".repeat(depth) : "";
    row.title = `${indentPrefix}${node.title || "Без названия"}${node.type ? " [" + node.type + "]" : ""}`;

    // Фильтрация по поиску
    const matchesSearch =
      !searchVal ||
      (node.title || "").toLowerCase().includes(searchVal) ||
      (node.type || "").toLowerCase().includes(searchVal) ||
      (node.tags || "").toLowerCase().includes(searchVal) ||
      (node.markdown || "").toLowerCase().includes(searchVal);

    if (!matchesSearch) {
      row.style.display = "none";
    }

    // Подготовка HTML-фрагментов строки
    const cleanTitle = (node.title || "••••").trim();
    const shortLabel = Array.from(cleanTitle).slice(0, 4).join("");

    const tagList = (node.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const tagsHtml = tagList.length
      ? '<div class="hp-row-tags">' +
        tagList
          .map(
            (t) => '<span class="hp-tag-pill">#' + escapeHtml(t) + "</span>",
          )
          .join("") +
        "</div>"
      : "";

    const showCb = node.showCheckbox !== false;
    const arrowClass = hasChildren ? "" : "empty";
    const arrowChar = node.expanded !== false ? "▾" : "▸";
    const checkedAttr = node.done ? "checked" : "";
    const titleClass = node.done && showCb ? "done" : "";
    const checkboxHtml = showCb
      ? '<input type="checkbox" class="hp-row-checkbox" ' + checkedAttr + ">"
      : "";
    const badgeHtml = node.type
      ? '<span class="hp-row-type-badge">' + escapeHtml(node.type) + "</span>"
      : "";
    const pasteBtnHtml = clipboardNode
      ? '<button type="button" class="hp-row-add-child" data-act="paste" title="Вставить из буфера внутрь">📥</button>'
      : "";

    row.innerHTML =
      '<span class="hp-compact-badge">' +
      escapeHtml(shortLabel) +
      "</span>" +
      '<span class="hp-toggle-arrow ' +
      arrowClass +
      '">' +
      arrowChar +
      "</span>" +
      checkboxHtml +
      '<span class="hp-row-title ' +
      titleClass +
      '">' +
      escapeHtml(node.title || "Без названия") +
      "</span>" +
      badgeHtml +
      tagsHtml +
      '<div class="hp-progress-track" title="Выполнено: ' +
      progress +
      '%">' +
      '<div class="hp-progress-fill" style="width: ' +
      progress +
      '%;"></div>' +
      "</div>" +
      '<div class="hp-row-actions">' +
      '<button type="button" class="hp-row-add-child" data-act="copy" title="Копировать ветку в буфер">📋</button>' +
      pasteBtnHtml +
      '<button type="button" class="hp-row-add-child" data-act="add" title="Добавить вложенный элемент">+</button>' +
      "</div>";

    attachRowDragEvents(row, node);
    attachRowActionEvents(row, node);

    return row;
  }

  function attachRowDragEvents(row, node) {
    row.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      draggedNodeId = node.id;
      e.dataTransfer.effectAllowed = "move";
    });

    row.addEventListener("dragend", () => {
      draggedNodeId = null;
      document
        .querySelectorAll(".drag-over")
        .forEach((el) => el.classList.remove("drag-over"));
    });

    row.addEventListener("dragover", (e) => {
      if (!draggedNodeId || draggedNodeId === node.id) return;
      const draggedNode = findNode(treeData, draggedNodeId);
      if (draggedNode && isDescendant(draggedNode, node.id)) return;
      e.preventDefault();
      e.stopPropagation();
      row.classList.add("drag-over");
    });

    row.addEventListener("dragleave", () => {
      row.classList.remove("drag-over");
    });

    row.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("drag-over");
      if (!draggedNodeId || draggedNodeId === node.id) return;
      const draggedNode = findNode(treeData, draggedNodeId);
      if (!draggedNode || isDescendant(draggedNode, node.id)) return;

      const moved = extractNodeById(treeData, draggedNodeId);
      if (moved) {
        if (!Array.isArray(node.children)) node.children = [];
        node.children.push(moved);
        node.expanded = true;
        renderTree();
        scheduleSave();
      }
      draggedNodeId = null;
    });
  }

  function attachRowActionEvents(row, node) {
    // Сворачивание ветки по стрелке
    row.querySelector(".hp-toggle-arrow").addEventListener("click", (e) => {
      e.stopPropagation();
      node.expanded = node.expanded === false ? true : false;
      renderTree();
      scheduleSave();
    });

    // Чекбокс выполнения
    const rowCb = row.querySelector(".hp-row-checkbox");
    if (rowCb) {
      rowCb.addEventListener("change", (e) => {
        e.stopPropagation();
        node.done = e.target.checked;
        if (node.id === selectedId) {
          fieldDone.checked = node.done;
          doneText.textContent = node.done ? "Выполнено" : "В работе";
        }
        renderTree();
        scheduleSave();
      });
    }

    // Кнопки действий (копировать, вставить, добавить подэлемент)
    row.querySelectorAll(".hp-row-add-child").forEach((btn) => {
      btn.style.opacity = "1";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === "copy") {
          copyNodeToClipboard(node);
        } else if (act === "paste") {
          pasteFromClipboard(node);
        } else if (act === "add") {
          if (!Array.isArray(node.children)) node.children = [];
          const newNode = createNewNode("Новый подэлемент");
          node.children.push(newNode);
          node.expanded = true;
          selectedId = newNode.id;
          isEditMode = true;
          renderTree();
          renderInspector();
          scheduleSave();
          fieldTitle.focus();
          fieldTitle.select();
        }
      });
    });

    // Выбор элемента по клику на строку
    row.addEventListener("click", () => {
      selectedId = node.id;
      renderTree();
      renderInspector();
    });
  }

  function renderInspector() {
    const node = findNode(treeData, selectedId);
    if (!node) {
      emptyState.style.display = "flex";
      inspector.style.display = "none";
      return;
    }

    emptyState.style.display = "none";
    inspector.style.display = "flex";

    fieldTitle.value = node.title || "";
    fieldType.value = node.type || "";
    fieldTags.value = node.tags || "";
    fieldDone.checked = Boolean(node.done);

    if (fieldShowCb) {
      fieldShowCb.checked = node.showCheckbox !== false;
    }

    doneText.textContent = node.done ? "Выполнено" : "В работе";
    mdEditor.value = node.markdown || "";

    colorDots.forEach((dot) => {
      dot.classList.toggle(
        "active",
        (dot.dataset.color || "") === (node.color || ""),
      );
    });

    updateViewMode();
  }

  function updateViewMode() {
    const node = findNode(treeData, selectedId);
    if (!node) return;

    if (isEditMode) {
      btnModeEdit.classList.add("active");
      btnModeView.classList.remove("active");
      editorToolbar.style.display = "flex";
      mdEditor.style.display = "block";
      mdPreview.style.display = "none";
    } else {
      btnModeView.classList.add("active");
      btnModeEdit.classList.remove("active");
      editorToolbar.style.display = "none";
      mdEditor.style.display = "none";
      mdPreview.style.display = "block";

      const rawMd =
        node.markdown ||
        "*Описание пока пустое. Нажмите «✏️ Редактор», чтобы заполнить.*";
      if (window.marked && typeof window.marked.parse === "function") {
        mdPreview.innerHTML = window.marked.parse(rawMd, {
          breaks: true,
          gfm: true,
        });
      } else {
        mdPreview.textContent = rawMd;
      }

      // Оживляем чекбоксы внутри отрендеренного Markdown
      const mdCheckboxes = mdPreview.querySelectorAll('input[type="checkbox"]');
      mdCheckboxes.forEach((cb, index) => {
        cb.disabled = false;
        cb.style.cursor = "pointer";
        cb.addEventListener("change", () => {
          let currentIdx = 0;
          node.markdown = (node.markdown || "").replace(
            /^(\s*[-*+]\s+\[)([ xX])(\])/gm,
            (match, prefix, state, suffix) => {
              if (currentIdx++ === index) {
                return prefix + (cb.checked ? "x" : " ") + suffix;
              }
              return match;
            },
          );
          mdEditor.value = node.markdown;
          scheduleSave();
        });
      });
    }
  }

  function createNewNode(title) {
    return {
      id: "node_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      title: title,
      type: "Note",
      tags: "",
      color: "",
      done: false,
      expanded: true,
      markdown:
        "### " +
        title +
        "\n\nОпишите детали элемента здесь.\n\n- [ ] Первый пункт\n- [ ] Второй пункт",
      children: [],
    };
  }

  btnCopyHeader.addEventListener("click", () => {
    const node = findNode(treeData, selectedId);
    if (!node) {
      alert("Сначала выберите элемент в списке");
      return;
    }
    copyNodeToClipboard(node);
  });

  fieldTitle.addEventListener("input", () => {
    const node = findNode(treeData, selectedId);
    if (!node) return;
    node.title = fieldTitle.value;
    renderTree();
    scheduleSave();
  });

  fieldType.addEventListener("input", () => {
    const node = findNode(treeData, selectedId);
    if (!node) return;
    node.type = fieldType.value;
    renderTree();
    scheduleSave();
  });

  btnPasteHeader.addEventListener("click", () => {
    if (!clipboardNode) {
      alert("Буфер пуст! Сначала нажмите 📋 на нужном элементе.");
      return;
    }
    pasteFromClipboard(null);
  });

  fieldTags.addEventListener("input", () => {
    const node = findNode(treeData, selectedId);
    if (!node) return;
    node.tags = fieldTags.value;
    renderTree();
    scheduleSave();
  });

  colorDots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const node = findNode(treeData, selectedId);
      if (!node) return;
      node.color = dot.dataset.color || "";
      colorDots.forEach((d) => d.classList.toggle("active", d === dot));
      renderTree();
      scheduleSave();
    });
  });

  fieldDone.addEventListener("change", () => {
    const node = findNode(treeData, selectedId);
    if (!node) return;
    node.done = fieldDone.checked;
    doneText.textContent = node.done ? "Выполнено" : "В работе";
    renderTree();
    scheduleSave();
  });

  if (fieldShowCb) {
    fieldShowCb.addEventListener("change", () => {
      const node = findNode(treeData, selectedId);
      if (!node) return;
      node.showCheckbox = fieldShowCb.checked;
      renderTree();
      scheduleSave();
    });
  }

  mdEditor.addEventListener("input", () => {
    const node = findNode(treeData, selectedId);
    if (!node) return;
    node.markdown = mdEditor.value;
    scheduleSave();
  });
  btnModeView.addEventListener("click", () => {
    isEditMode = false;
    updateViewMode();
  });

  btnModeEdit.addEventListener("click", () => {
    isEditMode = true;
    updateViewMode();
    mdEditor.focus();
  });

  document
    .getElementById("hp-insert-img-btn")
    .addEventListener("click", async () => {
      const node = findNode(treeData, selectedId);
      if (!node) return;
      try {
        const res = await fetch("/api/pick-path", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "img" }),
        });
        const data = await res.json();
        if (data.status === "ok" && data.path) {
          const imgUrl =
            "/api/local-image?path=" + encodeURIComponent(data.path);
          const mdSnippet = "\n![Изображение](" + imgUrl + ")\n";
          mdEditor.value += mdSnippet;
          node.markdown = mdEditor.value;
          scheduleSave();
        }
      } catch (e) {
        alert("Не удалось выбрать изображение");
      }
    });

  document.getElementById("hp-add-root-btn").addEventListener("click", () => {
    const newNode = createNewNode("Новая категория");
    treeData.push(newNode);
    selectedId = newNode.id;
    isEditMode = true;
    renderTree();
    renderInspector();
    scheduleSave();
    fieldTitle.focus();
    fieldTitle.select();
  });

  document
    .getElementById("hp-delete-node-btn")
    .addEventListener("click", () => {
      const node = findNode(treeData, selectedId);
      if (!node) return;
      if (!confirm("Удалить «" + node.title + "» и все вложенные элементы?"))
        return;
      extractNodeById(treeData, selectedId);
      selectedId = treeData.length > 0 ? treeData[0].id : null;
      renderTree();
      renderInspector();
      scheduleSave();
    });

  function setAllExpanded(nodes, state) {
    for (const n of nodes) {
      n.expanded = state;
      if (n.children) setAllExpanded(n.children, state);
    }
  }

  document.getElementById("hp-expand-all-btn").addEventListener("click", () => {
    setAllExpanded(treeData, true);
    renderTree();
    scheduleSave();
  });

  document
    .getElementById("hp-collapse-all-btn")
    .addEventListener("click", () => {
      setAllExpanded(treeData, false);
      renderTree();
      scheduleSave();
    });

  initCompactToggle();
  await loadData();
})();
