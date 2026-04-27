// 商品マスタの「銘柄空」品 を A表 と突合して候補リスト化
// 出力: match-candidates.json (ヒット候補) と match-orphan.json (ヒットなし=旧型/廃番候補)
const fs = require('fs');
const PROXY = 'https://notion-proxy.33322666666mm.workers.dev';

async function d1(sql) {
  const r = await fetch(PROXY + '/d1/sql', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ sql })
  });
  return r.json();
}

(async () => {
  // 商品マスタ: 銘柄空 or メーカー空
  console.log('1. 商品マスタ取得...');
  const prodRes = await d1(`
    SELECT id, 商品コード, 商品名, タイヤサイズ, タイヤ銘柄, メーカー, ブランド
    FROM 商品マスタ
    WHERE (タイヤ銘柄 IS NULL OR タイヤ銘柄 = '' OR メーカー IS NULL OR メーカー = '')
      AND 商品名 IS NOT NULL AND 商品名 != ''
  `);
  const products = prodRes.results || [];
  console.log('  対象商品:', products.length, '件');

  // A表 全件 (パターン+サイズ+メーカー+ブランド)
  console.log('2. A表取得...');
  const aRes = await d1(`
    SELECT パターン, サイズ, メーカー, ブランド
    FROM A表
    WHERE パターン IS NOT NULL AND パターン != ''
    GROUP BY パターン, サイズ, メーカー
  `);
  const aTable = aRes.results || [];
  console.log('  A表:', aTable.length, '件');

  // パターン辞書 (パターン名 → メーカー/ブランド) を構築
  // 「PROXES Sport 2」 → TOYO/PROXES
  const patternDict = {};
  aTable.forEach(a => {
    const p = (a.パターン||'').trim();
    if (!p) return;
    if (!patternDict[p]) patternDict[p] = { maker: a.メーカー, brand: a.ブランド, sizes: new Set() };
    if (a.サイズ) patternDict[p].sizes.add(a.サイズ);
  });
  // パターン名のショート形 (CF3, NH200 など) も辞書化
  const shortDict = {};
  Object.entries(patternDict).forEach(([full, info]) => {
    // スペースで区切って各パーツを試す
    const parts = full.split(/\s+/);
    parts.forEach(p => {
      if (p.length >= 2 && /[A-Za-z0-9Ⅱ-ⅩⅠⅡⅢ]/.test(p) && !['SUV','LT','PROXES','OPEN','COUNTRY','TRANPATH','NANOENERGY','DELVEX','PROXES','REGNO','POTENZA','ECOPIA','DUELER','PLAYZ','BLIZZAK','ALENZA','VEURO','LE','MANS','ENASAVE','DIREZZA','SP','SPORT','MAXX','GRANDTREK','WINTER','ADVAN','BLUEARTH','GEOLANDAR','ICEGUARD','PILOT','PRIMACY','CROSSCLIMATE','CINTURATO','POWERGY','SCORPION'].includes(p.toUpperCase())) {
        if (!shortDict[p]) shortDict[p] = info;
      }
    });
    // フル名も
    shortDict[full] = info;
  });
  console.log('  パターン辞書:', Object.keys(patternDict).length, '個');
  console.log('  ショート辞書:', Object.keys(shortDict).length, '個');

  const matched = [];
  const orphan = [];

  for (const p of products) {
    const name = (p.商品名 || '').trim();
    let bestMatch = null;
    // 1. ロングマッチ: 商品名にパターンフル名が含まれる
    for (const [pat, info] of Object.entries(patternDict)) {
      if (name.includes(pat)) {
        bestMatch = { pattern: pat, ...info, matchType: 'full' };
        break;
      }
    }
    // 2. ショートマッチ: 商品名の単語 (英数字) と short dict 突合
    if (!bestMatch) {
      const tokens = name.split(/[\s　]+/);
      for (const t of tokens) {
        const trimmed = t.replace(/[、。()（）]/g, '').trim();
        if (trimmed.length < 2) continue;
        if (shortDict[trimmed]) {
          bestMatch = { pattern: trimmed, ...shortDict[trimmed], matchType: 'short' };
          break;
        }
      }
    }
    if (bestMatch) {
      matched.push({
        id: p.id, code: p.商品コード, name: p.商品名,
        currentSize: p.タイヤサイズ, currentMaker: p.メーカー, currentBrand: p.ブランド,
        suggestedPattern: bestMatch.pattern,
        suggestedMaker: bestMatch.maker,
        suggestedBrand: bestMatch.brand,
        matchType: bestMatch.matchType,
      });
    } else {
      orphan.push({
        id: p.id, code: p.商品コード, name: p.商品名,
        currentSize: p.タイヤサイズ, currentMaker: p.メーカー
      });
    }
  }

  console.log('\n━━━━━━━━━━━━━━━');
  console.log('✅ ヒット (候補あり):', matched.length, '件');
  console.log('❌ オーファン (旧型/特殊品):', orphan.length, '件');

  // メーカー別マッチ集計
  const byMaker = {};
  matched.forEach(m => { byMaker[m.suggestedMaker] = (byMaker[m.suggestedMaker]||0) + 1; });
  console.log('\nヒット内訳 (推定メーカー別):', byMaker);

  // マッチタイプ別
  const byType = { full: 0, short: 0 };
  matched.forEach(m => byType[m.matchType]++);
  console.log('\nマッチ精度:', byType);

  // サンプル出力
  console.log('\n━━ ヒットサンプル (10件):');
  matched.slice(0, 10).forEach(m => {
    console.log(`  [${m.code}] ${m.name}`);
    console.log(`    → ${m.suggestedMaker} / ${m.suggestedBrand} / ${m.suggestedPattern} (${m.matchType})`);
  });
  console.log('\n━━ オーファンサンプル (15件、これらが廃番候補):');
  orphan.slice(0, 15).forEach(o => {
    console.log(`  [${o.code}] ${o.name}`);
  });

  fs.writeFileSync('scripts/match-candidates.json', JSON.stringify(matched, null, 2));
  fs.writeFileSync('scripts/match-orphan.json', JSON.stringify(orphan, null, 2));
  console.log('\n💾 scripts/match-candidates.json と match-orphan.json に保存');
})();
