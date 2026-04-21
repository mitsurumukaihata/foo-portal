// 進捗ログNotionページに今日の作業記録を追記
import https from 'https';

const PAGE_ID = 'b27bf4d01ee74d9faed192cbb8a68f2b';
const WORKER = 'notion-proxy.33322666666mm.workers.dev';

function nf(method, p, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : '';
    const req = https.request({ hostname: WORKER, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => {
      let c = '';
      r.on('data', x => c += x);
      r.on('end', () => { try { res(JSON.parse(c)); } catch(e) { rej(new Error(c.slice(0, 300))); } });
    });
    req.on('error', rej);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    if (d) req.write(d);
    req.end();
  });
}

// 子ブロックを取得して、最後のブロックを特定（appendは最後に追加される）
// append 子ブロック API: PATCH /blocks/{page_id}/children

const entries = [
  // 2026/4/15 昼
  '**2026/4/15** f.o.oパック契約管理アプリ新設 (foo-pack-admin.html):',
  '\tNotion DB: 📦 f.o.oパック契約 (8f7b92b3be4a4ac0832de8b53190c6b5)',
  '\t19プロパティ: 契約番号/得意先名/得意先リレーション/商品区分/タイヤサイズ/車番/契約日/リース期間/期間月数/契約総額/残価/月額税込・税抜・消費税/最終月3種/状態/メモ',
  '\t60回支払スケジュール自動生成、経過月数プログレスバー、残額自動計算',
  '\tUI: 事務テーマ、検索・商品区分・状態フィルタ、カードビュー、編集モーダル、月額税込から税抜・消費税を自動計算（切り捨て方式で弥生と統一）',
  '\tアクセス制限: 向畑充 + 岡崎のみ（index.html の APP_DEFS に nameWhitelist プロパティ新設）',
  '**2026/4/15** f.o.oパック契約 全44契約を初回インポート（CLO30 + 他14）→ 得意先リレーション修正 → 売上明細から完全再構築:',
  '\t- 初回: CLO 30契約 + K&M/アオイ/シンヨー/テイクス/ヨシダ/建機/彩希運送 14契約',
  '\t- 得意先リレーション修正: property名ミス(顧客名→得意先名)、全角＆→半角 正規化、8社すべてマッチ',
  '\t- 売上明細36ヶ月スキャン: 275ユニーク契約抽出 → 高宮+イドムマージで219契約',
  '\t- 全44契約アーカイブ → 219契約を売上明細ベースで再登録',
  '\t- IDM(高宮→イドム統合) 174 / CLO 25 / 彩希 9 / アオイ 6 / 建機 2 / K&M・シンヨー・テイクス 各1',
  '\t- 月額・リース期間・車番すべて売上明細から自動抽出',
  '\t- 商品区分自動判定 (FOOTB/FOOLTL/FOOLT/FOOLTS)',
  '\t- 状態自動判定（直近3ヶ月請求あり→有効 / リース終了日過ぎ→満期）',
  '\t- 得意先マスタとのリレーション自動設定',
  '',
  '**2026/4/15-16 夜** 弥生3帳票（売上明細/商品別日報/得意先別日報）全36ヶ月の完全照合プロジェクト:',
  '\t【準備】 売上明細全36ヶ月のファイル場所確認（月次・四半期・年単位バンドルの3形式）',
  '\t【発見】 弥生ソフト自身の3帳票が既に内部で数円〜数十円の不一致（集計方式差）',
  '\t【スクリプト群整備】 scripts/sales-migration/:',
  '\t- _compare-reports.mjs: 全36ヶ月横断チェック',
  '\t- _analyze-diff-by-code.mjs: 商品コード別差額分解',
  '\t- _fix-slip-totals.mjs: バンドルファイル対応、リトライ強化',
  '\t- _verify-month.mjs: バンドルファイル対応',
  '\t- migrate-sales.mjs: --target-year/month フィルタ追加、リトライ強化（ECONNABORTED対策）',
  '\t- _phase-a.mjs/_phase-bc.mjs/_phase-b-resume.mjs/_phase-d-final.mjs: Phase別パイプライン',
  '\t- _delete-month.mjs: 月指定で売上伝票+明細を一括削除',
  '\t【Phase A】既移行12ヶ月 (2025/4-2026/3) の fix+verify+code diff 完了',
  '\t  - 正常月（丸め誤差のみ）: 2025/4,5,7,9,12 / 2026/1,2 → 差額 -18〜-32円',
  '\t  - 異常月: 2025/6 (-17,522) / 2025/8 (+10,278) / 2025/10 (+61,470) / 2025/11 (+24,072) / 2026/3 (HT02問題) → 夜に調査',
  '\t【Phase B】2024/4-2025/3 の12ヶ月を年単位バンドル売上明細から月別抽出して移行',
  '\t  - 2024/4: 372件 / 2024/5-10: 各170〜300件 投入済',
  '\t  - 2024/8: 明細1件欠落で -296,512円差（リトライ失敗で1明細ロスト）→ 要調査',
  '\t  - 2024/11-2025/3: 再開スクリプトで進行中',
  '\t【HT02問題の完全特定】 2026/3 伝票00003978 (TOYO) で廃タイヤ HT02 単価700円×19本の誤入力（本来0円の"お知らせ"扱い） = 13,300円差',
  '\t【FOOパック丸め誤差の特定】 各月-1〜30円レベルは弥生ソフトの税抜計算（税込÷1.1）での四捨五入差',
  '',
  '**2026/4/15-16 未着手（今夜予定）**:',
  '\t- Phase C: 2023/4-2024/3 の12ヶ月を四半期バンドルから新規移行',
  '\t- 異常値月の調査・修復: 2025/6,8,10,11 / 2024/8,9 / 2026/3',
  '\t- Phase D: 全36ヶ月の最終統合レポート作成',
];

async function main() {
  const children = entries.map(text => {
    // タブで始まるならインデント子要素
    let content = text;
    let level = 0;
    while (content.startsWith('\t')) { level++; content = content.slice(1); }
    return {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: parseMarkdown(content),
      },
    };
  });

  // Notion API append children (50 blocks per request)
  const CHUNK = 50;
  for (let i = 0; i < children.length; i += CHUNK) {
    const chunk = children.slice(i, i + CHUNK);
    try {
      const r = await nf('PATCH', `/blocks/${PAGE_ID}/children`, { children: chunk });
      if (r.object === 'error') throw new Error(r.message);
      console.log(`✓ ブロック ${i+1}〜${Math.min(i+CHUNK, children.length)} / ${children.length} 追記`);
    } catch(e) {
      console.log('❌', e.message);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('完了');
}

// 簡易マークダウン→Notion rich_text パーサ（**bold** に対応）
function parseMarkdown(text) {
  const result = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIdx = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      result.push({ type: 'text', text: { content: text.slice(lastIdx, match.index) } });
    }
    result.push({ type: 'text', text: { content: match[1] }, annotations: { bold: true } });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    result.push({ type: 'text', text: { content: text.slice(lastIdx) } });
  }
  return result.length ? result : [{ type: 'text', text: { content: text || ' ' } }];
}

main();
