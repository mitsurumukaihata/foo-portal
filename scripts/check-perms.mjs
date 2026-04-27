const r = await fetch('https://notion-proxy.33322666666mm.workers.dev/d1/sql', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ sql: `SELECT e.氏名, e.アプリグループ, e.id, COUNT(p.アプリID) cnt, GROUP_CONCAT(p.アプリID) apps FROM 社員マスタ e LEFT JOIN 社員アプリ権限 p ON p.社員ID = e.id WHERE e.在籍 = '在籍中' GROUP BY e.id ORDER BY e.表示順` })
});
const j = await r.json();
console.log(JSON.stringify(j, null, 2));
