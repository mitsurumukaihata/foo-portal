// ══════════════════════════════════════════════════════════════════════
// foo-common.js — auto-order.html / order.html 共通ユーティリティ
// ══════════════════════════════════════════════════════════════════════

// ─── 共通定数 ───────────────────────────────────────────────────────
const FOO_WORKER      = 'https://notion-proxy.33322666666mm.workers.dev';
const FOO_HACCHU_DB   = '202a695f8e8880aa92f6f38d9b47b537';          // 発注管理表DB
const FOO_HACCHUSHEET_DB = 'e400cc4f87f94af78392d794523894d9';       // 発注書（送付用）DB

// ─── 在庫DB 統一マップ ──────────────────────────────────────────────
// カテゴリ名 → 全情報（stockId, kijunId, wField, sizes, patterns, etc.）
// ※ key: order.html の DB_MAP 短縮キーとの互換用
const FOO_STOCK_DB_MAP = {
  'LTL TB　ノーマル': {
    key: 'ltl_normal',
    stockId: '200a695f8e888018b5f5eac83fdad412',
    kijunId: '520fe8fa034543428c0e9fff3c5cb511',
    wField:  '倉庫',
    name:    'LTL TB ノーマル',
    icon:    '🚛',
    sizes:   ['225/80R17.5','225/90R17.5','215/70R17.5 123/121','235/70R17.5','245/80R17.5','245/70R19.5','265/70R19.5','9R19.5','275/70R22.5','275/80R22.5','295/70R22.5','295/80R22.5','255/70R22.5','315/80R22.5','385/65R22.5','11R22.5','10R22.5'],
    patterns:['M646','M676','M125','M317','M323','M319','M320','M619','M626','M888','M899','M801','M746','R225','R241','G539','SP680','SP122','XJE4'],
  },
  'LTL TB　スタッドレス': {
    key: 'ltl_studless',
    stockId: '201a695f8e888171abb8e349ad4d055a',
    kijunId: '4e3a978bf93d466ea7c267085fe9d93b',
    wField:  '倉庫',
    name:    'LTL TB スタッドレス',
    icon:    '❄️',
    sizes:   ['225/80R17.5','225/90R17.5','215/70R17.5 123/121','235/70R17.5','245/80R17.5','245/70R19.5','265/70R19.5','9R19.5','275/70R22.5','275/80R22.5','295/70R22.5','295/80R22.5','255/70R22.5','315/80R22.5','385/65R22.5','11R22.5','10R22.5'],
    patterns:['M929','M919','M966','M920','M939','W910','W900S','W911','W970','W999','SP001','SP081','SP088','XDW'],
  },
  'LTS　ノーマル': {
    key: 'lts_normal',
    stockId: '201a695f8e8881adb144cd3a1639132d',
    kijunId: '2fea695f8e88813ca455d96295acc4c5',
    wField:  '倉庫',
    name:    'LTS ノーマル',
    icon:    '🚐',
    sizes:   ['175/75R15','185/65R15','185/75R15','195/75R15','195/85R15','205/80R15','185/70R16','185/85R16','195/85R16','205/65R16','205/70R16','225/70R16','205/75R16','205/85R16','215/85R16','225/85R16','195/60R17.5','195/70R17.5','205/60R17.5','225/60R17.5','205/70R17.5','205/80R17.5','215/70R17.5 118/116'],
    patterns:['M634','M135','M134e','M131','M319','M804','R207','SPLT50','SPLT21','SPLT22'],
  },
  'LTS　スタッドレス': {
    key: 'lts_studless',
    stockId: '201a695f8e8881a299e8fb57bad707f6',
    kijunId: '301a695f8e888161af6afe3e6636c3e3',
    wField:  '倉庫',
    name:    'LTS スタッドレス',
    icon:    '🌨️',
    sizes:   ['175/75R15','185/65R15','185/75R15','195/75R15','195/85R15','205/80R15','185/70R16','185/85R16','195/85R16','205/65R16','205/70R16','225/70R16','205/75R16','205/85R16','215/85R16','225/85R16','195/60R17.5','195/70R17.5','205/60R17.5','225/60R17.5','205/70R17.5','205/80R17.5','215/70R17.5 118/116'],
    patterns:['M935','M937','M934','LV01','W989','LT01'],
  },
  'RT 再生': {
    key: 'rt',
    stockId: '201a695f8e888104bb47c7103d5909dc',
    kijunId: '302a695f8e8881f49821faa32d2708b4',
    wField:  '倉庫',
    name:    'RT 再生',
    icon:    '♻️',
    sizes:   ['195/85R16','205/75R16','205/85R16','225/80R17.5','225/90R17.5','245/80R17.5','245/70R19.5','265/70R19.5','275/70R22.5','275/80R22.5','11R22.5 14P','11R22.5 16P'],
    patterns:['RTM919','RTM810','RTM804','RTM807','RTM81C-170','RTM890','RTW910','RTW911','RTW970','RTG610'],
  },
  'T/T チューブタイプ': {
    key: 'tt',
    stockId: '201a695f8e8881a6930fcf2bd752e676',
    kijunId: null,
    wField:  '倉庫',
    name:    'T/T チューブタイプ',
    icon:    '🔧',
    sizes:   ['7.00R15　10P','7.00R15　12P','6.50R16　10P','6.50R16　12P','7.00R16　10P','7.00R16　12P','7.50R16　12P','7.50R16　14P','8.25R16　14P'],
    patterns:['M634','M135','M134','M134e','M131','M319','M804','R207','SPLT50','SPLT21','SPLT22'],
  },
  'バン': {
    key: 'van',
    stockId: '201a695f8e8881f3a958cead42156e07',
    kijunId: '301a695f8e8881b7ad64e2cb9ad06e66',
    wField:  '出庫倉庫',
    name:    'バン',
    icon:    '🚌',
    sizes:   ['145/80R12　86/84','145/80R12　80/78','145R12　6P','145R12　8P','155R12　8P','165/80R13　90/88','165/80R13　94/93','165R13　6P','165R13　8P','145R13　6P','145R13　8P','155R13　6P','155R13　8P','175R13　8P','155/80R14　88/86','165/80R14　91/90','165/80R14　97/95','165R14　6P','165R14　8P','175/80R14　99/98','175R14　6P','175R14　8P','185/80R14　97N','185/80R14　102/10','185R14　6P','185R14　8P','195R14　8P','195/80R15　103/101','185/75R15　106/104','195/70R15　106/104','215/70R15　107/105','185/80R15　103/101','195/80R15　107/105','205/80R15　109/107'],
    patterns:['V03e','V02e','M935','K370','R710','V600','W300','W989','LV01','VL10A','VAN01','SV01'],
  },
  'リフト': {
    key: 'lift',
    stockId: '201a695f8e8881c5b2c3d9e9ce2ffd21',
    kijunId: null,
    wField:  '出庫倉庫',
    name:    'リフト',
    icon:    '🏗️',
    sizes:   ['4.00-8　8P','5.00-8　8P','6.00-9　10P','6.50-10　10P','4.50-12　8P','7.00-12　12P','7.00-12　14P','5.50-15　8P','6.00-15　10P','7.00-15MS','7.00-15','8.25-15','7.50-16','17*8.00-8　4P','18*7-8　8P','21*8-9　14P','23*9-10　16P','27*8.50-15　4P','27*8.50-15　6P','28*8-15　12P','28*9-15','250-15','300-15'],
    patterns:['G-8','G-8P','G-15'],
  },
};

// ─── 短縮キー → カテゴリ情報の逆引き ────────────────────────────────
// order.html の DB_MAP['ltl_normal'] 形式でアクセスするための互換レイヤー
const FOO_DB_BY_KEY = {};
for (const [cat, info] of Object.entries(FOO_STOCK_DB_MAP)) {
  FOO_DB_BY_KEY[info.key] = { ...info, category: cat, id: info.stockId };
}

// ─── カテゴリ名 → { id, wField } の互換レイヤー ────────────────────
// auto-order.html の CAT_DB_MAP 互換
function fooGetCatDbInfo(categoryName) {
  const info = FOO_STOCK_DB_MAP[categoryName];
  if (!info) return null;
  return { id: info.stockId, wField: info.wField };
}

// ─── カテゴリ名 → { kijunId, stockId, wField } の互換レイヤー ──────
// auto-order.html の KIJUN_DB_MAP 互換
function fooGetKijunDbInfo(categoryName) {
  const info = FOO_STOCK_DB_MAP[categoryName];
  if (!info || !info.kijunId) return null;
  return { kijunId: info.kijunId, stockId: info.stockId, wField: info.wField };
}

// ─── 区分符号マップ（在庫計算用）──────────────────────────────────
const FOO_KUBUN_SIGN = {
  '入庫':1, '移動入庫':1, '返品（倉庫へ）':1, '返品':1,
  '出庫':-1, '準備':-1, '移動出庫':-1, '返品（メーカーへ）':-1,
  '発注中':0, '繰越':1,
};

const FOO_WAREHOUSES = ['五日市倉庫','志和倉庫'];

// ─── 倉庫名正規化 ──────────────────────────────────────────────────
// 「五日市」→「五日市倉庫」、「志和」→「志和倉庫」 等
function fooWarehouseFull(short) {
  if (!short) return short;
  if (short.endsWith('倉庫')) return short;
  const map = { '五日市':'五日市倉庫', '志和':'志和倉庫', '海田':'海田倉庫', '未定':'未定' };
  return map[short] || short;
}
// 「五日市倉庫」→「五日市」（逆変換）
function fooWarehouseShort(full) {
  if (!full) return full;
  return full.replace(/倉庫$/, '');
}

// ══════════════════════════════════════════════════════════════════════
// Notion API 統一関数
// ══════════════════════════════════════════════════════════════════════

/**
 * Notion ページ作成（統一版）
 * @param {string} dbId - データベースID
 * @param {object} props - Notion properties オブジェクト
 * @returns {Promise<object>} 作成されたページ
 * @throws {Error} HTTP エラー or Notion API エラー
 */
async function fooNotionCreate(dbId, props) {
  const r = await fetch(`${FOO_WORKER}/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent: { database_id: dbId }, properties: props }),
  });
  if (!r.ok) throw new Error(await r.text());
  const data = await r.json();
  if (data.object === 'error') throw new Error(data.message || JSON.stringify(data));
  return data;
}

/**
 * Notion ページ更新（統一版）
 * @param {string} pageId - ページID
 * @param {object} props - 更新する properties
 * @returns {Promise<object>} 更新されたページ
 * @throws {Error} HTTP エラー or Notion API エラー
 */
async function fooNotionPatch(pageId, props) {
  const r = await fetch(`${FOO_WORKER}/pages/${pageId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: props }),
  });
  if (!r.ok) throw new Error(await r.text());
  const data = await r.json();
  if (data.object === 'error') throw new Error(data.message || JSON.stringify(data));
  return data;
}

/**
 * Notion DB クエリ（統一版）
 * @param {string} dbId - データベースID
 * @param {object} body - クエリボディ (filter, sorts, page_size 等)
 * @param {number} [timeout=25000] - タイムアウト(ms)
 * @returns {Promise<object>} クエリ結果
 * @throws {Error} HTTP エラー, Notion API エラー, タイムアウト
 */
async function fooNotionQuery(dbId, body, timeout) {
  timeout = timeout || 25000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(`${FOO_WORKER}/databases/${dbId}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    if (data.object === 'error') throw new Error(data.message || JSON.stringify(data));
    return data;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('タイムアウト(' + timeout + 'ms): /databases/' + dbId + '/query');
    throw e;
  }
}

/**
 * Notion 汎用リクエスト（GET等で使う）
 * @param {string} method - HTTP メソッド
 * @param {string} path - APIパス（例: /pages/xxx）
 * @param {object} [body] - リクエストボディ
 * @param {number} [timeout=25000] - タイムアウト(ms)
 * @returns {Promise<object>} レスポンスJSON
 */
async function fooNotionRequest(method, path, body, timeout) {
  timeout = timeout || 25000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(FOO_WORKER + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    if (data.object === 'error') throw new Error(data.message || JSON.stringify(data));
    return data;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('タイムアウト(' + timeout + 'ms): ' + path);
    throw e;
  }
}

// ══════════════════════════════════════════════════════════════════════
// パターン＋サイズからDB自動判定（order.html の detectDbKeys 統一版）
// ══════════════════════════════════════════════════════════════════════
function fooDetectDbKeys(sizeStr, patternStr) {
  const norm = str => (str || '').replace(/[\u3000\s]+/g, ' ').trim();
  const nSize = norm(sizeStr);

  const matched = [];
  for (const [cat, db] of Object.entries(FOO_STOCK_DB_MAP)) {
    const sizeMatch = db.sizes.some(s => {
      const ns = norm(s);
      return ns === nSize || nSize.includes(ns) || ns.includes(nSize);
    });
    const patternMatch = !patternStr || !db.patterns || db.patterns.includes(patternStr);
    if (sizeMatch && patternMatch) matched.push(db.key);
  }
  if (!matched.length) {
    for (const [cat, db] of Object.entries(FOO_STOCK_DB_MAP)) {
      if (db.sizes.some(s => {
        const ns = norm(s);
        return ns === nSize || nSize.includes(ns) || ns.includes(nSize);
      })) {
        matched.push(db.key);
      }
    }
  }
  return matched;
}

// ══════════════════════════════════════════════════════════════════════
// 在庫DB「発注中」レコード作成（共通）
// ══════════════════════════════════════════════════════════════════════

/**
 * 在庫DBに「発注中」レコードを1件作成
 * @param {object} params
 * @param {string} params.category    - カテゴリ名（例: 'LTS　ノーマル'）※ categoryかdbKeyどちらか必須
 * @param {string} [params.dbKey]     - DB短縮キー（例: 'lts_normal'）
 * @param {string} params.size        - サイズコード
 * @param {string} params.pattern     - パターン名
 * @param {string} params.warehouse   - 倉庫名（'五日市倉庫' or '志和倉庫' or 短縮形OK）
 * @param {number} params.qty         - 数量
 * @param {string} [params.creator]   - 作成者（デフォルト: '自動取込'）
 * @param {string} [params.memo]      - メモ
 * @returns {Promise<object>} 作成されたページ
 */
async function fooCreateStockOrder(params) {
  // DB情報の取得
  let dbInfo;
  if (params.category) {
    dbInfo = FOO_STOCK_DB_MAP[params.category];
  } else if (params.dbKey) {
    dbInfo = FOO_DB_BY_KEY[params.dbKey];
  }
  if (!dbInfo) throw new Error('DB不明: ' + (params.category || params.dbKey));

  const wh = fooWarehouseFull(params.warehouse || '');
  const creator = params.creator || '自動取込';
  const title = `${params.size} ${params.pattern} 発注中${wh ? ' ' + wh : ''}`;

  const props = {
    'タイトル':     { title: [{ text: { content: title } }] },
    'サイズコード': { select: { name: params.size } },
    'パターン名':   { select: { name: params.pattern } },
    '区分':         { select: { name: '発注中' } },
    '数量':         { number: params.qty },
    '作成者':       { select: { name: creator } },
  };
  if (wh) props[dbInfo.wField] = { select: { name: wh } };
  if (params.memo) {
    props['メモ'] = { rich_text: [{ text: { content: params.memo } }] };
  }

  return fooNotionCreate(dbInfo.stockId, props);
}

/**
 * 複数の在庫DB「発注中」レコードを並列作成（エラーを個別追跡）
 * @param {Array<object>} items - fooCreateStockOrder の params 配列
 * @returns {Promise<{ok:number, errors:string[]}>}
 */
async function fooCreateStockOrdersBatch(items) {
  const errors = [];
  const tasks = items.map(async item => {
    try {
      return await fooCreateStockOrder(item);
    } catch (e1) {
      // 1回リトライ（1秒待機）
      try {
        await new Promise(r => setTimeout(r, 1000));
        return await fooCreateStockOrder(item);
      } catch (e2) {
        errors.push(`${item.pattern} ${item.size}: ${e2.message}`);
        return null;
      }
    }
  });
  await Promise.all(tasks);
  return { ok: items.length - errors.length, errors };
}

// ══════════════════════════════════════════════════════════════════════
// 在庫DB「発注中」レコード削除（キャンセル時用）
// ══════════════════════════════════════════════════════════════════════

/**
 * 在庫DBから「発注中」レコードを検索してアーカイブ（削除）する
 * @param {object} params
 * @param {string} params.size      - サイズコード
 * @param {string} params.pattern   - パターン名
 * @param {string} [params.warehouse] - 倉庫名（指定があればフィルタ）
 * @param {number} [params.qty]     - 数量（指定があればその本数分だけ削除）
 * @returns {Promise<{deleted:number, errors:string[]}>}
 */
async function fooDeleteStockOrders(params) {
  const dbKeys = fooDetectDbKeys(params.size, params.pattern);
  if (!dbKeys.length) return { deleted: 0, errors: ['該当DBが見つかりません: ' + params.size + ' ' + params.pattern] };

  const wh = params.warehouse ? fooWarehouseFull(params.warehouse) : null;
  let deleted = 0;
  const errors = [];

  for (const key of dbKeys) {
    const dbInfo = FOO_DB_BY_KEY[key];
    if (!dbInfo) continue;

    // 区分=発注中 & サイズコード一致 でクエリ
    const filter = {
      and: [
        { property: '区分', select: { equals: '発注中' } },
        { property: 'サイズコード', select: { equals: params.size } },
      ]
    };
    // パターン名フィルタ
    if (params.pattern) {
      filter.and.push({ property: 'パターン名', select: { equals: params.pattern } });
    }
    // 倉庫フィルタ
    if (wh && dbInfo.wField) {
      filter.and.push({ property: dbInfo.wField, select: { equals: wh } });
    }
    // 数量フィルタ：qty指定時は「その数量のレコードのみ」に絞り込む
    // （同一サイズ・パターン・倉庫の別注文のレコードを誤削除しないため）
    if (params.qty) {
      filter.and.push({ property: '数量', number: { equals: params.qty } });
    }

    try {
      const res = await fooNotionQuery(dbInfo.stockId, { filter, page_size: 100 });
      const pages = (res.results || []).filter(p => !p.archived);

      // qty指定あり→1件のみ削除（1注文=1レコードの原則）、なし→全件削除
      const targets = params.qty ? pages.slice(0, 1) : pages;

      for (const page of targets) {
        try {
          await fooNotionRequest('PATCH', '/pages/' + page.id, { archived: true });
          deleted++;
        } catch (e) {
          errors.push('アーカイブ失敗(' + page.id + '): ' + e.message);
        }
      }
    } catch (e) {
      errors.push('クエリ失敗(' + key + '): ' + e.message);
    }
  }

  return { deleted, errors };
}

// ══════════════════════════════════════════════════════════════════════
// プロパティ取得ヘルパー
// ══════════════════════════════════════════════════════════════════════
function fooPropStr(page, key) {
  try {
    const p = page.properties[key];
    if (!p) return '';
    if (p.type === 'title')     return (p.title     || []).map(t => t.plain_text).join('');
    if (p.type === 'rich_text') return (p.rich_text  || []).map(t => t.plain_text).join('');
    if (p.type === 'select')    return p.select?.name || '';
    if (p.type === 'number')    return String(p.number ?? '');
    if (p.type === 'date')      return p.date?.start || '';
    if (p.type === 'checkbox')  return p.checkbox ? 'true' : 'false';
  } catch (e) {}
  return '';
}

console.log('[foo-common.js] loaded — ' + Object.keys(FOO_STOCK_DB_MAP).length + ' categories');
