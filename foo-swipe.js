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
  let startX = 0, startY = 0, swiping = false;
  const EDGE = 30;       // 左端30pxからのスワイプのみ
  const THRESHOLD = 80;  // 80px以上スワイプで発動

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
function fooCloseTopOverlay() {
  var all = document.querySelectorAll('*');
  var candidates = [];
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var st = getComputedStyle(el);
    if (st.position === 'fixed' && st.display !== 'none' && parseInt(st.zIndex || 0) >= 1000 && el.offsetWidth > 0) {
      candidates.push(el);
    }
  }
  if (!candidates.length) return false;
  candidates.sort(function(a, b) {
    return (parseInt(getComputedStyle(b).zIndex) || 0) - (parseInt(getComputedStyle(a).zIndex) || 0);
  });
  candidates[0].style.display = 'none';
  return true;
}
