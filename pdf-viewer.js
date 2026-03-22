/**
 * f.o.o ポータル共通PDFビューア (pdf.js ベース)
 *
 * 使い方:
 *   await FooPdfViewer.open(pdfUrl, { title, notionUrl });
 *   FooPdfViewer.close();
 */
(function () {
  'use strict';

  const LIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
  const WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

  let pdfjsLib = null;
  let _libLoading = null;

  // ── state ──
  let _pdfDoc = null;
  let _currentPage = 1;
  let _totalPages = 0;
  let _scale = 1.0;
  let _rendering = false;
  let _pendingPage = null;
  let _pinchStartDist = 0;
  let _pinchStartScale = 0;

  // ── DOM refs (lazy-created) ──
  let _overlay, _canvas, _ctx, _toolbar, _pageInfo, _titleEl, _notionBtn, _loadingEl, _errorEl;
  let _created = false;

  // ── Load pdf.js dynamically ──
  async function loadLib() {
    if (pdfjsLib) return;
    if (_libLoading) return _libLoading;
    _libLoading = (async () => {
      pdfjsLib = await import(LIB_URL);
      pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
    })();
    return _libLoading;
  }

  // ── Create overlay DOM ──
  function createDOM() {
    if (_created) return;
    _created = true;

    const html = `
<div id="foo-pdf-overlay" style="display:none;position:fixed;inset:0;z-index:9000;background:#111;flex-direction:column;max-width:480px;margin:0 auto;">
  <!-- Header -->
  <div style="background:#0a0a0f;padding:10px 14px;display:flex;align-items:center;gap:8px;flex-shrink:0;border-bottom:0.5px solid #333;">
    <button id="fpv-close" style="background:none;border:none;color:#f0a500;font-size:24px;cursor:pointer;padding:0 4px;font-family:inherit;line-height:1;">‹</button>
    <div id="fpv-title" style="flex:1;font-size:13px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">PDF</div>
    <a id="fpv-notion" href="#" target="_blank" style="background:none;border:1px solid #444;border-radius:16px;padding:4px 10px;color:#999;font-size:11px;text-decoration:none;white-space:nowrap;display:flex;align-items:center;gap:4px;flex-shrink:0;">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      Notion
    </a>
  </div>

  <!-- Toolbar -->
  <div id="fpv-toolbar" style="background:#0d0d12;padding:6px 14px;display:flex;align-items:center;justify-content:space-between;gap:6px;flex-shrink:0;border-bottom:0.5px solid #222;">
    <div style="display:flex;align-items:center;gap:4px;">
      <button id="fpv-prev" class="fpv-tb" title="前のページ">◂</button>
      <span id="fpv-pageinfo" style="font-size:11px;color:#888;min-width:60px;text-align:center;">1 / 1</span>
      <button id="fpv-next" class="fpv-tb" title="次のページ">▸</button>
    </div>
    <div style="display:flex;align-items:center;gap:4px;">
      <button id="fpv-zoomout" class="fpv-tb" title="縮小">−</button>
      <span id="fpv-zoominfo" style="font-size:11px;color:#888;min-width:40px;text-align:center;">100%</span>
      <button id="fpv-zoomin" class="fpv-tb" title="拡大">＋</button>
      <button id="fpv-fit" class="fpv-tb" title="幅に合わせる" style="font-size:10px;">↔</button>
    </div>
  </div>

  <!-- Canvas area -->
  <div id="fpv-canvas-wrap" style="flex:1;overflow:auto;-webkit-overflow-scrolling:touch;background:#222;display:flex;align-items:flex-start;justify-content:center;padding:8px;">
    <canvas id="fpv-canvas" style="display:block;max-width:none;box-shadow:0 2px 20px rgba(0,0,0,0.5);"></canvas>
  </div>

  <!-- Loading -->
  <div id="fpv-loading" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#111;z-index:10;">
    <div style="width:28px;height:28px;border:2.5px solid #333;border-top-color:#f0a500;border-radius:50%;animation:fpvspin 0.8s linear infinite;"></div>
    <div style="font-size:13px;color:#666;">PDFを読み込み中...</div>
  </div>

  <!-- Error -->
  <div id="fpv-error" style="display:none;position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:30px;background:#111;z-index:10;text-align:center;">
    <div style="font-size:40px;">📄</div>
    <div id="fpv-error-msg" style="font-size:13px;color:#888;line-height:1.7;">PDFの読み込みに失敗しました。</div>
    <a id="fpv-error-btn" href="#" target="_blank" style="background:#f0a500;border:none;border-radius:10px;padding:12px 24px;color:#fff;font-size:14px;font-weight:700;text-decoration:none;">Notionで開く</a>
  </div>
</div>
<style>
@keyframes fpvspin { to { transform: rotate(360deg); } }
.fpv-tb {
  background: #1a1a22; border: 1px solid #333; border-radius: 6px;
  color: #ccc; font-size: 16px; width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-family: inherit; padding: 0;
  -webkit-tap-highlight-color: transparent;
}
.fpv-tb:active { background: #2a2a35; }
</style>`;

    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

    _overlay   = document.getElementById('foo-pdf-overlay');
    _canvas    = document.getElementById('fpv-canvas');
    _ctx       = _canvas.getContext('2d');
    _toolbar   = document.getElementById('fpv-toolbar');
    _pageInfo  = document.getElementById('fpv-pageinfo');
    _titleEl   = document.getElementById('fpv-title');
    _notionBtn = document.getElementById('fpv-notion');
    _loadingEl = document.getElementById('fpv-loading');
    _errorEl   = document.getElementById('fpv-error');

    // Event listeners
    document.getElementById('fpv-close').addEventListener('click', close);
    document.getElementById('fpv-prev').addEventListener('click', () => goPage(_currentPage - 1));
    document.getElementById('fpv-next').addEventListener('click', () => goPage(_currentPage + 1));
    document.getElementById('fpv-zoomin').addEventListener('click', () => setZoom(_scale + 0.25));
    document.getElementById('fpv-zoomout').addEventListener('click', () => setZoom(_scale - 0.25));
    document.getElementById('fpv-fit').addEventListener('click', fitWidth);

    // Swipe navigation
    let _touchStartX = 0;
    let _touchStartY = 0;
    const canvasWrap = document.getElementById('fpv-canvas-wrap');

    canvasWrap.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        _pinchStartDist = getTouchDist(e.touches);
        _pinchStartScale = _scale;
      } else if (e.touches.length === 1) {
        _touchStartX = e.touches[0].clientX;
        _touchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    canvasWrap.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const dist = getTouchDist(e.touches);
        const ratio = dist / _pinchStartDist;
        setZoom(_pinchStartScale * ratio, true);
      }
    }, { passive: true });

    canvasWrap.addEventListener('touchend', (e) => {
      if (e.changedTouches.length === 1 && _pinchStartDist === 0) {
        const dx = e.changedTouches[0].clientX - _touchStartX;
        const dy = e.changedTouches[0].clientY - _touchStartY;
        if (Math.abs(dx) > 60 && Math.abs(dy) < 40) {
          if (dx < 0) goPage(_currentPage + 1);
          else goPage(_currentPage - 1);
        }
      }
      _pinchStartDist = 0;
    }, { passive: true });

    // Double tap to zoom
    let _lastTap = 0;
    canvasWrap.addEventListener('touchend', (e) => {
      if (e.changedTouches.length !== 1) return;
      const now = Date.now();
      if (now - _lastTap < 300) {
        // Toggle between fit-width and 150%
        if (_scale > 1.2) fitWidth();
        else setZoom(1.5);
      }
      _lastTap = now;
    }, { passive: true });

    // Back button support
    window.addEventListener('popstate', () => {
      if (_overlay && _overlay.style.display !== 'none') {
        close();
        history.pushState(null, '', location.href);
      }
    });
  }

  function getTouchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ── Render page ──
  async function renderPage(num) {
    if (_rendering) { _pendingPage = num; return; }
    _rendering = true;

    try {
      const page = await _pdfDoc.getPage(num);
      const viewport = page.getViewport({ scale: _scale * (window.devicePixelRatio || 1) });
      _canvas.width = viewport.width;
      _canvas.height = viewport.height;
      _canvas.style.width = (viewport.width / (window.devicePixelRatio || 1)) + 'px';
      _canvas.style.height = (viewport.height / (window.devicePixelRatio || 1)) + 'px';

      await page.render({ canvasContext: _ctx, viewport }).promise;

      _currentPage = num;
      _pageInfo.textContent = num + ' / ' + _totalPages;
      document.getElementById('fpv-zoominfo').textContent = Math.round(_scale * 100) + '%';
    } catch (e) {
      console.error('PDF render error:', e);
    }

    _rendering = false;
    if (_pendingPage !== null) {
      const next = _pendingPage;
      _pendingPage = null;
      renderPage(next);
    }
  }

  function goPage(n) {
    if (n < 1 || n > _totalPages) return;
    renderPage(n);
    // Scroll canvas to top
    const wrap = document.getElementById('fpv-canvas-wrap');
    if (wrap) wrap.scrollTop = 0;
  }

  function setZoom(newScale, noBound) {
    if (!noBound) newScale = Math.max(0.5, Math.min(3.0, newScale));
    else newScale = Math.max(0.3, Math.min(5.0, newScale));
    _scale = newScale;
    renderPage(_currentPage);
  }

  function fitWidth() {
    if (!_pdfDoc) return;
    _pdfDoc.getPage(_currentPage).then(page => {
      const vp = page.getViewport({ scale: 1.0 });
      const wrapWidth = document.getElementById('fpv-canvas-wrap').clientWidth - 16;
      _scale = wrapWidth / vp.width;
      renderPage(_currentPage);
    });
  }

  // ── Public API ──
  async function open(pdfUrl, opts) {
    opts = opts || {};
    createDOM();

    // Show overlay + loading
    _overlay.style.display = 'flex';
    _loadingEl.style.display = 'flex';
    _errorEl.style.display = 'none';
    _canvas.style.display = 'none';
    _toolbar.style.display = 'flex';

    _titleEl.textContent = opts.title || 'PDF';
    if (opts.notionUrl) {
      _notionBtn.href = opts.notionUrl;
      _notionBtn.style.display = 'flex';
      document.getElementById('fpv-error-btn').href = opts.notionUrl;
    } else {
      _notionBtn.style.display = 'none';
    }

    history.pushState(null, '', location.href);

    try {
      await loadLib();

      const loadingTask = pdfjsLib.getDocument({
        url: pdfUrl,
        cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/cmaps/',
        cMapPacked: true,
      });

      // timeout
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
      _pdfDoc = await Promise.race([loadingTask.promise, timeout]);
      _totalPages = _pdfDoc.numPages;
      _currentPage = 1;

      // Calculate initial scale to fit width
      const page1 = await _pdfDoc.getPage(1);
      const vp = page1.getViewport({ scale: 1.0 });
      const wrapWidth = document.getElementById('fpv-canvas-wrap').clientWidth - 16;
      _scale = wrapWidth / vp.width;

      _loadingEl.style.display = 'none';
      _canvas.style.display = 'block';

      await renderPage(1);
    } catch (e) {
      console.error('PDF load error:', e);
      _loadingEl.style.display = 'none';
      _canvas.style.display = 'none';
      _toolbar.style.display = 'none';
      _errorEl.style.display = 'flex';
      document.getElementById('fpv-error-msg').textContent =
        e.message === 'timeout'
          ? '読み込みがタイムアウトしました。\nNotionで直接確認してください。'
          : 'PDFの読み込みに失敗しました。\nNotionで直接確認してください。';
    }
  }

  function close() {
    if (_overlay) _overlay.style.display = 'none';
    if (_pdfDoc) { _pdfDoc.destroy(); _pdfDoc = null; }
    _rendering = false;
    _pendingPage = null;
  }

  // Expose globally
  window.FooPdfViewer = { open, close };
})();
