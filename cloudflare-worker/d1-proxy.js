// ════════════════════════════════════════════════════════════════
// D1 Proxy Layer for foo-portal
// Notion API /databases/{id}/query 互換のレスポンスを D1 から返す
// ════════════════════════════════════════════════════════════════

// Notion DB ID → D1 テーブル名 のマッピング
export const DB_ID_TO_TABLE = {
  'f632f512f12d49b2b11f2b3e45c70aec': '得意先マスタ',
  '1ca8d122be214e3892879932147143c9': '顧客情報DB',
  '21771ad9a3f0457ea97474b3499ca4a9': '商品マスタ',
  '16f9f0df45e942069e032715fb2d37b2': '車両マスタ',
  'f994513a5f5646d7bf1a65abe4067264': '仕入先マスタ',
  '58cc4a13df03435db14b3439ef1f0a6f': '売上伝票',
  '07bd22655e5849fd854bef1f4c4b5688': '売上明細',
  '1587357d69e047699615b962c7dab6db': '仕入伝票',
  '7a92c7ee74aa4edbb8f8fd78aca41952': '仕入明細',
  '200a695f8e8880b181d8c77b7dde51b5': '勤怠管理',
  'a43b48a848084be3bc16841ec0c8603a': '入金管理',
  '202a695f8e8880aa92f6f38d9b47b537': '発注管理',
};

// テーブル名 → 日付系プロパティ（filter/sort対応用）
const DATE_PROPERTIES = {
  '売上伝票': '売上日',
  '売上明細': null, // 売上伝票経由
  '仕入伝票': '仕入日',
  '仕入明細': null,
  '勤怠管理': '日付',
  '入金管理': '入金日',
  '発注管理': '発注日',
};

// テーブル名 → Notion形式に戻すときの property 情報
// { propName: { type: 'rich_text'|'number'|'checkbox'|'select'|'date'|'title'|'relation', fromCol: 'カラム名' } }
const NOTION_PROP_SCHEMA = {
  '得意先マスタ': {
    '得意先名': { type: 'title', col: '得意先名' },
    'ふりがな': { type: 'rich_text', col: 'ふりがな' },
    '弥生得意先コード': { type: 'rich_text', col: '弥生得意先コード' },
    '有効': { type: 'checkbox', col: '有効' },
    '取引区分': { type: 'select', col: '取引区分' },
    '住所': { type: 'rich_text', col: '住所' },
    'TEL': { type: 'rich_text', col: 'TEL' },
    'FAX': { type: 'rich_text', col: 'FAX' },
    'メモ': { type: 'rich_text', col: 'メモ' },
  },
  '顧客情報DB': {
    '顧客名': { type: 'title', col: '顧客名' },
    'ふりがな': { type: 'rich_text', col: 'ふりがな' },
    '住所': { type: 'rich_text', col: '住所' },
    'TEL': { type: 'rich_text', col: 'TEL' },
    'メモ': { type: 'rich_text', col: 'メモ' },
  },
  '商品マスタ': {
    '商品名': { type: 'title', col: '商品名' },
    '商品コード': { type: 'rich_text', col: '商品コード' },
    'タイヤサイズ': { type: 'rich_text', col: 'タイヤサイズ' },
    'タイヤ銘柄': { type: 'rich_text', col: 'タイヤ銘柄' },
    'メーカー': { type: 'select', col: 'メーカー' },
    '単価': { type: 'number', col: '単価' },
    'メモ': { type: 'rich_text', col: 'メモ' },
  },
  '車両マスタ': {
    '車番': { type: 'title', col: '車番' },
    '管理番号': { type: 'rich_text', col: '管理番号' },
    '顧客': { type: 'relation', col: '顧客ID' },
    '車種': { type: 'select', col: '車種' },
    '仕様': { type: 'rich_text', col: '仕様' },
    '前輪サイズ': { type: 'rich_text', col: '前輪サイズ' },
    '後輪サイズ': { type: 'rich_text', col: '後輪サイズ' },
    '前輪パターン': { type: 'rich_text', col: '前輪パターン' },
    '後輪パターン': { type: 'rich_text', col: '後輪パターン' },
    '本数': { type: 'number', col: '本数' },
    'カテゴリ': { type: 'select', col: 'カテゴリ' },
    'バルブ交換日': { type: 'date', col: 'バルブ交換日' },
    'メモ': { type: 'rich_text', col: 'メモ' },
  },
  '仕入先マスタ': {
    '仕入先名': { type: 'title', col: '仕入先名' },
    '仕入先コード': { type: 'rich_text', col: '仕入先コード' },
    '適格請求書事業者': { type: 'checkbox', col: '適格請求書事業者' },
    '登録番号': { type: 'rich_text', col: '登録番号' },
    'TEL': { type: 'rich_text', col: 'TEL' },
    '住所': { type: 'rich_text', col: '住所' },
    'メモ': { type: 'rich_text', col: 'メモ' },
  },
  '売上伝票': {
    '伝票タイトル': { type: 'title', col: '伝票タイトル' },
    '売上日': { type: 'date', col: '売上日' },
    '請求先': { type: 'relation', col: '請求先ID' },
    '顧客名': { type: 'relation', col: '顧客名ID' },
    '伝票種類': { type: 'select', col: '伝票種類' },
    '作業区分': { type: 'select', col: '作業区分' },
    '担当者': { type: 'select', col: '担当者' },
    '支払い方法': { type: 'select', col: '支払い方法' },
    '宛先敬称': { type: 'select', col: '宛先敬称' },
    '車番': { type: 'rich_text', col: '車番' },
    '管理番号': { type: 'rich_text', col: '管理番号' },
    '税抜合計': { type: 'number', col: '税抜合計' },
    '消費税合計': { type: 'number', col: '消費税合計' },
    '税込合計': { type: 'number', col: '税込合計' },
    'ステータス': { type: 'select', col: 'ステータス' },
    '備考': { type: 'rich_text', col: '備考' },
    '件名': { type: 'rich_text', col: '件名' },
    '要確認': { type: 'checkbox', col: '要確認' },
    '確認項目': { type: 'rich_text', col: '確認項目' },
    '伝票番号': { type: 'unique_id', col: '伝票番号' },
  },
  '売上明細': {
    '明細タイトル': { type: 'title', col: '明細タイトル' },
    '売上伝票': { type: 'relation', col: '売上伝票ID' },
    '商品コード': { type: 'rich_text', col: '商品コード' },
    '品目': { type: 'select', col: '品目' },
    'タイヤサイズ': { type: 'rich_text', col: 'タイヤサイズ' },
    'タイヤ銘柄': { type: 'rich_text', col: 'タイヤ銘柄' },
    '数量': { type: 'number', col: '数量' },
    '単位': { type: 'select', col: '単位' },
    '単価': { type: 'number', col: '単価' },
    '税区分': { type: 'select', col: '税区分' },
    '税額': { type: 'number', col: '税額' },
    '税込小計': { type: 'number', col: '税込小計' },
    '車番': { type: 'rich_text', col: '車番' },
    '備考': { type: 'rich_text', col: '備考' },
    '弥生備考': { type: 'rich_text', col: '弥生備考' },
  },
  '仕入伝票': {
    '伝票タイトル': { type: 'title', col: '伝票タイトル' },
    '仕入日': { type: 'date', col: '仕入日' },
    '入荷日': { type: 'date', col: '入荷日' },
    '弥生伝票番号': { type: 'rich_text', col: '弥生伝票番号' },
    '仕入先': { type: 'relation', col: '仕入先ID' },
    '担当者': { type: 'select', col: '担当者' },
    '税抜合計': { type: 'number', col: '税抜合計' },
    '消費税合計': { type: 'number', col: '消費税合計' },
    '税込合計': { type: 'number', col: '税込合計' },
    '仕入税額控除': { type: 'select', col: '仕入税額控除' },
    'ステータス': { type: 'select', col: 'ステータス' },
    '発注番号': { type: 'rich_text', col: '発注番号' },
    '備考': { type: 'rich_text', col: '備考' },
  },
  '仕入明細': {
    '明細タイトル': { type: 'title', col: '明細タイトル' },
    '仕入伝票': { type: 'relation', col: '仕入伝票ID' },
    '商品コード': { type: 'rich_text', col: '商品コード' },
    '品名': { type: 'rich_text', col: '品名' },
    'タイヤサイズ': { type: 'rich_text', col: 'タイヤサイズ' },
    '銘柄': { type: 'rich_text', col: '銘柄' },
    'メーカー': { type: 'select', col: 'メーカー' },
    '数量': { type: 'number', col: '数量' },
    '単位': { type: 'select', col: '単位' },
    '単価': { type: 'number', col: '単価' },
    '税込小計': { type: 'number', col: '税込小計' },
    '税額': { type: 'number', col: '税額' },
    '税区分': { type: 'select', col: '税区分' },
    '備考': { type: 'rich_text', col: '備考' },
  },
  '勤怠管理': {
    'タイトル': { type: 'title', col: 'タイトル' },
    '社員名': { type: 'select', col: '社員名' },
    '日付': { type: 'date', col: '日付' },
    '出勤': { type: 'number', col: '出勤' },
    '退勤': { type: 'number', col: '退勤' },
    '有給使用': { type: 'checkbox', col: '有給使用' },
    '有給使用時間': { type: 'number', col: '有給使用時間' },
    '欠勤': { type: 'checkbox', col: '欠勤' },
    '労災扱い': { type: 'checkbox', col: '労災扱い' },
    '指定休': { type: 'checkbox', col: '指定休' },
    '備考': { type: 'rich_text', col: '備考' },
  },
  '入金管理': {
    '入金日': { type: 'date', col: '入金日' },
    '請求先': { type: 'relation', col: '請求先ID' },
    '金額': { type: 'number', col: '金額' },
    '入金方法': { type: 'select', col: '入金方法' },
    '備考': { type: 'rich_text', col: '備考' },
  },
  '発注管理': {
    '発注日': { type: 'date', col: '発注日' },
    '納入予定日': { type: 'date', col: '納入予定日' },
    '納入予定場所': { type: 'select', col: '納入予定場所' },
    '商品コード': { type: 'rich_text', col: '商品コード' },
    'サイズコード': { type: 'rich_text', col: 'サイズコード' },
    'パターン名': { type: 'rich_text', col: 'パターン名' },
    '数量': { type: 'number', col: '数量' },
    '単価': { type: 'number', col: '単価' },
    '発注先': { type: 'rich_text', col: '発注先' },
    'ステータス': { type: 'select', col: 'ステータス' },
    '備考': { type: 'rich_text', col: '備考' },
  },
};

// ─── Notion filter → SQL WHERE 変換 ──────────────────────

function propToCol(tableName, propName) {
  const schema = NOTION_PROP_SCHEMA[tableName];
  if (schema && schema[propName]) return schema[propName].col;
  return propName; // そのまま（日本語カラム名）
}

function filterToSQL(tableName, filter, params = []) {
  if (!filter) return { where: '1=1', params };

  // AND / OR
  if (filter.and) {
    const parts = filter.and.map(f => filterToSQL(tableName, f, params));
    return { where: '(' + parts.map(p => p.where).join(' AND ') + ')', params };
  }
  if (filter.or) {
    const parts = filter.or.map(f => filterToSQL(tableName, f, params));
    return { where: '(' + parts.map(p => p.where).join(' OR ') + ')', params };
  }

  const propName = filter.property;
  const col = propToCol(tableName, propName);

  // text filters
  if (filter.rich_text || filter.title) {
    const tf = filter.rich_text || filter.title;
    if (tf.equals !== undefined) { params.push(tf.equals); return { where: `"${col}" = ?`, params }; }
    if (tf.contains !== undefined) { params.push('%' + tf.contains + '%'); return { where: `"${col}" LIKE ?`, params }; }
    if (tf.starts_with !== undefined) { params.push(tf.starts_with + '%'); return { where: `"${col}" LIKE ?`, params }; }
    if (tf.is_empty) return { where: `("${col}" IS NULL OR "${col}" = '')`, params };
    if (tf.is_not_empty) return { where: `("${col}" IS NOT NULL AND "${col}" != '')`, params };
  }

  // number
  if (filter.number) {
    const nf = filter.number;
    if (nf.equals !== undefined) { params.push(nf.equals); return { where: `"${col}" = ?`, params }; }
    if (nf.greater_than !== undefined) { params.push(nf.greater_than); return { where: `"${col}" > ?`, params }; }
    if (nf.less_than !== undefined) { params.push(nf.less_than); return { where: `"${col}" < ?`, params }; }
    if (nf.greater_than_or_equal_to !== undefined) { params.push(nf.greater_than_or_equal_to); return { where: `"${col}" >= ?`, params }; }
    if (nf.less_than_or_equal_to !== undefined) { params.push(nf.less_than_or_equal_to); return { where: `"${col}" <= ?`, params }; }
  }

  // date
  if (filter.date) {
    const df = filter.date;
    if (df.equals !== undefined) { params.push(df.equals); return { where: `"${col}" = ?`, params }; }
    if (df.on_or_after !== undefined) { params.push(df.on_or_after); return { where: `"${col}" >= ?`, params }; }
    if (df.on_or_before !== undefined) { params.push(df.on_or_before); return { where: `"${col}" <= ?`, params }; }
    if (df.before !== undefined) { params.push(df.before); return { where: `"${col}" < ?`, params }; }
    if (df.after !== undefined) { params.push(df.after); return { where: `"${col}" > ?`, params }; }
    if (df.is_empty) return { where: `("${col}" IS NULL OR "${col}" = '')`, params };
  }

  // checkbox
  if (filter.checkbox) {
    if (filter.checkbox.equals !== undefined) { params.push(filter.checkbox.equals ? 1 : 0); return { where: `"${col}" = ?`, params }; }
  }

  // select
  if (filter.select) {
    if (filter.select.equals !== undefined) { params.push(filter.select.equals); return { where: `"${col}" = ?`, params }; }
    if (filter.select.is_empty) return { where: `("${col}" IS NULL OR "${col}" = '')`, params };
  }

  // relation
  if (filter.relation) {
    if (filter.relation.contains !== undefined) { params.push('%' + filter.relation.contains + '%'); return { where: `"${col}" LIKE ?`, params }; }
    if (filter.relation.is_empty) return { where: `("${col}" IS NULL OR "${col}" = '')`, params };
  }

  // timestamp系
  if (filter.timestamp === 'created_time' && filter.created_time) {
    const df = filter.created_time;
    if (df.on_or_after !== undefined) { params.push(df.on_or_after); return { where: `created_time >= ?`, params }; }
    if (df.on_or_before !== undefined) { params.push(df.on_or_before); return { where: `created_time <= ?`, params }; }
  }
  if (filter.timestamp === 'last_edited_time' && filter.last_edited_time) {
    const df = filter.last_edited_time;
    if (df.on_or_after !== undefined) { params.push(df.on_or_after); return { where: `last_edited_time >= ?`, params }; }
    if (df.on_or_before !== undefined) { params.push(df.on_or_before); return { where: `last_edited_time <= ?`, params }; }
  }

  // 未対応
  return { where: '1=1', params };
}

// ─── Notion sorts → SQL ORDER BY ──────────────────────
function sortsToSQL(tableName, sorts) {
  if (!sorts || !sorts.length) return '';
  const parts = sorts.map(s => {
    let col;
    if (s.property) col = propToCol(tableName, s.property);
    else if (s.timestamp === 'created_time') col = 'created_time';
    else if (s.timestamp === 'last_edited_time') col = 'last_edited_time';
    else return null;
    const dir = s.direction === 'descending' ? 'DESC' : 'ASC';
    return `"${col}" ${dir}`;
  }).filter(Boolean);
  return parts.length ? 'ORDER BY ' + parts.join(', ') : '';
}

// ─── D1 row → Notion page 形式に変換 ────────────────────
export function rowToNotionPage(tableName, row) {
  const schema = NOTION_PROP_SCHEMA[tableName] || {};
  const properties = {};
  for (const [propName, spec] of Object.entries(schema)) {
    const val = row[spec.col];
    properties[propName] = rowValueToNotionProperty(spec.type, val, propName);
  }
  return {
    object: 'page',
    id: row.id,
    created_time: row.created_time,
    last_edited_time: row.last_edited_time,
    properties,
    parent: { type: 'database_id', database_id: tableNameToDbId(tableName) },
    url: `https://www.notion.so/${row.id?.replace(/-/g, '')}`,
    archived: false,
  };
}

function rowValueToNotionProperty(type, val, propName) {
  if (val === null || val === undefined || val === '') {
    switch (type) {
      case 'title': return { id: 'title', type: 'title', title: [] };
      case 'rich_text': return { id: 'rt', type: 'rich_text', rich_text: [] };
      case 'number': return { id: 'num', type: 'number', number: null };
      case 'checkbox': return { id: 'cb', type: 'checkbox', checkbox: false };
      case 'select': return { id: 'sel', type: 'select', select: null };
      case 'date': return { id: 'd', type: 'date', date: null };
      case 'relation': return { id: 'rel', type: 'relation', relation: [] };
      case 'unique_id': return { id: 'uid', type: 'unique_id', unique_id: { number: null, prefix: null } };
      default: return null;
    }
  }
  switch (type) {
    case 'title': return { id: 'title', type: 'title', title: [{ type: 'text', text: { content: String(val) }, plain_text: String(val), annotations: {} }] };
    case 'rich_text': return { id: 'rt', type: 'rich_text', rich_text: [{ type: 'text', text: { content: String(val) }, plain_text: String(val), annotations: {} }] };
    case 'number': return { id: 'num', type: 'number', number: Number(val) };
    case 'checkbox': return { id: 'cb', type: 'checkbox', checkbox: !!(Number(val)) };
    case 'select': return { id: 'sel', type: 'select', select: { name: String(val) } };
    case 'date': return { id: 'd', type: 'date', date: { start: String(val), end: null } };
    case 'relation': {
      // カンマ区切りIDを配列化
      const ids = String(val).split(',').map(s => s.trim()).filter(Boolean);
      return { id: 'rel', type: 'relation', relation: ids.map(id => ({ id })) };
    }
    case 'unique_id': return { id: 'uid', type: 'unique_id', unique_id: { number: Number(val), prefix: null } };
    default: return null;
  }
}

function tableNameToDbId(tableName) {
  for (const [id, n] of Object.entries(DB_ID_TO_TABLE)) if (n === tableName) return id;
  return null;
}

// ─── メインクエリ関数 ─────────────────────
export async function d1Query(env, dbId, body) {
  const tableName = DB_ID_TO_TABLE[dbId.replace(/-/g, '')];
  if (!tableName) return { object: 'error', code: 'unknown_db', message: 'DB not mapped: ' + dbId };

  const { filter, sorts, page_size = 100, start_cursor } = body;
  const { where, params } = filterToSQL(tableName, filter, []);
  const orderBy = sortsToSQL(tableName, sorts);

  // cursor = offset として扱う（簡易実装）
  const offset = start_cursor ? parseInt(start_cursor.replace('offset:', ''), 10) : 0;
  const limit = Math.min(page_size, 100);

  const sql = `SELECT * FROM "${tableName}" WHERE ${where} ${orderBy} LIMIT ${limit + 1} OFFSET ${offset}`;

  try {
    const stmt = env.DB.prepare(sql).bind(...params);
    const res = await stmt.all();
    const rows = res.results || [];
    const hasMore = rows.length > limit;
    const results = rows.slice(0, limit).map(r => rowToNotionPage(tableName, r));
    return {
      object: 'list',
      results,
      next_cursor: hasMore ? 'offset:' + (offset + limit) : null,
      has_more: hasMore,
      type: 'page_or_database',
    };
  } catch(e) {
    return { object: 'error', code: 'd1_error', message: e.message, sql };
  }
}

// GET page by ID
export async function d1GetPage(env, pageId) {
  // 全テーブル検索（非効率だが互換のため）
  for (const [dbId, tableName] of Object.entries(DB_ID_TO_TABLE)) {
    try {
      const stmt = env.DB.prepare(`SELECT * FROM "${tableName}" WHERE id = ?`).bind(pageId);
      const res = await stmt.first();
      if (res) return rowToNotionPage(tableName, res);
    } catch(e) {}
  }
  return { object: 'error', code: 'page_not_found', message: pageId };
}
