/**
 * foo-mobile.js - モバイルジェスチャー（全ページ共通）
 * 1. プルダウンで更新（Pull-to-refresh）
 * 2. 左端スワイプで戻る（Swipe back）
 */
(function() {
  'use strict';
  // モバイル判定
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (!isMobile) return;

  // ─── Pull-to-refresh ─────────────────────────────────────────
  let ptr_startY = 0;
  let ptr_currentY = 0;
  let ptr_pulling = false;
  let ptr_indicator = null;

  function createPtrIndicator() {
    if (ptr_indicator) return;
    ptr_indicator = document.createElement('div');
    ptr_indicator.id = 'foo-ptr';
    ptr_indicator.style.cssText = 'position:fixed;top:0;left:0;right:0;height:0;display:flex;align-items:center;justify-content:center;z-index:99999;overflow:hidden;transition:height 0.2s ease;pointer-events:none;';
    ptr_indicator.innerHTML = '<div style="font-size:13px;font-weight:600;color:#f0a500;opacity:0.8;">↓ 更新</div>';
    document.body.appendChild(ptr_indicator);
  }

  document.addEventListener('touchstart', function(e) {
    if (window.scrollY <= 0 && e.touches.length === 1) {
      ptr_startY = e.touches[0].clientY;
      ptr_pulling = true;
      createPtrIndicator();
    }
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!ptr_pulling) return;
    ptr_currentY = e.touches[0].clientY;
    const diff = ptr_currentY - ptr_startY;
    if (diff > 0 && diff < 150 && window.scrollY <= 0) {
      const h = Math.min(diff * 0.5, 60);
      ptr_indicator.style.height = h + 'px';
      if (h > 50) {
        ptr_indicator.firstChild.textContent = '↻ 離して更新';
        ptr_indicator.firstChild.style.color = '#22c55e';
      } else {
        ptr_indicator.firstChild.textContent = '↓ 更新';
        ptr_indicator.firstChild.style.color = '#f0a500';
      }
    }
  }, { passive: true });

  document.addEventListener('touchend', function() {
    if (!ptr_pulling) return;
    const diff = ptr_currentY - ptr_startY;
    ptr_pulling = false;
    if (ptr_indicator) {
      ptr_indicator.style.height = '0';
    }
    if (diff > 100 && window.scrollY <= 0) {
      location.reload();
    }
    ptr_startY = 0;
    ptr_currentY = 0;
  }, { passive: true });

  // ─── Swipe back（左端スワイプ） ──────────────────────────────
  let sb_startX = 0;
  let sb_startY = 0;
  let sb_swiping = false;
  let sb_overlay = null;

  function createSwipeOverlay() {
    if (sb_overlay) return;
    sb_overlay = document.createElement('div');
    sb_overlay.id = 'foo-swipe-back';
    sb_overlay.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100%;background:linear-gradient(90deg,rgba(240,165,0,0.15),transparent);z-index:99998;pointer-events:none;transition:width 0.15s ease;';
    sb_overlay.innerHTML = '<div style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:20px;opacity:0;transition:opacity 0.15s;">◀</div>';
    document.body.appendChild(sb_overlay);
  }

  document.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1 && e.touches[0].clientX < 25) {
      sb_startX = e.touches[0].clientX;
      sb_startY = e.touches[0].clientY;
      sb_swiping = true;
      createSwipeOverlay();
    }
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!sb_swiping) return;
    const dx = e.touches[0].clientX - sb_startX;
    const dy = Math.abs(e.touches[0].clientY - sb_startY);
    // 縦方向の動きが大きい場合はスワイプバックをキャンセル
    if (dy > 50) { sb_swiping = false; if (sb_overlay) sb_overlay.style.width = '0'; return; }
    if (dx > 0 && dx < 200) {
      sb_overlay.style.width = Math.min(dx, 100) + 'px';
      const arrow = sb_overlay.firstChild;
      if (dx > 80) {
        arrow.style.opacity = '1';
        arrow.style.color = '#f0a500';
      } else {
        arrow.style.opacity = String(dx / 120);
        arrow.style.color = '#888';
      }
    }
  }, { passive: true });

  document.addEventListener('touchend', function() {
    if (!sb_swiping) return;
    sb_swiping = false;
    if (sb_overlay) sb_overlay.style.width = '0';
    const dx = event.changedTouches[0].clientX - sb_startX;
    if (dx > 80) {
      history.back();
    }
    sb_startX = 0;
    sb_startY = 0;
  }, { passive: true });
})();
