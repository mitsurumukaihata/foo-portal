// worker.js
import { d1Query, d1GetPage, DB_ID_TO_TABLE } from './d1-proxy.js';

var worker_default = {
  // 毎日 18:00 UTC 自動バックアップ
  async scheduled(event, env, ctx) {
    const date = new Date().toISOString().slice(0, 10);
    const tables = ['得意先マスタ', '顧客情報DB', '商品マスタ', '車両マスタ', '仕入先マスタ',
      '売上伝票', '売上明細', '仕入伝票', '仕入明細', '勤怠管理', '入金管理', '発注管理'];
    const results = [];
    for (const tbl of tables) {
      try {
        const r = await env.DB.prepare(`SELECT * FROM "${tbl}"`).all();
        const json = JSON.stringify(r.results);
        await env.BACKUP.put(`${date}/${tbl}.json`, json, {
          httpMetadata: { contentType: 'application/json' }
        });
        results.push({ table: tbl, count: r.results?.length || 0, status: 'ok' });
      } catch(e) {
        results.push({ table: tbl, status: 'error', error: e.message });
      }
    }
    const manifest = {
      backup_time: new Date().toISOString(),
      results,
      total_tables: tables.length,
      success_count: results.filter(r => r.status === 'ok').length,
    };
    await env.BACKUP.put(`${date}/_manifest.json`, JSON.stringify(manifest, null, 2));
    console.log('Backup complete:', manifest);
  },
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Notion-Version"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    const url = new URL(request.url);
    if (url.pathname === "/ai/summarize" && request.method === "POST") {
      try {
        const rawBody = await request.text();
        const { text: text2, lang, scene, meetingType, dictionary } = JSON.parse(rawBody);
        if (!text2) return new Response(JSON.stringify({ error: "text is required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        const apiKey = env.ANTHROPIC_API_KEY;
        if (!apiKey) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });

        // シーン別システムプロンプト（個人メモの詳細分類）
        const PROMPTS = {
          "default": `あなたは会議の議事録を整理するアシスタントです。以下の文字起こしテキストから、JSONで回答してください:
{
  "summary": "会議の要約（200文字以内）",
  "actionItems": ["アクションアイテム1", "アクションアイテム2"],
  "participants": ["識別できた参加者名1"]
}
- 要約は重要なポイントを簡潔に
- アクションアイテムは「誰が」「何を」「いつまでに」の形式
- 参加者名が識別できない場合は空配列
- 必ず有効なJSONのみを返すこと`,

          "思考整理・アイデアメモ": `あなたは経営者の思考整理をサポートするアシスタントです。向畑充（タイヤマネージャー有限会社・広島・出張トラックタイヤ交換業）の個人メモ音声から、以下をJSONで抽出:
{
  "summary": "考えていたテーマと結論を200字以内で",
  "actionItems": ["向畑さん本人が次にやる具体的な一手"],
  "key_insights": ["新しい気づき・疑問・アイデアのタネ"],
  "participants": []
}
- 他人を巻き込むタスクではなく、自分自身の次の一手を優先
- 迷いや疑問もそのまま拾う（結論が出てなくてOK）
- 必ず有効なJSONのみを返すこと`,

          "経営者仲間との雑談": `あなたは経営者同士の雑談を整理するアシスタントです。向畑充（タイヤ会社経営・広島）が他社の経営者と話した内容からJSONで抽出:
{
  "summary": "話の全体像を200字（テーマ・立場・結論）",
  "actionItems": ["向畑さんが試したい・調べたいこと"],
  "counterpart_wisdom": ["相手から聞いた知恵・事例・経営判断"],
  "industry_trends": ["業界動向・景気の話"],
  "participants": ["相手の名前・会社名（わかる範囲）"]
}
- 相手の会社名・業種もわかる範囲で記録
- 「いい話だった」ではなく「何がいい話だったか」を具体的に
- 必ず有効なJSONのみを返すこと`,

          "タイヤメーカー担当者との会話": `あなたはタイヤ業界の営業情報を整理するアシスタントです。向畑充（TOYO・BRIDGESTONE・DUNLOP等の二次代理店・広島）が、タイヤメーカー担当者と話した内容からJSONで抽出:
{
  "summary": "今回の訪問・電話の要点200字",
  "new_products": ["新製品・発売予定の銘柄・サイズ"],
  "price_changes": ["価格改定・値上げ・キャンペーン情報"],
  "supply_info": ["納期・欠品・生産状況"],
  "competitor_info": ["他メーカーの動向・競合情報"],
  "actionItems": ["次回連絡事項・発注検討・社内展開"],
  "next_contact": "次回訪問/連絡予定日があれば",
  "participants": ["担当者名・メーカー名"]
}
タイヤ業界固有の銘柄（M170, RTM626, M646, W999, SP122, V03e 等）・サイズ（11R22.5, 225/80R17.5, 205/85R16 等）・メーカー名（TOYO, BRIDGESTONE, DUNLOP, YOKOHAMA, MICHELIN, PIRELLI）は正確に拾ってください。必ず有効なJSONのみを返すこと。`,

          "仕入先・出入り業者との会話": `あなたは仕入先対応の記録を整理するアシスタントです。向畑充（タイヤ会社経営・広島）が、出入り業者や仕入先と話した内容からJSONで抽出:
{
  "summary": "商談・会話の要点200字",
  "proposals": ["先方からの提案内容"],
  "quotes": ["見積・価格・数量"],
  "quality_delivery": ["納期・品質・信頼性の情報"],
  "new_services": ["新サービス・新製品情報"],
  "concerns": ["問題点・クレーム・懸念事項"],
  "actionItems": ["社内検討事項・返答期限・発注判断"],
  "participants": ["担当者名・業者名"]
}
必ず有効なJSONのみを返すこと。`,

          "顧客（運送会社等）との雑談": `あなたはBtoB営業の顧客情報を整理するアシスタントです。向畑充（出張トラックタイヤ交換業・広島）が、顧客（運送会社・建機レンタル業・建設業等）と話した内容からJSONで抽出:
{
  "summary": "会話の要点200字",
  "customer_status": ["顧客の景気・事業状況"],
  "customer_needs": ["困りごと・ニーズ・要望"],
  "proposal_seeds": ["次回提案できそうなネタ"],
  "fleet_changes": ["車両台数の変化・買い替え計画"],
  "actionItems": ["次回フォロー・見積準備・提案書作成"],
  "participants": ["担当者名・会社名"]
}
顧客例: CLO, イドム, ふそう東/西, 高宮運送, K&M, シンヨー運輸, テイクス, 西尾レントオール, アクティオ, 太陽建機, リョーキ等。必ず有効なJSONのみを返すこと。`,

          "その他": `あなたは会話の記録を整理するアシスタントです。向畑充（タイヤ会社経営・広島）の音声メモから、以下をJSONで抽出:
{
  "summary": "会話の要点200字",
  "actionItems": ["次にやるべきこと"],
  "key_points": ["重要だと思われるポイント"],
  "participants": ["識別できた相手の名前"]
}
必ず有効なJSONのみを返すこと。`,
        };

        // シーン名から該当するプロンプトを選ぶ。なければデフォルト。
        let systemPrompt = PROMPTS[scene] || PROMPTS["default"];

        // 用語集が渡されたら system prompt に挿入（Claudeが固有名詞を正確に扱えるよう）
        if (dictionary && typeof dictionary === 'string' && dictionary.trim().length > 0) {
          systemPrompt += `\n\n【弊社の用語集（これらは固有名詞として正確に扱うこと）】\n${dictionary.trim()}`;
        }

        // 全プロンプトに「アクション抽出を徹底」指示を追加（上限15個）
        systemPrompt += `\n\n【アクション抽出ルール】
actionItems は、会話中に出てきた「行動可能なタスク」を**漏らさず**拾ってください（上限15個）。
- 「やる」「確認する」「連絡する」「検討する」「調べる」「発注する」「送る」「返答する」「次回までに」「〜したい」等の発言は全て候補
- 明示されていなくても、文脈から明らかに必要なフォローアップは抽出する
- 1アイテム1アクションに分割（複合は複数に分ける）
- 「誰が」が特定できればプレフィックスに（例: 「向畑: TOYOに納期を確認」）
- 期限が会話で言及されていれば末尾に含める（例: 「矢島: 見積書作成（4/25まで）」）
- アクションが少ない雑談でも、最低限「次回フォロー」等の気づきは1-2個は拾う
- 雑談すぎて本当にアクション不要なら空配列でOK（無理に作らない）`;

        // 全プロンプトに「不明な用語があれば unknown_terms 配列で返す」指示を追加
        systemPrompt += `\n\n【追加指示】レスポンスJSONに以下を必ず含めてください:
  "unknown_terms": ["聞き慣れない固有名詞・略語・人名・会社名・銘柄名を最大10個まで。明らかに一般用語のものは除く"]
日常会話的な単語や明確に既知の用語は含めないこと。本当に意味やスペルが不明で、向畑さんに確認したい用語だけ。`;
        const res2 = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4096, system: systemPrompt, messages: [{ role: "user", content: "\u4EE5\u4E0B\u306E\u4F1A\u8B70\u306E\u6587\u5B57\u8D77\u3053\u3057\u3092\u8981\u7D04\u3057\u3066\u304F\u3060\u3055\u3044:\n\n" + text2.slice(0, 5e4) }] })
        });
        if (!res2.ok) {
          const errText = await res2.text();
          return new Response(JSON.stringify({ error: "Claude API " + res2.status }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
        }
        const data = await res2.json();
        let resultText = "";
        for (const block of data.content || []) {
          if (block.type === "text") resultText += block.text;
        }
        let parsed;
        try {
          parsed = JSON.parse(resultText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
        } catch (e) {
          parsed = { summary: resultText.slice(0, 200), actionItems: [], participants: [], unknown_terms: [] };
        }
        // 確実に unknown_terms が配列で返るように
        if (!Array.isArray(parsed.unknown_terms)) parsed.unknown_terms = [];
        return new Response(JSON.stringify(parsed), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }
      // ── Groq Whisper でボイス文字起こし ──
    if (url.pathname === "/ai/transcribe" && request.method === "POST") {
      try {
        const apiKey = env.GROQ_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "GROQ_API_KEY not configured" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
        }
        const formData = await request.formData();
        const audioBlob = formData.get("file");
        if (!audioBlob) {
          return new Response(JSON.stringify({ error: "file is required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        }
        const groqForm = new FormData();
        groqForm.append("file", audioBlob, formData.get("filename") || "audio.webm");
        groqForm.append("model", formData.get("model") || "whisper-large-v3");
        groqForm.append("language", formData.get("language") || "ja");
        const userPrompt = formData.get("prompt");
        if (userPrompt) groqForm.append("prompt", userPrompt);
        groqForm.append("response_format", "verbose_json");
        groqForm.append("temperature", "0");
        const groqRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: { "Authorization": "Bearer " + apiKey },
          body: groqForm,
        });
        const text2 = await groqRes.text();
        return new Response(text2, {
          status: groqRes.status,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }
    // カタログメタデータプロキシ: タイヤメーカー公式サイトのページから og:image/title/description を抽出
    if (url.pathname === "/catalog-meta") {
      const target = url.searchParams.get("url");
      if (!target) return new Response(JSON.stringify({ error: "url required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      // ホワイトリスト: タイヤメーカー公式サイトのみ許可
      const allowed = ['tire.bridgestone.co.jp','toyotires.jp','tyre.dunlop.co.jp','michelin.co.jp','pirelli.com','y-yokohama.com'];
      let host;
      try { host = new URL(target).hostname; } catch { return new Response(JSON.stringify({ error: "bad url" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } }); }
      if (!allowed.some(a => host === a || host.endsWith('.' + a))) {
        return new Response(JSON.stringify({ error: "host not allowed", host }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      }
      try {
        const res2 = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0 foo-portal-catalog" } });
        if (!res2.ok) return new Response(JSON.stringify({ error: "upstream " + res2.status }), { status: res2.status, headers: { ...cors, "Content-Type": "application/json" } });
        const html = await res2.text();
        const pick = (re) => { const m = html.match(re); return m ? m[1].trim() : null; };
        const title = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || pick(/<title[^>]*>([^<]+)<\/title>/i);
        const desc = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
        const image = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
        const siteName = pick(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
        return new Response(JSON.stringify({ url: target, title, description: desc, image, siteName }), {
          headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

     if (url.pathname === "/pdf-proxy") {
      const pdfUrl = url.searchParams.get("url");
      if (!pdfUrl) {
        return new Response("url parameter required", { status: 400, headers: cors });
      }
      const isAllowed = pdfUrl.startsWith("https://") && (pdfUrl.includes(".amazonaws.com/") || pdfUrl.includes(".notion.so/") || pdfUrl.startsWith("https://file.notion.so/") || pdfUrl.startsWith("https://prod-files-secure."));
      if (!isAllowed) {
        return new Response("Unauthorized URL", { status: 403, headers: cors });
      }
      try {
        const res2 = await fetch(pdfUrl, {
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        if (!res2.ok) {
          return new Response("Upstream error: " + res2.status, { status: res2.status, headers: cors });
        }
        const contentType = res2.headers.get("content-type") || "application/pdf";
        const body2 = await res2.arrayBuffer();
        return new Response(body2, {
          status: 200,
          headers: {
            ...cors,
            "Content-Type": contentType,
            "Cache-Control": "private, max-age=3600"
          }
        });
      } catch (e) {
        return new Response("Proxy error: " + e.message, { status: 500, headers: cors });
      }
    }
    if (url.pathname === "/welfare") {
      const HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>\u798F\u5229\u539A\u751F | f.o.o</title>
<style>
:root {
  --amber: #f0a500;
  --amber-dk: #e07000;
  --amber-light: rgba(240,165,0,0.12);
  --charcoal: #1a1a18;
  --surface: #242420;
  --surface2: #2e2e2a;
  --surface3: #383832;
  --border: rgba(255,255,255,0.08);
  --border2: rgba(255,255,255,0.14);
  --text: #f0ece4;
  --text2: #9e9a90;
  --text3: #6a6660;
  --success: #4caf7d;
  --success-bg: rgba(76,175,125,0.12);
  --blue: #5b9bd5;
  --blue-bg: rgba(91,155,213,0.12);
  --red: #e05555;
  --red-bg: rgba(224,85,85,0.12);
  --radius: 12px;
  --radius-sm: 8px;
}
@media (prefers-color-scheme: light) {
  :root {
    --amber: #e07000;
    --amber-dk: #c05a00;
    --amber-light: rgba(224,112,0,0.10);
    --charcoal: #fdf6ee;
    --surface: #fff;
    --surface2: #f5f0e8;
    --surface3: #ede8de;
    --border: rgba(0,0,0,0.08);
    --border2: rgba(0,0,0,0.14);
    --text: #1a1612;
    --text2: #6b6560;
    --text3: #a09890;
    --success: #2d7d52;
    --success-bg: rgba(45,125,82,0.10);
    --blue: #1a5fa0;
    --blue-bg: rgba(26,95,160,0.10);
    --red: #c03030;
    --red-bg: rgba(192,48,48,0.10);
  }
}
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
html { font-size: 16px; }
body {
  font-family: 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', 'Noto Sans JP', sans-serif;
  background: var(--charcoal);
  color: var(--text);
  min-height: 100vh;
  padding-bottom: 80px;
}
.app-header {
  position: sticky; top: 0; z-index: 100;
  background: var(--charcoal);
  border-bottom: 0.5px solid var(--border);
  padding: 14px 16px 10px;
  display: flex; align-items: center; gap: 10px;
}
.header-icon {
  width: 34px; height: 34px; border-radius: 50%;
  background: var(--amber); display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.header-icon svg { width: 18px; height: 18px; fill: #fff; }
.header-titles { flex: 1; }
.header-title { font-size: 16px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
.header-sub { font-size: 11px; color: var(--text2); margin-top: 1px; }
.portal-back-btn {
  font-size: 12px; color: var(--text2); font-weight: 500;
  background: var(--surface2); border: 0.5px solid var(--border2);
  padding: 6px 12px; border-radius: 20px;
  text-decoration: none; flex-shrink: 0;
}
.session-badge {
  display: flex; align-items: center; gap: 6px;
  background: var(--amber-light); border: 0.5px solid rgba(240,165,0,0.25);
  border-radius: 20px; padding: 5px 12px 5px 5px;
  margin: 0 16px 12px;
}
.session-avatar {
  width: 24px; height: 24px; border-radius: 50%;
  background: var(--amber); display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; color: #fff; flex-shrink: 0;
}
.session-name { font-size: 13px; font-weight: 600; color: var(--amber); }
.session-period { font-size: 11px; color: var(--text2); margin-left: auto; }
.tab-bar { display: flex; background: var(--surface2); border-bottom: 0.5px solid var(--border); }
.tab-btn {
  flex: 1; padding: 12px 0; text-align: center;
  font-size: 13px; color: var(--text2);
  border: none; background: none; cursor: pointer;
  border-bottom: 2px solid transparent;
}
.tab-btn.active { color: var(--amber); border-bottom-color: var(--amber); font-weight: 500; }
.tab-content { display: none; padding: 16px; }
.tab-content.active { display: block; }
.card { background: var(--surface); border: 0.5px solid var(--border); border-radius: var(--radius); padding: 16px; margin-bottom: 12px; }
.card-label { font-size: 11px; font-weight: 600; letter-spacing: .06em; color: var(--text3); text-transform: uppercase; margin-bottom: 12px; }
.budget-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
.budget-remaining-label { font-size: 11px; color: var(--text2); margin-bottom: 2px; }
.budget-remaining-val { font-size: 26px; font-weight: 700; color: var(--amber); letter-spacing: -0.02em; }
.budget-remaining-sub { font-size: 11px; color: var(--text2); margin-top: 2px; }
.budget-used-info { text-align: right; }
.budget-used-label { font-size: 11px; color: var(--text2); margin-bottom: 2px; }
.budget-used-val { font-size: 18px; font-weight: 600; color: var(--text); }
.budget-track { height: 8px; background: var(--surface2); border-radius: 4px; overflow: hidden; margin-bottom: 6px; }
.budget-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--amber), var(--amber-dk)); transition: width .4s ease; }
.budget-fill.warn { background: linear-gradient(90deg, #e08020, var(--amber-dk)); }
.budget-fill.over { background: linear-gradient(90deg, var(--red), #c03030); }
.budget-meta { display: flex; justify-content: space-between; font-size: 11px; color: var(--text2); }
.form-row { margin-bottom: 14px; }
.form-label { font-size: 12px; color: var(--text2); margin-bottom: 6px; display: flex; align-items: center; gap: 4px; }
.form-label .req { color: var(--amber); font-size: 11px; }
.form-control { width: 100%; height: 44px; background: var(--surface2); border: 0.5px solid var(--border2); border-radius: var(--radius-sm); color: var(--text); padding: 0 12px; font-size: 15px; font-family: inherit; appearance: none; }
.form-control:focus { outline: none; border-color: var(--amber); box-shadow: 0 0 0 3px var(--amber-light); }
select.form-control { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%239e9a90' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 36px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.check-row { display: flex; align-items: center; gap: 10px; padding: 12px; background: var(--surface2); border-radius: var(--radius-sm); border: 0.5px solid var(--border); margin-bottom: 10px; cursor: pointer; }
.check-row input[type=checkbox] { width: 20px; height: 20px; accent-color: var(--amber); flex-shrink: 0; cursor: pointer; }
.check-row-label { font-size: 13px; color: var(--text); }
.check-row-sub { font-size: 11px; color: var(--text2); margin-top: 2px; }
.btn-primary { width: 100%; height: 50px; border-radius: var(--radius-sm); background: var(--amber); border: none; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; font-family: inherit; }
.btn-primary:active { background: var(--amber-dk); transform: scale(.98); }
.btn-primary:disabled { background: var(--surface3); color: var(--text3); cursor: not-allowed; transform: none; }
.btn-primary svg { width: 20px; height: 20px; fill: #fff; }
.notice { background: var(--amber-light); border: 0.5px solid rgba(240,165,0,0.3); border-radius: var(--radius-sm); padding: 10px 12px; margin-bottom: 14px; font-size: 12px; color: var(--text2); line-height: 1.6; }
.notice strong { color: var(--amber); }
.list-filters { display: flex; gap: 6px; margin-bottom: 14px; overflow-x: auto; scrollbar-width: none; }
.filter-chip { flex-shrink: 0; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 500; border: 0.5px solid var(--border2); background: var(--surface2); color: var(--text2); cursor: pointer; white-space: nowrap; }
.filter-chip.active { background: var(--amber); border-color: var(--amber); color: #fff; }
.record-list { display: flex; flex-direction: column; gap: 8px; }
.record-item { background: var(--surface); border: 0.5px solid var(--border); border-radius: var(--radius-sm); padding: 12px 14px; display: flex; align-items: flex-start; gap: 10px; }
.record-icon { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 18px; }
.record-body { flex: 1; min-width: 0; }
.record-name { font-size: 14px; font-weight: 600; color: var(--text); }
.record-sub { font-size: 12px; color: var(--text2); margin-top: 2px; }
.record-right { text-align: right; flex-shrink: 0; }
.record-amount { font-size: 15px; font-weight: 700; color: var(--text); }
.badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
.badge-pending { background: var(--blue-bg); color: var(--blue); }
.badge-done { background: var(--success-bg); color: var(--success); }
.period-selector { display: flex; gap: 6px; margin-bottom: 16px; overflow-x: auto; scrollbar-width: none; }
.period-chip { flex-shrink: 0; padding: 7px 16px; border-radius: 20px; font-size: 13px; font-weight: 500; border: 0.5px solid var(--border2); background: var(--surface2); color: var(--text2); cursor: pointer; }
.period-chip.active { background: var(--amber); border-color: var(--amber); color: #fff; }
.metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
.metric-card { background: var(--surface2); border-radius: var(--radius-sm); padding: 14px; }
.metric-label { font-size: 11px; color: var(--text2); margin-bottom: 4px; }
.metric-value { font-size: 22px; font-weight: 700; color: var(--text); letter-spacing: -0.02em; }
.metric-value.amber { color: var(--amber); }
.metric-value.green { color: var(--success); }
.staff-agg-list { display: flex; flex-direction: column; gap: 12px; }
.staff-agg-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
.staff-agg-name { font-size: 13px; font-weight: 500; color: var(--text); }
.staff-agg-amount { font-size: 13px; font-weight: 600; color: var(--text); }
.staff-track { height: 7px; background: var(--surface3); border-radius: 4px; overflow: hidden; margin-bottom: 3px; }
.staff-fill { height: 100%; border-radius: 4px; }
.staff-limit { font-size: 10px; color: var(--text3); }
.staff-agg-tags { display: flex; gap: 4px; margin-top: 5px; flex-wrap: wrap; }
.staff-tag { font-size: 10px; padding: 2px 8px; border-radius: 10px; background: var(--surface3); color: var(--text2); }
.state-box { text-align: center; padding: 40px 20px; color: var(--text2); }
.state-box .state-icon { font-size: 32px; margin-bottom: 10px; }
.state-box .state-msg { font-size: 14px; }
.loading-dots { display: flex; justify-content: center; gap: 6px; padding: 40px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--amber); animation: bounce .8s ease-in-out infinite; }
.dot:nth-child(2) { animation-delay: .15s; }
.dot:nth-child(3) { animation-delay: .3s; }
@keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-8px)} }
#toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(80px); background: var(--surface); border: 0.5px solid var(--border2); border-radius: var(--radius-sm); padding: 12px 20px; font-size: 14px; color: var(--text); box-shadow: 0 4px 24px rgba(0,0,0,0.3); z-index: 999; transition: transform .25s ease; white-space: nowrap; display: flex; align-items: center; gap: 8px; }
#toast.show { transform: translateX(-50%) translateY(0); }
#modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 500; display: none; align-items: flex-end; justify-content: center; }
#modal-overlay.show { display: flex; }
.modal-sheet { background: var(--surface); border-radius: 16px 16px 0 0; padding: 20px 16px 40px; width: 100%; max-width: 480px; }
.modal-handle { width: 40px; height: 4px; background: var(--border2); border-radius: 2px; margin: 0 auto 16px; }
.modal-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: var(--text); }
.modal-detail-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 0.5px solid var(--border); }
.modal-detail-row:last-of-type { border-bottom: none; }
.modal-detail-label { font-size: 13px; color: var(--text2); }
.modal-detail-value { font-size: 13px; font-weight: 500; color: var(--text); }
.modal-actions { display: flex; gap: 10px; margin-top: 16px; }
.btn-outline { flex: 1; height: 44px; border-radius: var(--radius-sm); background: none; border: 0.5px solid var(--border2); color: var(--text2); font-size: 14px; cursor: pointer; font-family: inherit; }
.btn-success { flex: 2; height: 44px; border-radius: var(--radius-sm); background: var(--success); border: none; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
.btn-success:disabled { background: var(--surface3); color: var(--text3); cursor: not-allowed; }
</style>
</head>
<body>
<div class="app-header">
  <div class="header-icon"><svg viewBox="0 0 20 20"><path d="M10 2a6 6 0 00-6 6c0 2.5 1.5 4.7 3.7 5.6L7 17h6l-.7-3.4A6 6 0 0010 2z"/></svg></div>
  <div class="header-titles"><div class="header-title">\u798F\u5229\u539A\u751F</div><div class="header-sub">\u6709\u9650\u4F1A\u793E\u30BF\u30A4\u30E4\u30DE\u30CD\u30FC\u30B8\u30E3\u30FC f.o.o</div></div>
  <a href="https://mitsurumukaihata.github.io/foo-portal/" class="portal-back-btn">\u2190 \u30DD\u30FC\u30BF\u30EB</a>
</div>
<div id="session-badge" class="session-badge" style="display:none">
  <div class="session-avatar" id="session-avatar"></div>
  <span class="session-name" id="session-name"></span>
  <span class="session-period" id="session-period-label"></span>
</div>
<div class="tab-bar">
  <button class="tab-btn active" onclick="switchTab('apply')">\u7533\u8ACB</button>
  <button class="tab-btn" onclick="switchTab('list')">\u4E00\u89A7</button>
  <button class="tab-btn" onclick="switchTab('aggregate')">\u96C6\u8A08</button>
  <button class="tab-btn" onclick="switchTab('report')">\u5831\u544A\u66F8</button>
</div>
<div id="tab-apply" class="tab-content active">
  <div class="notice">\u6708\u4E0A\u9650 <strong>\xA57,700\uFF08\u7A0E\u8FBC\uFF09</strong> \uFF0F \u30B8\u30E0\u30FB\u30DE\u30C3\u30B5\u30FC\u30B8\u306F\u540C\u6642\u5229\u7528\u4E0D\u53EF \uFF0F 3\u304B\u6708\u7E70\u8D8A\u53EF</div>
  <div class="card" id="my-budget-card" style="display:none">
    <div class="card-label">\u4ECA\u671F\u306E\u6B8B\u308A\u67A0</div>
    <div class="budget-header">
      <div class="budget-remaining"><div class="budget-remaining-label">\u6B8B\u308A\u5229\u7528\u53EF\u80FD\u984D</div><div class="budget-remaining-val" id="my-remaining">\xA5--</div><div class="budget-remaining-sub">\u4E0A\u96507,700\u5186 \xD7 3\u304B\u6708 = 23,100\u5186</div></div>
      <div class="budget-used-info"><div class="budget-used-label">\u4ECA\u671F\u5229\u7528\u6E08\u307F</div><div class="budget-used-val" id="my-used">\xA5--</div></div>
    </div>
    <div class="budget-track"><div class="budget-fill" id="my-budget-fill" style="width:0%"></div></div>
    <div class="budget-meta"><span id="my-period-label">--\u671F</span><span id="my-budget-pct">0%</span></div>
  </div>
  <div class="card">
    <div class="card-label">\u65B0\u898F\u7533\u8ACB</div>
    <div class="form-row"><div class="form-label">\u793E\u54E1\u540D <span class="req">\u5FC5\u9808</span></div>
      <select class="form-control" id="inp-staff" onchange="onStaffChange()">
        <option value="">\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044</option>
        <option>\u77E2\u5CF6 \u660E\u548C</option><option>\u5927\u7530 \u5065</option><option>\u4E2D\u5DDD \u98AF</option>
        <option>\u5E73\u91CE \u6625\u4E4B</option><option>\u5C71\u6839 \u7950\u53F8</option><option>\u6751\u7530 \u826F\u5178</option>
        <option>\u5CA1\u5D0E \u7531\u7F8E</option><option>\u85E4\u4E95 \u771F\u7406\u4E9C</option>
      </select>
    </div>
    <div class="form-row"><div class="form-label">\u5185\u5BB9 <span class="req">\u5FC5\u9808</span></div>
      <select class="form-control" id="inp-content">
        <option value="">\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044</option>
        <option>\u30B9\u30DD\u30FC\u30C4\u30B8\u30E0</option><option>\u30DE\u30C3\u30B5\u30FC\u30B8</option><option>\u30AB\u30FC\u30D6\u30B9</option><option>\u30B5\u30D7\u30EA\u30FB\u30C9\u30EA\u30F3\u30AF</option>
      </select>
    </div>
    <div class="form-grid">
      <div class="form-row"><div class="form-label">\u5229\u7528\u65E5 <span class="req">\u5FC5\u9808</span></div><input type="date" class="form-control" id="inp-date" /></div>
      <div class="form-row"><div class="form-label">\u91D1\u984D\uFF08\u7A0E\u8FBC\uFF09 <span class="req">\u5FC5\u9808</span></div><input type="number" class="form-control" id="inp-amount" placeholder="\u4F8B\uFF1A4500" min="1" max="23100" /></div>
    </div>
    <div class="form-row"><div class="form-label">\u627F\u8A8D\u8005\u3078\u306E\u9023\u7D61\u65B9\u6CD5</div>
      <select class="form-control" id="inp-contact"><option>LINE</option><option>\u96FB\u8A71</option></select>
    </div>
    <label class="check-row"><input type="checkbox" id="chk-receipt" /><div><div class="check-row-label">\u9818\u53CE\u66F8\u3042\u308A</div><div class="check-row-sub">\u5229\u7528\u5F8C\u3001\u5411\u7551\u307E\u305F\u306F\u5CA1\u5D0E\u306B\u63D0\u51FA\u3057\u3066\u304F\u3060\u3055\u3044</div></div></label>
    <label class="check-row"><input type="checkbox" id="chk-rule" onchange="updateSubmitBtn()" /><div><div class="check-row-label">\u30EB\u30FC\u30EB\u3092\u78BA\u8A8D\u3057\u307E\u3057\u305F</div><div class="check-row-sub">\u6708\u4E0A\u96507,700\u5186\u30FB\u540C\u6642\u5229\u7528\u4E0D\u53EF\u30FB3\u304B\u6708\u7E70\u8D8A\u30EB\u30FC\u30EB</div></div></label>
    <button class="btn-primary" id="submit-btn" onclick="submitApply()" disabled>
      <svg viewBox="0 0 20 20"><path d="M10 3a7 7 0 110 14A7 7 0 0110 3zm0 2a5 5 0 100 10A5 5 0 0010 5zm1 2.5V10h2.5l-3.5 3.5L6.5 10H9V7.5h2z"/></svg>\u7533\u8ACB\u3059\u308B
    </button>
  </div>
</div>
<div id="tab-list" class="tab-content">
  <div class="list-filters" id="list-filters">
    <div class="filter-chip active" onclick="filterList('all',this)">\u3059\u3079\u3066</div>
    <div class="filter-chip" onclick="filterList('pending',this)">\u4F9D\u983C\u4E2D</div>
    <div class="filter-chip" onclick="filterList('done',this)">\u53D7\u3051\u53D6\u308A\u5B8C\u4E86</div>
    <div class="filter-chip" onclick="filterList('gym',this)">\u30B8\u30E0</div>
    <div class="filter-chip" onclick="filterList('massage',this)">\u30DE\u30C3\u30B5\u30FC\u30B8</div>
    <div class="filter-chip" onclick="filterList('supplement',this)">\u30B5\u30D7\u30EA</div>
  </div>
  <div id="list-container"><div class="loading-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>
</div>
<div id="tab-aggregate" class="tab-content">
  <div class="period-selector" id="period-selector"></div>
  <div id="agg-container"><div class="loading-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>
</div>
<div id="tab-report" class="tab-content">
  <div class="notice">3\u304B\u6708\u3054\u3068\uFF08<strong>3\u6708\u30FB6\u6708\u30FB9\u6708\u30FB12\u6708</strong>\u7DE0\u3081\uFF09\u306B\u63D0\u51FA\u3002\u8A18\u9332\u304C\u306A\u3044\u3068\u7D4C\u8CBB\u8A08\u4E0A\u3067\u304D\u307E\u305B\u3093\u3002</div>
  <div class="card" id="report-status-card">
    <div class="card-label">\u4ECA\u671F\u306E\u63D0\u51FA\u72B6\u6CC1</div>
    <div id="report-status-list"><div class="loading-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>
  </div>
  <div class="card" id="report-form-card">
    <div class="card-label">\u5831\u544A\u66F8\u3092\u63D0\u51FA\u3059\u308B</div>
    <div class="form-row"><div class="form-label">\u793E\u54E1\u540D <span class="req">\u5FC5\u9808</span></div>
      <select class="form-control" id="rep-staff" onchange="onRepStaffChange()">
        <option value="">\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044</option>
        <option>\u77E2\u5CF6 \u660E\u548C</option><option>\u5927\u7530 \u5065</option><option>\u4E2D\u5DDD \u98AF</option>
        <option>\u5E73\u91CE \u6625\u4E4B</option><option>\u5C71\u6839 \u7950\u53F8</option><option>\u6751\u7530 \u826F\u5178</option>
        <option>\u5CA1\u5D0E \u7531\u7F8E</option><option>\u85E4\u4E95 \u771F\u7406\u4E9C</option>
      </select>
    </div>
    <div class="form-row"><div class="form-label">\u5BFE\u8C61\u671F <span class="req">\u5FC5\u9808</span></div>
      <select class="form-control" id="rep-period">
        <option value="">\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044</option>
        <option>\uFF11\u671F\uFF081\uFF5E3\u6708\uFF09</option><option>\uFF12\u671F\uFF084\uFF5E6\u6708\uFF09</option><option>\uFF13\u671F\uFF087\uFF5E9\u6708\uFF09</option><option>\uFF14\u671F\uFF0810\uFF5E12\u6708\uFF09</option>
      </select>
    </div>
    <div class="form-row"><div class="form-label">\u8A55\u4FA1 <span class="req">\u5FC5\u9808</span></div>
      <select class="form-control" id="rep-rating">
        <option value="">\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044</option>
        <option>\u975E\u5E38\u306B\u826F\u304B\u3063\u305F</option><option>\u3061\u3087\u3063\u3068\u826F\u304B\u3063\u305F</option><option>\u666E\u901A</option>
        <option>\u5FAE\u5999</option><option>\u5168\u7136\u826F\u304F\u306A\u304B\u3063\u305F</option><option>\u3042\u307E\u308A\u4F7F\u3048\u306A\u304B\u3063\u305F</option>
      </select>
    </div>
    <div class="form-row"><div class="form-label">\u30B3\u30E1\u30F3\u30C8\u30FB\u611F\u60F3</div>
      <textarea class="form-control" id="rep-comment" rows="4" placeholder="\u4F8B\uFF1A\u80A9\u3053\u308A\u304C\u8EFD\u6E1B\u3057\u3066\u4ED5\u4E8B\u306B\u96C6\u4E2D\u3067\u304D\u307E\u3057\u305F" style="height:auto; padding: 10px 12px; resize: none; line-height:1.6;"></textarea>
    </div>
    <div id="rep-summary-box" style="display:none; margin-bottom:14px;">
      <div class="card-label" style="margin-bottom:8px;">\u4ECA\u671F\u306E\u5229\u7528\u5C65\u6B74\uFF08\u81EA\u52D5\u96C6\u8A08\uFF09</div>
      <div id="rep-summary-content"></div>
    </div>
    <button class="btn-primary" id="rep-submit-btn" onclick="submitReport()">
      <svg viewBox="0 0 20 20" fill="#fff" width="20" height="20"><path d="M16.7 5.3a1 1 0 00-1.4 0L8 12.6 4.7 9.3a1 1 0 00-1.4 1.4l4 4a1 1 0 001.4 0l8-8a1 1 0 000-1.4z"/></svg>\u5831\u544A\u66F8\u3092\u63D0\u51FA\u3059\u308B
    </button>
  </div>
</div>
<div id="toast"><span class="toast-icon" id="toast-icon">\u2713</span><span id="toast-msg"></span></div>
<div id="modal-overlay" onclick="closeModal(event)">
  <div class="modal-sheet" id="modal-sheet">
    <div class="modal-handle"></div>
    <div class="modal-title" id="modal-title">\u7533\u8ACB\u8A73\u7D30</div>
    <div id="modal-body"></div>
    <div class="modal-actions">
      <button class="btn-outline" onclick="closeModal()">\u9589\u3058\u308B</button>
      <button class="btn-success" id="modal-status-btn" onclick="toggleStatus()">\u53D7\u3051\u53D6\u308A\u5B8C\u4E86\u306B\u3059\u308B</button>
    </div>
  </div>
</div>
<script>
const WORKER = 'https://notion-proxy.33322666666mm.workers.dev';
const DB_ID        = '1d0a695f-8e88-800c-bf9d-000b34639045';
const REPORT_DB_ID = '1d0a695f-8e88-80a8-9e39-000bf5587d3c';
const BUDGET_MAX_MONTHLY = 7700;
const QUARTER_MONTHS = 3;
const BUDGET_MAX_QUARTERLY = BUDGET_MAX_MONTHLY * QUARTER_MONTHS;
const STAFF_TO_LAST = { '\u77E2\u5CF6 \u660E\u548C': '\u77E2\u5CF6', '\u5927\u7530 \u5065': '\u5927\u7530', '\u4E2D\u5DDD \u98AF': '\u4E2D\u5DDD', '\u5E73\u91CE \u6625\u4E4B': '\u5E73\u91CE', '\u5C71\u6839 \u7950\u53F8': '\u5C71\u6839', '\u6751\u7530 \u826F\u5178': '\u6751\u7530', '\u5CA1\u5D0E \u7531\u7F8E': '\u5CA1\u5D0E', '\u85E4\u4E95 \u771F\u7406\u4E9C': '\u85E4\u4E95' };
const CONTENT_ICON = { '\u30B9\u30DD\u30FC\u30C4\u30B8\u30E0': '\u{1F3CB}\uFE0F', '\u30DE\u30C3\u30B5\u30FC\u30B8': '\u{1F486}', '\u30AB\u30FC\u30D6\u30B9': '\u{1F6B4}', '\u30B5\u30D7\u30EA\u30FB\u30C9\u30EA\u30F3\u30AF': '\u{1F48A}', '': '\u{1F4CB}' };
const CONTENT_COLOR = { '\u30B9\u30DD\u30FC\u30C4\u30B8\u30E0': '#5b9bd5', '\u30DE\u30C3\u30B5\u30FC\u30B8': '#e07898', '\u30AB\u30FC\u30D6\u30B9': '#4caf7d', '\u30B5\u30D7\u30EA\u30FB\u30C9\u30EA\u30F3\u30AF': '#f0a500', '': '#888' };
let allRecords = []; let currentFilter = 'all'; let currentModalId = null; let currentModalDone = false;
function getQuarter(date) { const m = date.getMonth() + 1; const y = date.getFullYear(); const q = Math.ceil(m / 3); return { year: y, q, label: y + '\u5E74 Q' + q }; }
function getPeriodRange(year, q) { const startM = (q - 1) * 3 + 1; const endM = q * 3; const start = year + '-' + String(startM).padStart(2,'0') + '-01'; const lastDay = new Date(year, endM, 0).getDate(); const end = year + '-' + String(endM).padStart(2,'0') + '-' + lastDay; return { start, end }; }
async function notionAPI(path, method='GET', body=null) { const opts = { method, headers: { 'Content-Type': 'application/json' } }; if (body) opts.body = JSON.stringify(body); const r = await fetch(WORKER + '/' + path, opts); const text = await r.text(); let data; try { data = JSON.parse(text); } catch(e) { throw new Error('\u30EC\u30B9\u30DD\u30F3\u30B9\u89E3\u6790\u30A8\u30E9\u30FC: ' + text.slice(0,100)); } if (data.object === 'error') throw new Error(data.message || JSON.stringify(data)); return data; }
async function fetchRecords() { const data = await notionAPI('databases/' + DB_ID + '/query', 'POST', { page_size: 100, sorts: [{ property: '\u5229\u7528\u65E5', direction: 'descending' }] }); return data.results.map(parseRecord); }
function parseRecord(p) { const props = p.properties; const getSelect = k => props[k]?.select?.name || ''; const getNum = k => props[k]?.number || 0; const getDate = k => props[k]?.date?.start || ''; const getTitle = k => props[k]?.title?.[0]?.plain_text || ''; const getCheck = k => props[k]?.checkbox || false; return { id: p.id, name: getTitle('\u540D\u524D'), staff: getSelect('\u793E\u54E1\u540D'), content: getSelect('\u5185\u5BB9'), date: getDate('\u5229\u7528\u65E5'), amount: getNum('\u91D1\u984D\uFF08\u7A0E\u8FBC\u307F\uFF09'), status: getSelect('\u72B6\u6CC1\u9078\u629E'), contact: getSelect('\u627F\u8A8D\u8005\u3078\u306E\u9023\u7D61\u65B9\u6CD5'), receipt: getCheck('\u9818\u53CE\u66F8\u306E\u6709\u7121'), receiptPerson: getSelect('\u9818\u53CE\u66F8\u53D7\u3051\u53D6\u308A') }; }
window.addEventListener('DOMContentLoaded', async () => {
  const now = new Date(); const q = getQuarter(now);
  document.getElementById('inp-date').value = now.toISOString().slice(0,10);
  try { const raw = localStorage.getItem('foo_portal_session'); if (raw) { const session = JSON.parse(raw); if (session.name && new Date(session.expires) > now) { const sel = document.getElementById('inp-staff'); for (let opt of sel.options) { if (opt.value === session.name) { sel.value = session.name; break; } } const badge = document.getElementById('session-badge'); badge.style.display = 'flex'; document.getElementById('session-avatar').textContent = session.name.slice(-1); document.getElementById('session-name').textContent = session.name + ' \u3068\u3057\u3066\u30ED\u30B0\u30A4\u30F3\u4E2D'; document.getElementById('session-period-label').textContent = 'Q' + q.q; } } } catch(e) {}
  buildPeriodSelector(); await loadAll(); onStaffChange();
});
async function loadAll() { try { allRecords = await fetchRecords(); renderList(); renderAggregate(); } catch(e) { console.error(e); showToast('\u30C7\u30FC\u30BF\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F', '\u2715'); } }
function switchTab(tab) { document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active')); document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active')); document.getElementById('tab-' + tab).classList.add('active'); document.querySelectorAll('.tab-btn')[['apply','list','aggregate','report'].indexOf(tab)].classList.add('active'); if (tab === 'list' || tab === 'aggregate') loadAll(); if (tab === 'report') initReportTab(); }
function onStaffChange() { const staff = document.getElementById('inp-staff').value; const card = document.getElementById('my-budget-card'); if (!staff) { card.style.display = 'none'; updateSubmitBtn(); return; } card.style.display = 'block'; updateSubmitBtn(); const now = new Date(); const q = getQuarter(now); const { start, end } = getPeriodRange(q.year, q.q); const used = allRecords.filter(r => r.staff === staff && r.date >= start && r.date <= end).reduce((s, r) => s + r.amount, 0); const remaining = Math.max(0, BUDGET_MAX_QUARTERLY - used); const pct = Math.min(100, Math.round(used / BUDGET_MAX_QUARTERLY * 100)); document.getElementById('my-remaining').textContent = '\xA5' + remaining.toLocaleString(); document.getElementById('my-used').textContent = '\xA5' + used.toLocaleString(); document.getElementById('my-period-label').textContent = q.year + '\u5E74 Q' + q.q; document.getElementById('my-budget-pct').textContent = pct + '%'; const fill = document.getElementById('my-budget-fill'); fill.style.width = pct + '%'; fill.className = 'budget-fill' + (pct >= 100 ? ' over' : pct >= 80 ? ' warn' : ''); }
function updateSubmitBtn() { const staff = document.getElementById('inp-staff').value; const rule = document.getElementById('chk-rule').checked; document.getElementById('submit-btn').disabled = !(staff && rule); }
async function submitApply() { const staff = document.getElementById('inp-staff').value; const content = document.getElementById('inp-content').value; const date = document.getElementById('inp-date').value; const amount = parseInt(document.getElementById('inp-amount').value); const contact = document.getElementById('inp-contact').value; const receipt = document.getElementById('chk-receipt').checked; if (!staff || !content || !date || !amount) { showToast('\u5FC5\u9808\u9805\u76EE\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044', '\u26A0\uFE0F'); return; } if (amount > BUDGET_MAX_QUARTERLY) { showToast('\u91D1\u984D\u304C\u4E0A\u9650\u3092\u8D85\u3048\u3066\u3044\u307E\u3059', '\u26A0\uFE0F'); return; } const btn = document.getElementById('submit-btn'); btn.disabled = true; btn.innerHTML = '<span>\u9001\u4FE1\u4E2D...</span>'; try { const title = staff + '\uFF5C' + content + '\uFF5C' + date; await notionAPI('pages', 'POST', { parent: { database_id: '1d0a695f8e8880a6a0f6e1ea80c7a74f' }, properties: { '\u540D\u524D': { title: [{ text: { content: title } }] }, '\u793E\u54E1\u540D': { select: { name: staff } }, '\u5185\u5BB9': { select: { name: content } }, '\u5229\u7528\u65E5': { date: { start: date } }, '\u91D1\u984D\uFF08\u7A0E\u8FBC\u307F\uFF09': { number: amount }, '\u72B6\u6CC1\u9078\u629E': { select: { name: '\u4F9D\u983C\u4E2D' } }, '\u627F\u8A8D\u8005\u3078\u306E\u9023\u7D61\u65B9\u6CD5': { select: { name: contact } }, '\u9818\u53CE\u66F8\u306E\u6709\u7121': { checkbox: receipt } } }); showToast('\u7533\u8ACB\u3092\u9001\u4FE1\u3057\u307E\u3057\u305F\uFF01', '\u2713'); resetForm(); await loadAll(); onStaffChange(); } catch(e) { showToast('\u9001\u4FE1\u306B\u5931\u6557\u3057\u307E\u3057\u305F', '\u2715'); console.error(e); } finally { btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 20 20" fill="#fff" width="20" height="20"><path d="M10 3a7 7 0 110 14A7 7 0 0110 3zm0 2a5 5 0 100 10A5 5 0 0010 5zm1 2.5V10h2.5l-3.5 3.5L6.5 10H9V7.5h2z"/></svg>\u7533\u8ACB\u3059\u308B'; } }
function resetForm() { document.getElementById('inp-staff').value = ''; document.getElementById('inp-content').value = ''; const now = new Date(); document.getElementById('inp-date').value = now.toISOString().slice(0,10); document.getElementById('inp-amount').value = ''; document.getElementById('inp-contact').value = 'LINE'; document.getElementById('chk-receipt').checked = false; document.getElementById('chk-rule').checked = false; document.getElementById('my-budget-card').style.display = 'none'; updateSubmitBtn(); }
function filterList(type, el) { currentFilter = type; document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active')); el.classList.add('active'); renderList(); }
function renderList() { const container = document.getElementById('list-container'); let records = [...allRecords]; if (currentFilter === 'pending') records = records.filter(r => r.status === '\u4F9D\u983C\u4E2D'); else if (currentFilter === 'done') records = records.filter(r => r.status === '\u53D7\u3051\u53D6\u308A\u5B8C\u4E86'); else if (currentFilter === 'gym') records = records.filter(r => r.content === '\u30B9\u30DD\u30FC\u30C4\u30B8\u30E0' || r.content === '\u30AB\u30FC\u30D6\u30B9'); else if (currentFilter === 'massage') records = records.filter(r => r.content === '\u30DE\u30C3\u30B5\u30FC\u30B8'); else if (currentFilter === 'supplement') records = records.filter(r => r.content === '\u30B5\u30D7\u30EA\u30FB\u30C9\u30EA\u30F3\u30AF'); if (records.length === 0) { container.innerHTML = '<div class="state-box"><div class="state-icon">\u{1F4ED}</div><div class="state-msg">\u7533\u8ACB\u304C\u3042\u308A\u307E\u305B\u3093</div></div>'; return; } container.innerHTML = '<div class="record-list">' + records.map(r => '<div class="record-item" onclick="openModal(\\'' + r.id + '\\')"><div class="record-icon" style="background:' + (CONTENT_COLOR[r.content] || '#888') + '22;">' + (CONTENT_ICON[r.content]||'\u{1F4CB}') + '</div><div class="record-body"><div class="record-name">' + r.staff + '</div><div class="record-sub">' + r.content + '\u3000' + (r.date ? r.date.replace(/-/g,'/') : '') + '</div>' + (r.receipt ? '<div class="record-sub" style="margin-top:2px;color:var(--amber);">\u{1F9FE} \u9818\u53CE\u66F8\u3042\u308A</div>' : '') + '</div><div class="record-right"><div class="record-amount">\xA5' + r.amount.toLocaleString() + '</div><div class="record-status"><span class="badge ' + (r.status === '\u53D7\u3051\u53D6\u308A\u5B8C\u4E86' ? 'badge-done' : 'badge-pending') + '">' + (r.status || '\u4F9D\u983C\u4E2D') + '</span></div></div></div>').join('') + '</div>'; }
function openModal(id) { const r = allRecords.find(x => x.id === id); if (!r) return; currentModalId = id; currentModalDone = r.status === '\u53D7\u3051\u53D6\u308A\u5B8C\u4E86'; document.getElementById('modal-title').textContent = r.staff + '\uFF5C' + r.content; document.getElementById('modal-body').innerHTML = '<div class="modal-detail-row"><span class="modal-detail-label">\u5229\u7528\u65E5</span><span class="modal-detail-value">' + (r.date ? r.date.replace(/-/g,'/') : '\u2014') + '</span></div><div class="modal-detail-row"><span class="modal-detail-label">\u91D1\u984D\uFF08\u7A0E\u8FBC\uFF09</span><span class="modal-detail-value">\xA5' + r.amount.toLocaleString() + '</span></div><div class="modal-detail-row"><span class="modal-detail-label">\u9023\u7D61\u65B9\u6CD5</span><span class="modal-detail-value">' + (r.contact || '\u2014') + '</span></div><div class="modal-detail-row"><span class="modal-detail-label">\u9818\u53CE\u66F8</span><span class="modal-detail-value">' + (r.receipt ? '\u2713 \u3042\u308A' : '\u306A\u3057') + '</span></div><div class="modal-detail-row"><span class="modal-detail-label">\u30B9\u30C6\u30FC\u30BF\u30B9</span><span class="modal-detail-value"><span class="badge ' + (currentModalDone ? 'badge-done' : 'badge-pending') + '">' + (r.status || '\u4F9D\u983C\u4E2D') + '</span></span></div>'; const btn = document.getElementById('modal-status-btn'); if (currentModalDone) { btn.textContent = '\u4F9D\u983C\u4E2D\u306B\u623B\u3059'; btn.style.background = 'var(--blue)'; } else { btn.textContent = '\u53D7\u3051\u53D6\u308A\u5B8C\u4E86\u306B\u3059\u308B'; btn.style.background = 'var(--success)'; } btn.disabled = false; document.getElementById('modal-overlay').classList.add('show'); }
function closeModal(e) { if (e && e.target !== document.getElementById('modal-overlay')) return; document.getElementById('modal-overlay').classList.remove('show'); }
async function toggleStatus() { const newStatus = currentModalDone ? '\u4F9D\u983C\u4E2D' : '\u53D7\u3051\u53D6\u308A\u5B8C\u4E86'; const btn = document.getElementById('modal-status-btn'); btn.disabled = true; btn.textContent = '\u66F4\u65B0\u4E2D...'; try { await notionAPI('pages/' + currentModalId, 'PATCH', { properties: { '\u72B6\u6CC1\u9078\u629E': { select: { name: newStatus } } } }); showToast(newStatus + '\u306B\u5909\u66F4\u3057\u307E\u3057\u305F', '\u2713'); document.getElementById('modal-overlay').classList.remove('show'); await loadAll(); } catch(e) { showToast('\u66F4\u65B0\u306B\u5931\u6557\u3057\u307E\u3057\u305F', '\u2715'); btn.disabled = false; btn.textContent = currentModalDone ? '\u4F9D\u983C\u4E2D\u306B\u623B\u3059' : '\u53D7\u3051\u53D6\u308A\u5B8C\u4E86\u306B\u3059\u308B'; } }
function buildPeriodSelector() { const now = new Date(); const sel = document.getElementById('period-selector'); const periods = []; for (let i = 0; i < 4; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i * 3, 1); const q = getQuarter(d); periods.push(q); } sel.innerHTML = periods.map((p, i) => '<div class="period-chip ' + (i===0?'active':'') + '" onclick="selectPeriod(' + p.year + ',' + p.q + ',this)">' + p.year + ' Q' + p.q + '</div>').join(''); const first = periods[0]; renderAggregatePeriod(first.year, first.q); }
function selectPeriod(year, q, el) { document.querySelectorAll('.period-chip').forEach(c => c.classList.remove('active')); el.classList.add('active'); renderAggregatePeriod(year, q); }
function renderAggregatePeriod(year, q) { const { start, end } = getPeriodRange(year, q); const records = allRecords.filter(r => r.date >= start && r.date <= end); const totalAmount = records.reduce((s, r) => s + r.amount, 0); const totalCount = records.length; const staffList = ['\u77E2\u5CF6 \u660E\u548C','\u5927\u7530 \u5065','\u4E2D\u5DDD \u98AF','\u5E73\u91CE \u6625\u4E4B','\u5C71\u6839 \u7950\u53F8','\u6751\u7530 \u826F\u5178','\u5CA1\u5D0E \u7531\u7F8E','\u85E4\u4E95 \u771F\u7406\u4E9C']; const staffColors = ['#5b9bd5','#f0a500','#4caf7d','#e07898','#a78bfa','#fb923c','#34d399','#f472b6']; const staffData = staffList.map((name, i) => { const recs = records.filter(r => r.staff === name); const used = recs.reduce((s, r) => s + r.amount, 0); const pct = Math.min(100, Math.round(used / BUDGET_MAX_QUARTERLY * 100)); const contents = [...new Set(recs.map(r => r.content).filter(Boolean))]; return { name, used, pct, contents, color: staffColors[i] }; }); const container = document.getElementById('agg-container'); container.innerHTML = '<div class="metrics-grid"><div class="metric-card"><div class="metric-label">\u671F\u9593\u5229\u7528\u5408\u8A08</div><div class="metric-value amber">\xA5' + totalAmount.toLocaleString() + '</div></div><div class="metric-card"><div class="metric-label">\u7533\u8ACB\u4EF6\u6570</div><div class="metric-value green">' + totalCount + '\u4EF6</div></div></div><div class="card"><div class="card-label">\u793E\u54E1\u5225\u5229\u7528\u72B6\u6CC1</div><div class="staff-agg-list">' + staffData.map(s => '<div class="staff-agg-row"><div class="staff-agg-header"><span class="staff-agg-name">' + s.name + '</span><span class="staff-agg-amount">' + (s.used > 0 ? '\xA5' + s.used.toLocaleString() : '\u672A\u5229\u7528') + '</span></div><div class="staff-track"><div class="staff-fill" style="width:' + s.pct + '%;background:' + s.color + ';"></div></div><div style="display:flex;justify-content:space-between;align-items:center;"><div class="staff-agg-tags">' + s.contents.map(c => '<span class="staff-tag">' + c + '</span>').join('') + '</div><div class="staff-limit">' + s.pct + '% / \u4E0A\u9650\xA5' + BUDGET_MAX_QUARTERLY.toLocaleString() + '</div></div></div>').join('') + '</div></div>'; }
function renderAggregate() { const chips = document.querySelectorAll('.period-chip'); chips.forEach(c => { if (c.classList.contains('active')) { const txt = c.textContent.trim(); const m = txt.match(/(\\d+) Q(\\d+)/); if (m) renderAggregatePeriod(parseInt(m[1]), parseInt(m[2])); } }); }
let reportRecords = [];
async function initReportTab() { try { const raw = localStorage.getItem('foo_portal_session'); if (raw) { const session = JSON.parse(raw); if (session.name && new Date(session.expires) > new Date()) { const sel = document.getElementById('rep-staff'); for (let opt of sel.options) { if (opt.value === session.name) { sel.value = session.name; break; } } onRepStaffChange(); } } } catch(e) {} const now = new Date(); const q = getQuarter(now); const periodMap = { 1: '\uFF11\u671F\uFF081\uFF5E3\u6708\uFF09', 2: '\uFF12\u671F\uFF084\uFF5E6\u6708\uFF09', 3: '\uFF13\u671F\uFF087\uFF5E9\u6708\uFF09', 4: '\uFF14\u671F\uFF0810\uFF5E12\u6708\uFF09' }; document.getElementById('rep-period').value = periodMap[q.q] || ''; await loadReportRecords(); renderReportStatus(); }
async function loadReportRecords() { try { const data = await notionAPI('databases/' + REPORT_DB_ID + '/query', 'POST', { page_size: 100, sorts: [{ property: '\u63D0\u51FA\u65E5', direction: 'descending' }] }); reportRecords = data.results.map(p => { const props = p.properties; return { id: p.id, staff: props['\u793E\u54E1\u540D']?.select?.name || '', period: props['\u5BFE\u8C61\u671F']?.select?.name || '', rating: props['\u8A55\u4FA1']?.select?.name || '', comment: props['\u30B3\u30E1\u30F3\u30C8\u30FB\u611F\u60F3']?.rich_text?.[0]?.plain_text || '', submitDate: props['\u63D0\u51FA\u65E5']?.date?.start || '', submitted: props['\u63D0\u51FA\u6E08\u30C1\u30A7\u30C3\u30AF']?.checkbox || false }; }); } catch(e) { console.error('\u5831\u544A\u66F8DB\u53D6\u5F97\u30A8\u30E9\u30FC:', e); } }
function renderReportStatus() { const staffList = ['\u77E2\u5CF6 \u660E\u548C','\u5927\u7530 \u5065','\u4E2D\u5DDD \u98AF','\u5E73\u91CE \u6625\u4E4B','\u5C71\u6839 \u7950\u53F8','\u6751\u7530 \u826F\u5178','\u5CA1\u5D0E \u7531\u7F8E','\u85E4\u4E95 \u771F\u7406\u4E9C']; const now = new Date(); const q = getQuarter(now); const periodMap = { 1: '\uFF11\u671F\uFF081\uFF5E3\u6708\uFF09', 2: '\uFF12\u671F\uFF084\uFF5E6\u6708\uFF09', 3: '\uFF13\u671F\uFF087\uFF5E9\u6708\uFF09', 4: '\uFF14\u671F\uFF0810\uFF5E12\u6708\uFF09' }; const currentPeriod = periodMap[q.q]; const container = document.getElementById('report-status-list'); const rows = staffList.map(fullName => { const lastName = STAFF_TO_LAST[fullName] || fullName; const submitted = reportRecords.find(r => (r.staff === lastName || r.staff === fullName) && r.period === currentPeriod && r.submitted); return '<div style="display:flex; align-items:center; justify-content:space-between; padding:9px 0; border-bottom:0.5px solid var(--border);"><span style="font-size:13px; font-weight:500; color:var(--text);">' + fullName + '</span><span class="badge ' + (submitted ? 'badge-done' : 'badge-pending') + '">' + (submitted ? '\u2713 \u63D0\u51FA\u6E08' : '\u672A\u63D0\u51FA') + '</span></div>'; }); container.innerHTML = rows.join('') + '<div style="font-size:11px; color:var(--text3); margin-top:8px;">\u5BFE\u8C61\u671F\uFF1A' + q.year + '\u5E74 ' + currentPeriod + '</div>'; }
function onRepStaffChange() { const staff = document.getElementById('rep-staff').value; if (!staff) { document.getElementById('rep-summary-box').style.display = 'none'; return; } const now = new Date(); const q = getQuarter(now); const { start, end } = getPeriodRange(q.year, q.q); const recs = allRecords.filter(r => r.staff === staff && r.date >= start && r.date <= end); const total = recs.reduce((s, r) => s + r.amount, 0); const box = document.getElementById('rep-summary-box'); const content = document.getElementById('rep-summary-content'); if (recs.length === 0) { box.style.display = 'none'; return; } box.style.display = 'block'; const byContent = {}; recs.forEach(r => { byContent[r.content] = (byContent[r.content] || 0) + r.amount; }); content.innerHTML = '<div style="background:var(--surface2); border-radius:var(--radius-sm); padding:12px;">' + Object.entries(byContent).map(([k,v]) => '<div style="display:flex; justify-content:space-between; font-size:13px; padding:3px 0;"><span style="color:var(--text2);">' + (CONTENT_ICON[k]||'') + ' ' + k + '</span><span style="font-weight:500; color:var(--text);">\xA5' + v.toLocaleString() + '</span></div>').join('') + '<div style="border-top:0.5px solid var(--border); margin-top:8px; padding-top:8px; display:flex; justify-content:space-between; font-size:13px; font-weight:600;"><span style="color:var(--text2);">\u5408\u8A08</span><span style="color:var(--amber);">\xA5' + total.toLocaleString() + '</span></div></div>'; }
async function submitReport() { const staff = document.getElementById('rep-staff').value; const period = document.getElementById('rep-period').value; const rating = document.getElementById('rep-rating').value; const comment = document.getElementById('rep-comment').value.trim(); if (!staff || !period || !rating) { showToast('\u793E\u54E1\u540D\u30FB\u5BFE\u8C61\u671F\u30FB\u8A55\u4FA1\u306F\u5FC5\u9808\u3067\u3059', '\u26A0\uFE0F'); return; } const lastName = STAFF_TO_LAST[staff] || staff; const already = reportRecords.find(r => (r.staff === lastName || r.staff === staff) && r.period === period && r.submitted); if (already) { showToast('\u3053\u306E\u671F\u306F\u3059\u3067\u306B\u63D0\u51FA\u6E08\u3067\u3059', '\u26A0\uFE0F'); return; } const btn = document.getElementById('rep-submit-btn'); btn.disabled = true; btn.innerHTML = '<span>\u63D0\u51FA\u4E2D...</span>'; const today = new Date().toISOString().slice(0,10); const title = lastName + '\uFF5C' + period + '\uFF5C' + today; try { await notionAPI('pages', 'POST', { parent: { database_id: '1d0a695f8e88802bb1e8ebab1c75c5c8' }, properties: { '\u540D\u524D': { title: [{ text: { content: title } }] }, '\u793E\u54E1\u540D': { select: { name: lastName } }, '\u5BFE\u8C61\u671F': { select: { name: period } }, '\u8A55\u4FA1': { select: { name: rating } }, '\u30B3\u30E1\u30F3\u30C8\u30FB\u611F\u60F3': { rich_text: [{ text: { content: comment } }] }, '\u63D0\u51FA\u65E5': { date: { start: today } }, '\u63D0\u51FA\u6E08\u30C1\u30A7\u30C3\u30AF': { checkbox: true } } }); showToast('\u5831\u544A\u66F8\u3092\u63D0\u51FA\u3057\u307E\u3057\u305F\uFF01', '\u2713'); document.getElementById('rep-rating').value = ''; document.getElementById('rep-comment').value = ''; await loadReportRecords(); renderReportStatus(); } catch(e) { showToast('\u63D0\u51FA\u306B\u5931\u6557\u3057\u307E\u3057\u305F', '\u2715'); console.error(e); } finally { btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 20 20" fill="#fff" width="20" height="20"><path d="M16.7 5.3a1 1 0 00-1.4 0L8 12.6 4.7 9.3a1 1 0 00-1.4 1.4l4 4a1 1 0 001.4 0l8-8a1 1 0 000-1.4z"/></svg>\u5831\u544A\u66F8\u3092\u63D0\u51FA\u3059\u308B'; } }
let toastTimer;
function showToast(msg, icon='\u2713') { const t = document.getElementById('toast'); document.getElementById('toast-msg').textContent = msg; document.getElementById('toast-icon').textContent = icon; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800); }
<\/script>
</body>
</html>`;
      return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    const token = env.NOTION_TOKEN;
    const NOTION_VERSION = "2025-09-03";
    const NOTION_VERSION_LEGACY = "2022-06-28";
    const baseHeaders = { "Authorization": "Bearer " + token, "Content-Type": "application/json" };

    // DB→data_source_id マップ（Worker isolate 内メモリキャッシュ）
    if (!globalThis.__dbToDsCache) globalThis.__dbToDsCache = new Map();
    const dsCache = globalThis.__dbToDsCache;

    async function resolveDataSourceId(dbId) {
      if (dsCache.has(dbId)) return dsCache.get(dbId);
      // 新API: GET /v1/databases/{id} は data_sources[] を返す
      const r = await fetch("https://api.notion.com/v1/databases/" + dbId, {
        method: "GET",
        headers: { ...baseHeaders, "Notion-Version": NOTION_VERSION },
      });
      if (!r.ok) return null;
      const j = await r.json();
      const dsId = j?.data_sources?.[0]?.id || null;
      if (dsId) dsCache.set(dbId, dsId);
      return dsId;
    }

    // ════════════════════════════════════════════════════════
    // D1 プロキシ分岐 (URL に ?source=d1 または header X-Source: d1 で有効化)
    // ════════════════════════════════════════════════════════
    const useD1 = url.searchParams.get('source') === 'd1' || request.headers.get('X-Source') === 'd1';
    const d1QueryMatch = url.pathname.match(/^\/(?:v1\/)?databases\/([a-f0-9-]+)\/query$/i);
    if (useD1 && d1QueryMatch && request.method === 'POST' && env.DB) {
      const dbId = d1QueryMatch[1].replace(/-/g, '');
      if (DB_ID_TO_TABLE[dbId]) {
        try {
          const body2 = await request.text();
          const j = body2 ? JSON.parse(body2) : {};
          const result = await d1Query(env, dbId, j);
          return new Response(JSON.stringify(result), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
        } catch(e) {
          return new Response(JSON.stringify({ object: 'error', code: 'd1_query_error', message: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
        }
      }
    }

    // 車軸配置の自動判定 (売上明細の最大数量から推定)
    // 2-2-D-D: 低床(R19.5/R17.5)サイズで12本以上
    // 2-D-D: TB(R22.5/R20)サイズで10本以上
    // 2-D: 6本
    if (url.pathname === '/d1/infer-axle-config' && request.method === 'POST' && env.DB) {
      try {
        const dryrun = (await request.json().catch(() => ({}))).dryrun || false;
        // 各車両の最大装着本数を集計
        const candidatesQ = `WITH max_qty AS (
            SELECT v.id, v.車番, v.車軸配置, v.前輪サイズ,
                   MAX(d.数量) AS 最大本数
            FROM 車両マスタ v
            JOIN 売上明細 d ON d.車番 = v.車番
            WHERE d.品目 IN ('組替','タイヤ販売(新品)','タイヤ販売(中古)','f.o.oパック')
              AND v.車番 NOT LIKE '%(旧%'
              AND v.前輪サイズ IS NOT NULL
            GROUP BY v.id, v.車番, v.車軸配置, v.前輪サイズ
          )
          SELECT id, 車番, 車軸配置 AS 現在, 前輪サイズ, 最大本数,
            -- アップグレードのみ。ダウングレードは禁止 (8本=部分作業のケースが多いため)
            CASE
              -- 12本以上 + 低床(R19.5/R17.5) → 2-2-D-D 確定
              WHEN (前輪サイズ LIKE '%R19.5%' OR 前輪サイズ LIKE '%R17.5%') AND 最大本数 >= 12 THEN '2-2-D-D'
              -- 14本以上 + TB(R22.5) → 2-D-D-D
              WHEN 前輪サイズ LIKE '%R22.5%' AND 最大本数 >= 14 THEN '2-D-D-D'
              -- 10本以上 + TB → 2-D-D
              WHEN (前輪サイズ LIKE '%R22.5%' OR 前輪サイズ LIKE '%R20%') AND 最大本数 >= 10 THEN '2-D-D'
              -- 現状空かつ6本=2-D
              WHEN 最大本数 >= 6 THEN '2-D'
              ELSE NULL
            END AS 推定
          FROM max_qty
          WHERE 最大本数 >= 6`;
        const r = await env.DB.prepare(candidatesQ).all();
        const rows = r.results || [];
        // 「より多軸への更新のみ」を許可 (ダウングレード禁止)
        const RANK = { '2-2': 0, '2-D': 1, '2-D-D': 2, '2-2-D-D': 3, '2-D-D-D': 3, 'トレーラー': 0 };
        const changes = rows.filter(r => {
          if (!r.推定 || r.現在 === r.推定) return false;
          const cur = RANK[r.現在] ?? -1;
          const next = RANK[r.推定] ?? -1;
          // 新規 (空) または より多軸へのアップグレードのみ
          return r.現在 == null || cur < next;
        });
        if (dryrun) {
          return new Response(JSON.stringify({ success: true, dryrun: true, total: rows.length, willChange: changes.length, samples: changes.slice(0, 30) }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
        }
        // 実行
        let applied = 0;
        for (let i = 0; i < changes.length; i += 200) {
          const batch = changes.slice(i, i + 200);
          for (const c of batch) {
            await env.DB.prepare(`UPDATE 車両マスタ SET 車軸配置 = ? WHERE id = ?`).bind(c.推定, c.id).run();
            applied++;
          }
        }
        return new Response(JSON.stringify({ success: true, applied, totalCandidates: changes.length }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // 車軸配置の不整合一括修正 (LTS/PC/バンサイズの2-D-D → 2-Dへ)
    if (url.pathname === '/d1/fix-axle-config' && request.method === 'POST' && env.DB) {
      try {
        const stmt = env.DB.prepare(`UPDATE 車両マスタ SET 車軸配置 = '2-D'
          WHERE 車軸配置 = '2-D-D' AND 車番 NOT LIKE '%(旧%'
          AND 前輪サイズ NOT LIKE '%R22.5%' AND 前輪サイズ NOT LIKE '%R20%'`);
        const res = await stmt.run();
        return new Response(JSON.stringify({ success: true, changes: res.meta?.changes || 0 }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // サービス系明細(組替/脱着/バランス/その他)で車両装着サイズと不一致のサイズをNULLクリア
    if (url.pathname === '/d1/clear-service-mismatch-sizes' && request.method === 'POST' && env.DB) {
      try {
        const body2 = await request.json().catch(() => ({}));
        const dryrun = !!body2.dryrun;
        const whereCl = `品目 IN ('組替','脱着','バランス','Fバランス','その他')
          AND タイヤサイズ IS NOT NULL AND タイヤサイズ != ''
          AND 車番 IN (
            SELECT v.車番 FROM 車両マスタ v
            WHERE v.前輪サイズ IS NOT NULL AND v.前輪サイズ != ''
          )
          AND タイヤサイズ NOT IN (
            SELECT v.前輪サイズ FROM 車両マスタ v WHERE v.車番 = 売上明細.車番
            UNION ALL
            SELECT v.後輪サイズ FROM 車両マスタ v WHERE v.車番 = 売上明細.車番 AND v.後輪サイズ IS NOT NULL
          )`;
        if (dryrun) {
          const r = await env.DB.prepare(`SELECT COUNT(*) AS c FROM 売上明細 WHERE ${whereCl}`).all();
          return new Response(JSON.stringify({ success: true, dryrun: true, willClear: r.results[0].c }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
        }
        const stmt = env.DB.prepare(`UPDATE 売上明細 SET タイヤサイズ = NULL WHERE ${whereCl}`);
        const res = await stmt.run();
        return new Response(JSON.stringify({ success: true, cleared: res.meta?.changes || 0 }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // 車両を別顧客に一括振替 (条件: メモに特定文字列を含む)
    if (url.pathname === '/d1/reassign-customer' && request.method === 'POST' && env.DB) {
      try {
        const { target_customer_id, memo_keywords } = await request.json();
        if (!target_customer_id || !Array.isArray(memo_keywords) || memo_keywords.length === 0)
          return new Response(JSON.stringify({ error: 'target_customer_id & memo_keywords[] required' }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        const orClauses = memo_keywords.map(() => 'メモ LIKE ?').join(' OR ');
        const params = [target_customer_id, ...memo_keywords.map(k => '%' + k + '%'), target_customer_id];
        const sql2 = `UPDATE 車両マスタ SET 顧客ID = ? WHERE 車番 NOT LIKE '%(旧%' AND (${orClauses}) AND 顧客ID != ?`;
        const stmt = env.DB.prepare(sql2).bind(...params);
        const res = await stmt.run();
        return new Response(JSON.stringify({ success: true, changes: res.meta?.changes || 0 }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // 重複車両ペアの一覧取得
    if (url.pathname === '/d1/duplicate-vehicles' && request.method === 'POST' && env.DB) {
      try {
        const r = await env.DB.prepare(`
          WITH v AS (
            SELECT id, 車番, 顧客ID, 前輪サイズ, 車種, メモ,
              REPLACE(REPLACE(REPLACE(REPLACE(車番,'-',''),' ',''),'　',''),'・','') AS norm
            FROM 車両マスタ WHERE 車番 NOT LIKE '%(旧%' AND 顧客ID IS NOT NULL
          )
          SELECT
            v1.id AS short_id, v1.車番 AS short_plate, v1.前輪サイズ AS short_size, v1.車種 AS short_type,
            v2.id AS long_id, v2.車番 AS long_plate, v2.前輪サイズ AS long_size, v2.車種 AS long_type,
            COALESCE(e.得意先名, c.顧客名) AS 顧客名,
            (SELECT COUNT(*) FROM 売上明細 WHERE 車番 = v1.車番) AS short_sales,
            (SELECT COUNT(*) FROM 売上明細 WHERE 車番 = v2.車番) AS long_sales,
            (SELECT MAX(s.売上日) FROM 売上明細 d JOIN 売上伝票 s ON d.売上伝票ID=s.id WHERE d.車番 = v1.車番) AS short_last,
            (SELECT MAX(s.売上日) FROM 売上明細 d JOIN 売上伝票 s ON d.売上伝票ID=s.id WHERE d.車番 = v2.車番) AS long_last
          FROM v v1
          JOIN v v2 ON v1.顧客ID = v2.顧客ID AND v1.id != v2.id
            AND length(v1.norm) < length(v2.norm)
            AND v2.norm LIKE '%' || v1.norm
          LEFT JOIN 得意先マスタ e ON v1.顧客ID = e.id
          LEFT JOIN 顧客情報DB c ON v1.顧客ID = c.id
          ORDER BY 顧客名, v2.車番
        `).all();
        return new Response(JSON.stringify({ success: true, pairs: r.results }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // 重複車両を統合: keep_id の車番に売上明細をマージし、delete_id を削除
    if (url.pathname === '/d1/merge-duplicate-vehicle' && request.method === 'POST' && env.DB) {
      try {
        const { keep_id, delete_id } = await request.json();
        if (!keep_id || !delete_id) return new Response(JSON.stringify({ error: 'keep_id & delete_id required' }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        // keep_id の車番取得
        const k = await env.DB.prepare(`SELECT 車番 FROM 車両マスタ WHERE id = ?`).bind(keep_id).all();
        const d = await env.DB.prepare(`SELECT 車番 FROM 車両マスタ WHERE id = ?`).bind(delete_id).all();
        if (!k.results.length || !d.results.length) return new Response(JSON.stringify({ error: 'vehicle not found' }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
        const keepPlate = k.results[0].車番;
        const delPlate = d.results[0].車番;
        // 売上明細の車番を更新
        const moved = await env.DB.prepare(`UPDATE 売上明細 SET 車番 = ? WHERE 車番 = ?`).bind(keepPlate, delPlate).run();
        // 削除
        const deleted = await env.DB.prepare(`DELETE FROM 車両マスタ WHERE id = ?`).bind(delete_id).run();
        return new Response(JSON.stringify({ success: true, moved: moved.meta?.changes || 0, deleted: deleted.meta?.changes || 0, keepPlate, delPlate }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // PC専用サイズ車両の車種を「乗用車」に統一
    if (url.pathname === '/d1/normalize-pc-vehicle-type' && request.method === 'POST' && env.DB) {
      try {
        const body2 = await request.json().catch(() => ({}));
        const dryrun = !!body2.dryrun;
        const sqlText = `UPDATE 車両マスタ SET 車種 = '乗用車'
          WHERE 車番 NOT LIKE '%(旧%'
            AND (車種 IS NULL OR 車種 != '乗用車')
            AND 前輪サイズ IN (SELECT サイズ FROM サイズマスタ WHERE カテゴリ群 = 'PC')`;
        if (dryrun) {
          const r = await env.DB.prepare(sqlText.replace(/^UPDATE 車両マスタ SET 車種 = '乗用車'\s+/, 'SELECT COUNT(*) AS c FROM 車両マスタ ')).all();
          return new Response(JSON.stringify({ success: true, dryrun: true, willChange: r.results[0].c }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
        }
        const stmt = env.DB.prepare(sqlText);
        const res = await stmt.run();
        return new Response(JSON.stringify({ success: true, changes: res.meta?.changes || 0 }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // 得意先名/顧客名のリネーム (得意先マスタ・顧客情報DB 両対応)
    if (url.pathname === '/d1/rename-customer' && request.method === 'POST' && env.DB) {
      try {
        const { id, new_name } = await request.json();
        if (!id || !new_name) return new Response(JSON.stringify({ error: 'id & new_name required' }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        const r1 = await env.DB.prepare(`UPDATE 得意先マスタ SET 得意先名 = ? WHERE id = ?`).bind(new_name, id).run();
        const r2 = await env.DB.prepare(`UPDATE 顧客情報DB SET 顧客名 = ? WHERE id = ?`).bind(new_name, id).run();
        return new Response(JSON.stringify({ success: true, customers: r1.meta?.changes || 0, endusers: r2.meta?.changes || 0 }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // 「タイヤ販売(新品/中古/更生)」優先で前輪サイズを再計算
    // 既存ロジック: 組替も含む装着系最頻値 → 組替本数(=旧サイズ)が勝つ問題があった
    if (url.pathname === '/d1/recalc-front-size' && request.method === 'POST' && env.DB) {
      try {
        const body2 = await request.json().catch(() => ({}));
        const dryrun = !!body2.dryrun;
        // 真の販売(新品/中古/更生)優先で前輪サイズを取得
        const r = await env.DB.prepare(`WITH true_size AS (
          SELECT v.id, v.車番, v.前輪サイズ AS 現在,
            (SELECT d.タイヤサイズ FROM 売上明細 d JOIN 売上伝票 s ON d.売上伝票ID = s.id
              WHERE d.車番 = v.車番 AND d.タイヤサイズ IS NOT NULL AND d.タイヤサイズ != ''
                AND d.品目 IN ('タイヤ販売(新品)','タイヤ販売(中古)','タイヤ販売(更生)')
              GROUP BY d.タイヤサイズ
              ORDER BY MAX(s.売上日) DESC, COUNT(*) DESC LIMIT 1) AS 真サイズ
          FROM 車両マスタ v
          WHERE v.車番 NOT LIKE '%(旧%' AND v.前輪サイズ IS NOT NULL
        )
        SELECT id, 車番, 現在, 真サイズ FROM true_size
        WHERE 真サイズ IS NOT NULL AND 真サイズ != 現在`).all();
        const changes = r.results || [];
        if (dryrun) {
          return new Response(JSON.stringify({ success: true, dryrun: true, willChange: changes.length, samples: changes.slice(0, 30) }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
        }
        let applied = 0;
        for (const c of changes) {
          await env.DB.prepare(`UPDATE 車両マスタ SET 前輪サイズ = ? WHERE id = ?`).bind(c.真サイズ, c.id).run();
          applied++;
        }
        return new Response(JSON.stringify({ success: true, applied }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // 車両マスタ「(旧)」サフィックス車両を一括削除 (バックアップ後の整理用)
    if (url.pathname === '/d1/delete-archived-vehicles' && request.method === 'POST' && env.DB) {
      try {
        const stmt = env.DB.prepare(`DELETE FROM 車両マスタ WHERE 車番 LIKE '%(旧%'`);
        const res = await stmt.run();
        return new Response(JSON.stringify({ success: true, deleted: res.meta?.changes || 0 }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // 車両マスタ更新 (vehicle-master.html 編集用)
    // Notion側は別途 PATCH で更新済み・D1も即時反映するための専用エンドポイント
    if (url.pathname === '/d1/update-vehicle' && request.method === 'POST' && env.DB) {
      try {
        const body2 = await request.json();
        const { id } = body2;
        if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        // 許可カラムのホワイトリスト (任意のカラムを上書きさせない)
        const ALLOWED_FIELDS = ['車番','車種','仕様','前輪サイズ','後輪サイズ','前輪パターン','後輪パターン','本数','カテゴリ','メモ','管理番号','車軸配置','顧客ID'];
        const sets = [];
        const params = [];
        for (const f of ALLOWED_FIELDS) {
          if (Object.prototype.hasOwnProperty.call(body2, f)) {
            sets.push(`"${f}" = ?`);
            const v = body2[f];
            params.push(v === '' ? null : v);
          }
        }
        if (!sets.length) return new Response(JSON.stringify({ error: 'no fields to update' }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        params.push(id);
        const stmt = env.DB.prepare(`UPDATE 車両マスタ SET ${sets.join(', ')} WHERE id = ?`).bind(...params);
        const res = await stmt.run();
        return new Response(JSON.stringify({ success: true, changes: res.meta?.changes || 0 }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // 売上明細の車番を更新 (弥生備考ヒントから振り直し用)
    if (url.pathname === '/d1/update-detail-plate' && request.method === 'POST' && env.DB) {
      try {
        const { detail_id, plate } = await request.json();
        if (!detail_id) return new Response(JSON.stringify({ error: 'detail_id required' }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        const stmt = env.DB.prepare(`UPDATE 売上明細 SET 車番 = ? WHERE id = ?`).bind(plate || null, detail_id);
        const res = await stmt.run();
        return new Response(JSON.stringify({ success: true, changes: res.meta?.changes || 0 }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // 売上明細のタイヤサイズをNULLクリア (サイズ不整合修正用)
    if (url.pathname === '/d1/clear-detail-size' && request.method === 'POST' && env.DB) {
      try {
        const { detail_id, detail_ids } = await request.json();
        const ids = detail_ids || (detail_id ? [detail_id] : []);
        if (!ids.length) return new Response(JSON.stringify({ error: 'detail_id or detail_ids required' }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        if (ids.length > 5000) return new Response(JSON.stringify({ error: 'too many ids (max 5000)' }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        const placeholders = ids.map(() => '?').join(',');
        const stmt = env.DB.prepare(`UPDATE 売上明細 SET タイヤサイズ = NULL WHERE id IN (${placeholders})`).bind(...ids);
        const res = await stmt.run();
        return new Response(JSON.stringify({ success: true, changes: res.meta?.changes || 0 }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // D1 特殊エンドポイント: /d1/sql で直接SQL実行（admin用）
    if (url.pathname === '/d1/sql' && request.method === 'POST' && env.DB) {
      try {
        const { sql, params } = await request.json();
        // 安全のため読み取り系 (SELECT / WITH) のみ許可
        if (!/^\s*(SELECT|WITH)\s/i.test(sql)) {
          return new Response(JSON.stringify({ error: 'Only SELECT/WITH allowed' }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        }
        const stmt = env.DB.prepare(sql).bind(...(params || []));
        const res = await stmt.all();
        return new Response(JSON.stringify(res), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    // DEBUG: /legacy/databases/{id}/query でレガシー2022-06-28 API
    const legacyMatch = url.pathname.match(/^\/legacy\/databases\/([a-f0-9-]+)\/query$/i);
    if (legacyMatch && request.method === "POST") {
      const body2 = await request.text();
      const res2 = await fetch("https://api.notion.com/v1/databases/" + legacyMatch[1] + "/query", {
        method: "POST",
        headers: { ...baseHeaders, "Notion-Version": NOTION_VERSION_LEGACY },
        body: body2,
      });
      const text2 = await res2.text();
      return new Response(text2, { status: res2.status, headers: { ...cors, "Content-Type": "application/json" } });
    }

    // /databases/{id}/query → /data_sources/{ds_id}/query に自動変換
    const dbQueryMatch = url.pathname.match(/^\/(?:v1\/)?databases\/([a-f0-9-]+)\/query$/i);
    if (dbQueryMatch && request.method === "POST") {
      const dbId = dbQueryMatch[1];
      try {
        const dsId = await resolveDataSourceId(dbId);
        if (dsId) {
          const body2 = await request.text();
          const res2 = await fetch("https://api.notion.com/v1/data_sources/" + dsId + "/query" + url.search, {
            method: "POST",
            headers: { ...baseHeaders, "Notion-Version": NOTION_VERSION },
            body: body2,
          });
          const text2 = await res2.text();
          return new Response(text2, { status: res2.status, headers: { ...cors, "Content-Type": "application/json" } });
        }
      } catch (e) {
        // フォールバック: 旧API
      }
    }

    // それ以外 or フォールバック: 旧APIパスをそのまま通す（従来互換）
    const notionUrl = "https://api.notion.com/v1" + url.pathname + url.search;
    const body = ["POST", "PATCH", "PUT"].includes(request.method) ? await request.text() : void 0;
    // pages/*, databases/{id} GET, その他は新バージョンでも旧パス有効
    const res = await fetch(notionUrl, {
      method: request.method,
      headers: { ...baseHeaders, "Notion-Version": NOTION_VERSION },
      body
    });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { ...cors, "Content-Type": "application/json" } });
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
