// ══════════════════════════════════════════════════════════════════════
// foo-swipe.js — 全ページ共通スワイプバック（iOS対応）
// iOSのネイティブスワイプバック = history.back() = popstate を利用
// ══════════════════════════════════════════════════════════════════════

// ナビゲーションスタック: モーダルやステップを開く時に pushState + push
window._fooNavStack = window._fooNavStack || [];

// モーダル/ステップを開くときに呼ぶ
// → ブラウザ履歴にエントリを追加し、戻り関数をスタックに積む
function fooNavPush(backFn) {
  window._fooNavStack.push(backFn);
  history.pushState({ fooNav: window._fooNavStack.length }, '');
}

// popstate（ブラウザの戻る / iOSスワイプバック）で発火
window.addEventListener('popstate', function(e) {
  // スタックに戻り先があればそれを実行
  if (window._fooNavStack.length > 0) {
    var backFn = window._fooNavStack.pop();
    try { backFn(); } catch(err) { console.warn('swipe back error:', err); }
    return;
  }

  // スタック空 → 開いているオーバーレイがあれば閉じて履歴を戻さない
  if (fooCloseTopOverlay()) {
    // 閉じた分の履歴を再追加（戻りすぎ防止）
    history.pushState({ fooNav: 0 }, '');
    return;
  }

  // 何もなければブラウザのデフォルト動作（前のページへ）
});

// 画面上に開いているオーバーレイ/モーダルを自動検出して閉じる
function fooCloseTopOverlay() {
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  var selectors = '.overlay, .modal-overlay, .neg-modal-wrap, .dial-overlay, .ss-overlay, .form-overlay, .detail-overlay, .ship-detail-overlay, [class*="overlay"], [class*="modal"]';
  var candidates = [];

  var els = document.querySelectorAll(selectors);
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var st = getComputedStyle(el);
    if (st.position === 'fixed' && st.display !== 'none' && el.offsetWidth > vw * 0.4 && el.offsetHeight > vh * 0.3) {
      candidates.push(el);
    }
  }

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

  candidates.sort(function(a, b) {
    return (parseInt(getComputedStyle(b).zIndex) || 0) - (parseInt(getComputedStyle(a).zIndex) || 0);
  });
  var top = candidates[0];

  if (top.classList.contains('show'))    { top.classList.remove('show');    return true; }
  if (top.classList.contains('open'))    { top.classList.remove('open');    return true; }
  if (top.classList.contains('visible')) { top.classList.remove('visible'); return true; }

  var panel = top.nextElementSibling;
  if (panel && (panel.classList.contains('open') || panel.classList.contains('show'))) {
    panel.classList.remove('open');
    panel.classList.remove('show');
  }

  top.style.display = 'none';
  return true;
}
