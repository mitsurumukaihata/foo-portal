/**
 * GitHub Actions用: 業界ニュースをClaude APIで生成しNotion DBに投稿するスクリプト
 *
 * 環境変数:
 *   ANTHROPIC_API_KEY - Anthropic APIキー
 *   NOTION_API_TOKEN  - Notion Integrationトークン
 *   NEWS_TYPE         - tire | transport | dealer | indeed
 */

// ── ニュースDB（1つのDBに全カテゴリ統合） ──
const NEWS_DB_ID = '7e3fdea7165d41b1918c5d25f15e7c36';

const NEWS_CONFIG = {
  tire: {
    category: '🛞 タイヤ',
    titlePrefix: 'タイヤ業界ニュース',
    systemPrompt: `あなたはタイヤ業界の専門ニュースアナリストです。
弊社プロフィール: 有限会社タイヤマネージャーフー（広島市）、出張トラックタイヤ交換専門、主要仕入先はTOYO TIRES・BRIDGESTONE・DUNLOP。

【重要ルール】
- 必ず日本語で記述すること
- 日本国内のニュースのみ取り上げること
- 中国語・英語・その他外国語のニュースソースは完全に除外すること
- 海外ブランドのニュースも日本語の情報源から取得すること

以下のキーワードで最新ニュース(過去24時間〜数日)を検索し、重要なものを5〜10件選んでください:
- タイヤ ニュース、タイヤ 新製品、タイヤ リコール
- ブリヂストン、住友ゴム ダンロップ、横浜ゴム、TOYO TIRES
- ミシュラン、コンチネンタル、グッドイヤー
- タイヤ 価格改定、トラックタイヤ

重要度判定:
- 🚨🚨🚨 = 弊社大打撃（主要仕入先の値上げ・供給停止・廃番、リコール、原材料急騰等）
- 🚨 = 要注意
- 🆕 = 参考情報

カテゴリ: 🆕新製品 / ⚠️リコール / 📊統計・市場 / 🏢企業 / 🌍海外`,
  },
  transport: {
    category: '🚚 運送',
    titlePrefix: '運送業界ニュース',
    systemPrompt: `あなたは運送業界の専門ニュースアナリストです。
弊社プロフィール: 有限会社タイヤマネージャーフー（広島市）、出張トラックタイヤ交換専門、主な顧客は広島県内の運送会社。

【重要ルール】
- 必ず日本語で記述すること
- 日本国内のニュースのみ取り上げること
- 中国語・英語・その他外国語のニュースソースは完全に除外すること

広島県重点で以下を検索:
- 広島 運送会社、広島 トラック、広島県トラック協会
- 運送会社 M&A、廃業、倒産
- トラック 事故、運送 法改正、物流 DX

全国は大きなニュースのみ（大手M&A、重大事故、重要法改正等）。

重要度: 🚨🚨🚨=弊社大打撃 / 🚨=要注意 / 🆕=参考情報`,
  },
  dealer: {
    category: '🚛 ディーラー',
    titlePrefix: 'トラックディーラーニュース',
    systemPrompt: `あなたはトラックディーラー業界の専門ニュースアナリストです。
弊社プロフィール: 有限会社タイヤマネージャーフー（広島市）、トラック運送会社が主要顧客。

【重要ルール】
- 必ず日本語で記述すること
- 日本国内のニュースのみ取り上げること
- 中国語・英語・その他外国語のニュースソースは完全に除外すること

以下を検索:
- トラックディーラー、日野自動車、三菱ふそう、いすゞ、UDトラックス
- 広島 トラック ディーラー、広島日野、広島三菱ふそう
- EVトラック、水素トラック、トラック リコール
- 排ガス規制、トラック 販売台数

重要度: 🚨🚨🚨=弊社大打撃(広島ディーラー閉鎖、大規模リコール等) / 🚨=要注意 / 🆕=参考情報
ニュースがない日は投稿しない。`,
  },
  indeed: {
    category: '📊 Indeed',
    titlePrefix: '【求人市場分析】広島タイヤ・自動車整備業界',
    systemPrompt: `あなたは求人市場アナリストです。
弊社: 有限会社タイヤマネージャーフー（広島市佐伯区）、出張トラックタイヤ交換専門。

以下を検索して広島県の求人市場を分析:
- タイヤ 整備士 広島、タイヤ販売 スタッフ 広島
- タイヤ専門店 広島、自動車整備 タイヤ交換 広島
- タイヤ 営業 広島、自動車部品 ルート営業 広島

分析内容:
- 同業他社の求人状況（給与・待遇・勤務条件）
- 自社求人との比較
- 業界トレンドの変化
- 自社求人の改善提案`,
  },
  subsidy: {
    category: '💴 経営・助成金',
    titlePrefix: '経営・助成金ニュース',
    systemPrompt: `あなたは中小企業経営アドバイザーです。
弊社: 有限会社タイヤマネージャーフー（広島市佐伯区）、従業員10名程度、出張トラックタイヤ交換専門。

【重要ルール】
- 必ず日本語で記述すること
- 日本国内の情報のみ

以下を検索:
- 中小企業 補助金 助成金 2026
- 広島県 補助金、広島市 助成金
- IT導入補助金、ものづくり補助金、事業再構築補助金
- 中小企業 税制改正、インボイス、電子帳簿保存法
- 最低賃金 改定、社会保険 改正
- 中小企業 経営 DX

重要度: 🚨🚨🚨=申請期限が迫っている補助金 / 🚨=要チェック / 🆕=参考情報
ニュースがない日は「本日は新しいニュースはありませんでした。」とだけ出力`,
  },
  hiroshima: {
    category: '📈 広島経済',
    titlePrefix: '広島経済ニュース',
    systemPrompt: `あなたは広島県の経済ニュースアナリストです。
弊社: 有限会社タイヤマネージャーフー（広島市佐伯区）、出張トラックタイヤ交換専門、主な顧客は広島県内の運送会社。

【重要ルール】
- 必ず日本語で記述すること
- 広島県に関連するニュースのみ

以下を検索:
- 広島県 経済ニュース、広島 企業
- 広島 新規事業、広島 工場、広島 物流
- 広島 運送会社 ニュース
- 広島 雇用、広島 景気
- マツダ、広島銀行、中国電力

重要度: 🚨=弊社顧客に影響 / 🆕=参考情報
ニュースがない日は「本日は新しいニュースはありませんでした。」とだけ出力`,
  },
  maintenance: {
    category: '🔧 自動車整備',
    titlePrefix: '自動車整備業界ニュース',
    systemPrompt: `あなたは自動車整備業界の専門アナリストです。
弊社: 有限会社タイヤマネージャーフー（広島市）、出張トラックタイヤ交換専門。

【重要ルール】
- 必ず日本語で記述すること
- 日本国内のニュースのみ

以下を検索:
- 自動車整備 法改正、車検制度 変更
- 整備士 資格、自動車整備業界
- OBD検査、電子制御装置整備
- ADAS、自動運転 整備
- タイヤ 安全基準、車両法 改正

重要度: 🚨🚨🚨=法改正で業務に直接影響 / 🚨=要注意 / 🆕=参考情報
ニュースがない日は「本日は新しいニュースはありませんでした。」とだけ出力`,
  },
  logistics_dx: {
    category: '🌍 物流DX',
    titlePrefix: '物流DXニュース',
    systemPrompt: `あなたは物流テクノロジーの専門アナリストです。
弊社: 有限会社タイヤマネージャーフー（広島市）、出張トラックタイヤ交換専門、自社でもDX推進中。

【重要ルール】
- 必ず日本語で記述すること
- 日本国内のニュースのみ

以下を検索:
- 物流DX、物流テック
- トラック テレマティクス、車両管理システム
- 配車システム、運行管理 デジタル化
- 2024年問題 対策、物流効率化
- タイヤ TPMS、タイヤ管理 IoT

重要度: 🚨=自社に導入検討すべき / 🆕=参考情報
ニュースがない日は「本日は新しいニュースはありませんでした。」とだけ出力`,
  },
  sns_marketing: {
    category: '📱 SNSマーケ',
    titlePrefix: 'SNSマーケティングニュース',
    systemPrompt: `あなたはSNSマーケティングの専門アナリストです。
弊社: 有限会社タイヤマネージャーフー（広島市）、Instagramで集客・ブランディング中。

【重要ルール】
- 必ず日本語で記述すること
- 日本市場に関連する情報

以下を検索:
- Instagram アルゴリズム 変更 2026
- Instagram リール 攻略、Instagram 投稿 最適化
- SNS マーケティング 最新、ソーシャルメディア トレンド
- TikTok ビジネス、YouTube Shorts
- 中小企業 SNS 活用、BtoB SNS マーケティング
- Instagram API 変更、Meta ビジネス

重要度: 🚨=アルゴリズム変更で即対応必要 / 🆕=参考情報
ニュースがない日は「本日は新しいニュースはありませんでした。」とだけ出力`,
  },
};

// ── 日本語の曜日 ──
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function getJSTDate() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  const w = WEEKDAYS[jst.getUTCDay()];
  return { y, m, d, w, dateStr: `${y}-${m}-${d}`, full: `${y}/${m}/${d}（${w}）` };
}

// ── Notion API ──
async function notionRequest(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${process.env.NOTION_API_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API ${res.status}: ${text}`);
  }
  return res.json();
}

// ── DBから直近のニュースを取得（重複防止用） ──
async function getRecentNews(category, limit = 5) {
  const data = await notionRequest('POST', `/databases/${NEWS_DB_ID}/query`, {
    filter: { property: 'カテゴリ', select: { equals: category } },
    sorts: [{ property: '日付', direction: 'descending' }],
    page_size: limit,
  });

  const articles = [];
  for (const page of (data.results || [])) {
    const title = page.properties['タイトル']?.title?.[0]?.plain_text || '';
    // ページの中身も取得
    let content = '';
    try {
      const blocks = await notionRequest('GET', `/blocks/${page.id}/children?page_size=100`);
      content = (blocks.results || []).map(b => {
        const rt = b[b.type]?.rich_text;
        return rt ? rt.map(r => r.plain_text || '').join('') : '';
      }).join('\n');
    } catch (e) { /* skip */ }
    articles.push({ title, content });
  }
  return articles;
}

// ── Markdown → Notion blocks ──
function markdownToBlocks(md) {
  const lines = md.split('\n');
  const blocks = [];
  for (const line of lines) {
    if (line.startsWith('### ')) {
      blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: parseInline(line.slice(4)) } });
    } else if (line.startsWith('## ')) {
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: parseInline(line.slice(3)) } });
    } else if (line.startsWith('# ')) {
      blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: parseInline(line.slice(2)) } });
    } else if (line.startsWith('---')) {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
    } else if (line.startsWith('- ')) {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: parseInline(line.slice(2)) } });
    } else if (/^\d+\. /.test(line)) {
      blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: parseInline(line.replace(/^\d+\. /, '')) } });
    } else if (line.trim()) {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: parseInline(line) } });
    }
  }
  return blocks;
}

function parseInline(text) {
  const parts = [];
  const regex = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)|([^*\[]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      parts.push({ type: 'text', text: { content: match[1] }, annotations: { bold: true } });
    } else if (match[2] && match[3]) {
      parts.push({ type: 'text', text: { content: match[2], link: { url: match[3] } } });
    } else if (match[4]) {
      parts.push({ type: 'text', text: { content: match[4] } });
    }
  }
  return parts.length ? parts : [{ type: 'text', text: { content: text } }];
}

// ── Claude API（Web Search付き） ──
async function callClaude(systemPrompt, userPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: systemPrompt,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 10,
        }
      ],
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text}`);
  }
  const data = await res.json();
  let resultText = '';
  for (const block of (data.content || [])) {
    if (block.type === 'text') resultText += block.text;
  }
  return resultText;
}

// ── メイン処理 ──
async function main() {
  const newsType = process.env.NEWS_TYPE;
  if (!newsType || !NEWS_CONFIG[newsType]) {
    console.error('Invalid NEWS_TYPE:', newsType);
    process.exit(1);
  }

  const config = NEWS_CONFIG[newsType];
  const date = getJSTDate();
  console.log(`[${newsType}] ${date.full} のニュースを生成します...`);

  // 1. DBから過去の投稿を取得（重複防止）
  console.log('過去の投稿を確認中...');
  const recentArticles = await getRecentNews(config.category, 3);
  // 重複防止用にタイトルと内容の先頭500文字だけ渡す（トークン節約）
  let recentContent = recentArticles.map(a => `--- ${a.title} ---\n${a.content.slice(0, 500)}`).join('\n\n');

  // 2. Claude APIでニュース生成
  console.log('Claude APIでニュース生成中...');
  const userPrompt = `今日は${date.full}です。最新のニュースを収集して、Notion投稿用のMarkdown形式で出力してください。

以下は過去の投稿です。同じニュースは除外してください（続報がある場合のみ「【続報】」と明記してOK）:
${recentContent || '（過去の投稿なし）'}

出力形式:
- 各ニュースを ### 見出し で区分
- 見出しの前に重要度マーク（🚨🚨🚨 / 🚨 / 🆕）を付ける
- 本文は2〜3文の要約
- 弊社大打撃レベルの場合は **弊社への影響:** を追加
- 出典URLがあればリンク記載
- ニュース間は --- で区切る
- 全て重複で新規ニュースがない場合は「本日は新しいニュースはありませんでした。」とだけ出力`;

  const newsMarkdown = await callClaude(config.systemPrompt, userPrompt);
  console.log('生成完了。Notionに投稿中...');

  // 3. 重要度判定
  let importance = '🆕 参考情報';
  if (newsType === 'indeed') importance = '📊 レポート';
  else if (newsMarkdown.includes('🚨🚨🚨')) importance = '🚨🚨🚨 緊急';
  else if (newsMarkdown.includes('🚨')) importance = '🚨 要注意';

  // 4. タイトル決定
  const isIndeed = newsType === 'indeed';
  const title = isIndeed
    ? `${config.titlePrefix} - ${date.y}年${parseInt(date.m)}月${parseInt(date.d)}日`
    : `${date.full} ${config.titlePrefix}`;

  // 5. Notion DBにページ作成
  const blocks = markdownToBlocks(newsMarkdown);
  const firstBatch = blocks.slice(0, 100);

  const newPage = await notionRequest('POST', '/pages', {
    parent: { database_id: NEWS_DB_ID },
    icon: { emoji: newsType === 'tire' ? '🛞' : newsType === 'transport' ? '🚚' : newsType === 'dealer' ? '🚛' : '📊' },
    properties: {
      'タイトル': { title: [{ text: { content: title } }] },
      'カテゴリ': { select: { name: config.category } },
      '日付': { date: { start: date.dateStr } },
      '重要度': { select: { name: importance } },
      '投稿元': { select: { name: 'GitHub Actions' } },
    },
    children: firstBatch,
  });

  // 100ブロック以上の場合は追加
  if (blocks.length > 100) {
    const remaining = blocks.slice(100);
    for (let i = 0; i < remaining.length; i += 100) {
      const batch = remaining.slice(i, i + 100);
      await notionRequest('PATCH', `/blocks/${newPage.id}/children`, { children: batch });
    }
  }

  console.log(`✅ 投稿完了: ${title}`);
  console.log(`   Page ID: ${newPage.id}`);
  console.log(`   カテゴリ: ${config.category}`);
  console.log(`   重要度: ${importance}`);
}

main().catch(e => {
  console.error('❌ エラー:', e.message);
  process.exit(1);
});
