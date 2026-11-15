document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('btn-open-yt');
  if (!openBtn) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'yt-modal-backdrop';
  backdrop.id = 'yt-helper-modal';
  backdrop.innerHTML = `
    <div class="yt-modal">
      <div class="yt-modal-header">
        <h3>📺 YouTube Video Info</h3>
        <button type="button" class="yt-btn" id="yt-btn-close" title="Закрыть">✕</button>
      </div>

      <div class="yt-input-row">
        <input type="text" id="yt-edit-url" placeholder="Вставьте ссылку на YouTube видео (watch, youtu.be, shorts, embed)...">
        <button type="button" class="yt-btn primary" id="yt-btn-fetch">Получить</button>
      </div>

      <div class="yt-section-label">Основные данные</div>
      <div class="yt-input-row">
        <span class="yt-field-label">Video ID:</span>
        <input type="text" id="yt-txt-id" readonly>
        <button type="button" class="yt-btn yt-copy-btn" data-target="yt-txt-id">Копировать</button>
      </div>
      <div class="yt-input-row">
        <span class="yt-field-label">Watch URL:</span>
        <input type="text" id="yt-txt-watch" readonly>
        <button type="button" class="yt-btn yt-copy-btn" data-target="yt-txt-watch">Копировать</button>
      </div>

      <div class="yt-section-label">Превью (Thumbnails)</div>
      <div class="yt-input-row">
        <span class="yt-field-label">default:</span>
        <input type="text" id="yt-txt-def" readonly>
        <button type="button" class="yt-btn yt-copy-btn" data-target="yt-txt-def">Копировать</button>
      </div>
      <div class="yt-input-row">
        <span class="yt-field-label">hqdefault:</span>
        <input type="text" id="yt-txt-hq" readonly>
        <button type="button" class="yt-btn yt-copy-btn" data-target="yt-txt-hq">Копировать</button>
      </div>
      <div class="yt-input-row">
        <span class="yt-field-label">maxres:</span>
        <input type="text" id="yt-txt-max" readonly>
        <button type="button" class="yt-btn yt-copy-btn" data-target="yt-txt-max">Копировать</button>
      </div>

      <div class="yt-section-label">Данные из oEmbed</div>
      <div class="yt-input-row">
        <span class="yt-field-label">Title:</span>
        <input type="text" id="yt-txt-title" readonly>
        <button type="button" class="yt-btn yt-copy-btn" data-target="yt-txt-title">Копировать</button>
      </div>
      <div class="yt-input-row">
        <span class="yt-field-label">Author:</span>
        <input type="text" id="yt-txt-author" readonly>
        <button type="button" class="yt-btn yt-copy-btn" data-target="yt-txt-author">Копировать</button>
      </div>
      <div class="yt-input-row">
        <span class="yt-field-label">Channel:</span>
        <input type="text" id="yt-txt-channel" readonly>
        <button type="button" class="yt-btn yt-copy-btn" data-target="yt-txt-channel">Копировать</button>
      </div>

      <div class="yt-preview-box" id="yt-preview-box" style="display: none;">
        <img id="yt-preview-img" referrerpolicy="no-referrer" alt="Preview">
        <div class="yt-preview-meta">
          <strong id="yt-preview-title" style="font-size: 13px; color: #fff;"></strong>
          <span id="yt-preview-author" style="font-size: 12px; color: #9ca3af;"></span>
        </div>
      </div>

      <div class="yt-modal-footer">
        <div class="yt-status-bar" id="yt-status">Готов. Вставьте ссылку и нажмите «Получить».</div>
        <button type="button" class="yt-btn primary" id="yt-btn-copy-card" title="Скопировать как JSON-карточку для кнопки «Вставить»">📋 Скопировать как карточку</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const editUrl = document.getElementById('yt-edit-url');
  const txtId = document.getElementById('yt-txt-id');
  const txtWatch = document.getElementById('yt-txt-watch');
  const txtDef = document.getElementById('yt-txt-def');
  const txtHq = document.getElementById('yt-txt-hq');
  const txtMax = document.getElementById('yt-txt-max');
  const txtTitle = document.getElementById('yt-txt-title');
  const txtAuthor = document.getElementById('yt-txt-author');
  const txtChannel = document.getElementById('yt-txt-channel');
  const statusEl = document.getElementById('yt-status');
  const previewBox = document.getElementById('yt-preview-box');
  const previewImg = document.getElementById('yt-preview-img');

  function extractYouTubeId(url) {
    let m = url.match(/[?&]v=([^&#]+)/);
    if (m && m.length > 1) return m.pop();
    m = url.match(/:\/\/youtu\.be\/([^?&#/]+)/);
    if (m && m.length > 1) return m.pop();
    m = url.match(/\/embed\/([^?&#/]+)/);
    if (m && m.length > 1) return m.pop();
    m = url.match(/\/shorts\/([^?&#/]+)/);
    if (m && m.length > 1) return m.pop();
    return '';
  }

  async function fetchVideoInfo() {
    const url = editUrl.value.trim();
    if (!url) {
      statusEl.textContent = '⚠️ Введите ссылку на YouTube-видео.';
      return;
    }

    const vid = extractYouTubeId(url);
    if (!vid) {
      statusEl.textContent = '❌ Ошибка: не удалось извлечь Video ID из ссылки.';
      return;
    }

    const ytHost = ['https://', 'www.', 'youtube', '.com'].join('');
    const imgHost = ['https://', 'img.', 'youtube', '.com/vi/'].join('');

    const watchUrl = ytHost + '/watch?v=' + vid;
    const defUrl = imgHost + vid + '/default.jpg';
    const hqUrl = imgHost + vid + '/hqdefault.jpg';
    const maxUrl = imgHost + vid + '/maxresdefault.jpg';

    txtId.value = vid;
    txtWatch.value = watchUrl;
    txtDef.value = defUrl;
    txtHq.value = hqUrl;
    txtMax.value = maxUrl;

    previewImg.src = hqUrl;
    previewBox.style.display = 'flex';
    document.getElementById('yt-preview-title').textContent = vid;
    document.getElementById('yt-preview-author').textContent = 'Загрузка oEmbed...';
    statusEl.textContent = '⏳ Получение данных oEmbed через сервер...';

    try {
      const res = await fetch('/api/yt-oembed?url=' + encodeURIComponent(watchUrl));
      const result = await res.json();

      if (result.status === 'ok' && result.data) {
        const info = result.data;
        txtTitle.value = info.title || '';
        txtAuthor.value = info.author_name || '';
        txtChannel.value = info.author_url || '';

        document.getElementById('yt-preview-title').textContent = info.title || vid;
        document.getElementById('yt-preview-author').textContent = info.author_name ? ('Автор: ' + info.author_name) : '';
        statusEl.textContent = '✅ Данные загружены.';
      } else {
        txtTitle.value = '';
        txtAuthor.value = '';
        txtChannel.value = '';
        document.getElementById('yt-preview-author').textContent = 'Нет данных oEmbed';
        statusEl.textContent = '⚠️ Базовые ссылки заполнены, oEmbed вернул ошибку: ' + (result.message || 'недоступно');
      }
    } catch (e) {
      statusEl.textContent = '⚠️ Базовые ссылки заполнены, нет связи с server.py.';
    }
  }


  openBtn.addEventListener('click', () => {
    backdrop.classList.add('open');
    editUrl.focus();
  });

  document.getElementById('yt-btn-close').addEventListener('click', () => {
    backdrop.classList.remove('open');
  });

  document.getElementById('yt-btn-fetch').addEventListener('click', fetchVideoInfo);
  editUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchVideoInfo();
  });

  backdrop.querySelectorAll('.yt-copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input || !input.value) return;
      try {
        await navigator.clipboard.writeText(input.value);
        const old = btn.textContent;
        btn.textContent = '✅';
        statusEl.textContent = 'Скопировано: ' + input.value;
        setTimeout(() => { btn.textContent = old; }, 1000);
      } catch (e) {
        statusEl.textContent = '❌ Не удалось скопировать в буфер.';
      }
    });
  });

  document.getElementById('yt-btn-copy-card').addEventListener('click', async () => {
    if (!txtWatch.value) {
      statusEl.textContent = '⚠️ Сначала получите данные видео.';
      return;
    }

    const authorLine = txtAuthor.value ? ('Канал: ' + txtAuthor.value) : '';
    const channelLine = txtChannel.value ? (' (' + txtChannel.value + ')') : '';

    const cardObj = {
      name: txtTitle.value || ('YouTube (' + txtId.value + ')'),
      url: txtWatch.value,
      icon: txtHq.value,
      category: 'YOUTUBE',
      tag: 'video',
      description: (authorLine + channelLine).trim()
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(cardObj, null, 2));
      const btn = document.getElementById('yt-btn-copy-card');
      const old = btn.textContent;
      btn.textContent = '✅ Карточка в буфере!';
      statusEl.textContent = '✅ Готовый JSON карточки скопирован. Нажмите «📥 Вставить» при создании карточки.';
      setTimeout(() => { btn.textContent = old; }, 1800);
    } catch (e) {
      statusEl.textContent = '❌ Не удалось скопировать JSON в буфер.';
    }
  });
});
