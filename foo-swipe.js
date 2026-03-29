// ══════════════════════════════════════════════════════════════════════
// foo-swipe.js — 全ページ共通スワイプバック
// 左端からスワイプで「一つ前の状態」に戻る
// ══════════════════════════════════════════════════════════════════════

// ナビゲーションスタック: モーダルやステップを開く時に push
// fooNavPush(() => { モーダルを閉じる処理 }) のように使う
window._fooNavStack = window._fooNavStack || [];
function fooNavPush(backFn) { window._fooNavStack.push(backFn); }
function fooNavPop()        { if (window._fooNavStack.length) return window._fooNavStack.pop(); return null; }

(function initSwipeBack() {
  var startX = 0, startY = 0, swiping = false;
  var EDGE = 30;       // 左端30pxからのスワイプのみ
  var THRESHOLD = 80;  // 80px以上スワイプで発動

  document.addEventListener('touchstart', function(e) {
    var t = e.touches[0];
    if (t.clientX <= EDGE) {
      startX = t.clientX;
      startY = t.clientY;
      swiping = true;
    }
  }, { passive: true });

  document.addEventListener('touchend', function(e) {
    if (!swiping) return;
    swiping = false;
    var t = e.changedTouches[0];
    var dx = t.clientX - startX;
    var dy = Math.abs(t.clientY - startY);
    if (dx > THRESHOLD && dy < dx) {
      // スワイプバック発動
      var backFn = fooNavPop();
      if (backFn) {
        try { backFn(); } catch(err) { console.warn('swipe back error:', err); }
      } else if (window._fooSwipeBack) {
        window._fooSwipeBack();
      } else {
        if (!fooCloseTopOverlay()) {
          window.location.href = 'index.html';
        }
      }
    }
  }, { passive: true });
})();

// 画面上に開いているオーバーレイ/モーダルを自動検出して閉じる
// 対応パターン:
//   - .show / .open クラス付きのオーバーレイ → クラス除去
//   - .hidden クラスなしのオーバーレイ → .hidden 追加
//   - style.display = 'flex'/'block' → display = 'none'
function fooCloseTopOverlay() {
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  // position:fixed で画面の50%以上を覆い、z-index >= 50 の要素を候補にする
  var selectors = '.overlay, .modal-overlay, .neg-modal-wrap, .dial-overlay, .ss-overlay, .form-overlay, .detail-overlay, .ship-detail-overlay, [class*="overlay"], [class*="modal"]';
  var candidates = [];

  // まずクラス名ベースで探す（高速）
  var els = document.querySelectorAll(selectors);
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var st = getComputedStyle(el);
    if (st.position === 'fixed' && st.display !== 'none' && el.offsetWidth > vw * 0.4 && el.offsetHeight > vh * 0.3) {
      candidates.push(el);
    }
  }

  // クラス名で見つからなければ全要素スキャン（フォールバック）
  if (!candidates.length) {
    var all = document.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
      var el2 = all[j];
      var st2 = getComputedStyle(el2);
      if (st2.position === 'fixed' && st2.display !== 'none'
          && parseInt(st2.zIndex || 0) >= 50
          && el2.offsetWidth > vw * 0.4 && el2.offsetHeight > vh * 0.3) {
        candidates.push(el2);
      }
    }
  }

  if (!candidates.length) return false;

  // z-indexが最も高いものを選ぶ
  candidates.sort(function(a, b) {
    return (parseInt(getComputedStyle(b).zIndex) || 0) - (parseInt(getComputedStyle(a).zIndex) || 0);
  });
  var top = candidates[0];

  // 閉じ方を判定
  if (top.classList.contains('show'))    { top.classList.remove('show');    return true; }
  if (top.classList.contains('open'))    { top.classList.remove('open');    return true; }
  if (top.classList.contains('visible')) { top.classList.remove('visible'); return true; }
  // .hidden パターン（sanfre-ticket等）
  if (top.className && top.className.indexOf('hidden') === -1 && top.classList) {
    // 対応するパネルも閉じる（overlay + panel ペア）
    var panel = top.nextElementSibling;
    if (panel && (panel.classList.contains('open') || panel.classList.contains('show'))) {
      panel.classList.remove('open');
      panel.classList.remove('show');
    }
  }
  // style.display 直接指定パターン
  top.style.display = 'none';
  return true;
}
