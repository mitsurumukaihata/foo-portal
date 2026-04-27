// 経営3アプリ (analytics/briefing/customer360) を 大田/中川/綾花 から取り消し (向畑充は維持)
const targets = [
  { empId: '326a695f-8e88-8122-99ee-eb6c65288bb1', name: '大田 健' },
  { empId: '326a695f-8e88-8166-a015-d56c61af78b5', name: '中川 颯' },
  { empId: '329a695f-8e88-81b5-82e8-cc819b4b41a8', name: '向畑 綾花' },
];
const REMOVE = new Set(['analytics','briefing','customer360']);
const URL = 'https://notion-proxy.33322666666mm.workers.dev';
async function sql(q) {
  const r = await fetch(URL + '/d1/sql', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({sql:q}) });
  return r.json();
}
async function setPerms(empId, apps) {
  const r = await fetch(URL + '/d1/set-employee-app-permissions', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ 社員ID: empId, アプリID一覧: apps })
  });
  return r.json();
}
for (const t of targets) {
  const cur = await sql(`SELECT アプリID FROM 社員アプリ権限 WHERE 社員ID = '${t.empId}'`);
  const have = (cur.results || []).map(x => x.アプリID);
  const next = have.filter(a => !REMOVE.has(a));
  const j = await setPerms(t.empId, next);
  console.log(t.name, `: ${have.length} → ${next.length} apps`, j.success ? 'OK' : 'FAIL', j.error || '');
}
console.log('\n--- 経営3アプリ 付与状況 (戻し後) ---');
const r = await sql(`SELECT e.氏名, e.アプリグループ, GROUP_CONCAT(p.アプリID) apps FROM 社員マスタ e LEFT JOIN 社員アプリ権限 p ON p.社員ID = e.id AND p.アプリID IN ('analytics','briefing','customer360') WHERE e.在籍 = '在籍中' GROUP BY e.id ORDER BY e.表示順`);
console.log(JSON.stringify(r.results, null, 2));
