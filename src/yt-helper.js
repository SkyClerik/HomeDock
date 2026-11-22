const currentScriptSrc = document.currentScript?.src;

document.addEventListener('DOMContentLoaded', async () => {
  const openBtn = document.getElementById('btn-open-yt');
  if (!openBtn) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'yt-modal-backdrop';
  backdrop.id = 'yt-helper-modal';

  try {
    const templateUrl = new URL('./yt-modal.html', currentScriptSrc || window.location.href);
    const response = await fetch(templateUrl);
    if (!response.ok) throw new Error('Не удалось загрузить yt-modal.html');
    backdrop.innerHTML = await response.text();
  } catch (err) {
    console.error('Ошибка загрузки yt-modal.html:', err);
    return;
  }

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
