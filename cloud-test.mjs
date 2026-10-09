import { chromium } from 'playwright'; import http from 'http'; import fs from 'fs';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(fs.readFileSync('dist/index.html')); }).listen(8140);
const BASE = process.env.URL0 || 'http://localhost:8140/';
const KEY = 'sk-or-v1-TESTSECRETKEY1234567890abcdef';
const b = await chromium.launch({ args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--allow-loopback-in-peer-connection'] });
const mk = async (u) => { const p = await (await b.newContext()).newPage(); p.on('dialog', (d) => d.accept()); await p.goto(u); return p; };
const res = []; const ok = (n, v, x) => { res.push(v); console.log(v ? 'PASS' : 'FAIL', n, x || ''); };
const A = await mk(BASE); await A.click('#create'); const url = A.url(); await A.click('#nocam'); await A.waitForTimeout(1500);
const B = await mk(url); await B.click('#nocam'); await B.waitForTimeout(7000);
const reqs = []; let mode = 'ok'; let replies = [];
await A.route('https://openrouter.ai/**', async (r) => {
  const q = r.request(); reqs.push({ url: q.url(), auth: q.headers()['authorization'] || '', body: q.postData() || '' });
  const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: h });
  if (mode === '401') return r.fulfill({ status: 401, headers: h, body: '{}' });
  if (mode === '429') return r.fulfill({ status: 429, headers: h, body: '{}' });
  const text = replies.shift() || 'hello from cloud';
  r.fulfill({ status: 200, headers: { ...h, 'content-type': 'text/event-stream' }, body: 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: [DONE]\n\n' });
});
ok('cloud box hidden until switched on', await A.locator('#orbox').isHidden());
await A.check('#cloudon'); ok('warning shown', /sent to OpenRouter/.test(await A.textContent('#orbox')) && !(await A.locator('#orbox').isHidden()));
ok('ask disabled without key', await A.locator('#aiask').isDisabled());
await A.fill('#orkey', KEY); ok('ask enabled with key (no local model load)', !(await A.locator('#aiask').isDisabled()));
await A.fill('#aiq', 'make a thing'); await A.click('#aiask'); await A.waitForTimeout(800);
ok('request went to openrouter.ai only, with key as Bearer', reqs.some((x) => x.url.startsWith('https://openrouter.ai/api/v1/chat/completions') && x.auth === 'Bearer ' + KEY) && reqs.every((x) => x.url.startsWith('https://openrouter.ai/')), JSON.stringify(reqs.map((x) => x.url)));
ok('uses a :free model', reqs.some((x) => /:free"|openrouter\/free/.test(x.body)));
ok('answer shows and can be proposed', /hello from cloud/.test(await A.textContent('#aiout')));
ok('request body does not contain the key', reqs.every((x) => !x.body.includes(KEY)));
// key never in room
await A.click('#aiins'); await A.waitForTimeout(1500);
const dump = (p) => p.evaluate(() => JSON.stringify({ t: window.__pr.doc.getText('code').toString(), p: window.__pr.doc.getMap('proposals').toJSON(), c: window.__pr.doc.getMap('checkpoints').toJSON(), a: window.__pr.doc.getMap('authors').toJSON(), log: (window.__audit && window.__audit.log) || [], html: document.getElementById('audit') ? document.getElementById('audit').textContent : '' }));
const da = await dump(A), db = await dump(B);
ok('key not in shared doc/proposals/checkpoints on A', !da.includes(KEY));
ok('key not in anything B sees or any frame sent', !db.includes(KEY) && !da.includes('TESTSECRETKEY'));
ok('B sees the proposal (room still works)', /hello from cloud/.test(db));
const ls = await A.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
ok('key not stored when Remember is off', !ls.includes(KEY));
await A.check('#orremember'); await A.fill('#orkey', KEY + 'x'); const ls2 = await A.evaluate(() => localStorage.getItem('pr_or_key')); ok('Remember stores on this computer only', ls2 === KEY + 'x');
await A.click('#orforget'); ok('Forget clears the key', (await A.evaluate(() => localStorage.getItem('pr_or_key'))) === null && (await A.inputValue('#orkey')) === '');
await A.fill('#orkey', KEY);
// errors
mode = '401'; await A.fill('#aiq', 'x'); await A.click('#aiask'); await A.waitForTimeout(800); ok('401 message', /rejected the key/.test(await A.textContent('#aiout')), await A.textContent('#aiout'));
mode = '429'; await A.click('#aiask'); await A.waitForTimeout(800); ok('429 message', /Rate limit reached/.test(await A.textContent('#aiout')), await A.textContent('#aiout'));
// counter and block
mode = 'ok'; await A.evaluate(() => localStorage.setItem('pr_or_count', JSON.stringify({ day: new Date().toISOString().slice(0, 10), n: 50 }))); const n0 = reqs.length;
await A.evaluate(() => window.__pr.cloudUi()); await A.click('#aiask'); await A.waitForTimeout(600); ok('blocked at 50 without calling the API', /free cloud requests today/.test(await A.textContent('#aiout')) && reqs.length === n0, await A.textContent('#aiout'));
await A.evaluate(() => localStorage.setItem('pr_or_count', JSON.stringify({ day: new Date().toISOString().slice(0, 10), n: 3 }))); await A.evaluate(() => window.__pr.cloudUi());
ok('usage line shows count', /3 of about 50/.test(await A.textContent('#cloudst')));
// auto-repair capped at 2 on cloud
const BAD = '```html\n<body><script>\nconst s = 0;\ns = 1;\n</script></body>\n```';
replies = [BAD, BAD, BAD, BAD]; const n1 = reqs.length; await A.fill('#onebox', 'a hard game'); await A.click('#build'); await A.waitForTimeout(12000);
const used = reqs.filter((x) => x.body).length - n1; ok('cloud auto-repair capped at 2 fixes (3 requests)', used === 3 && /after 2 automatic fixes/.test(await A.textContent('#buildst')), used + ' | ' + (await A.textContent('#buildst')));
const all = res.every(Boolean); console.log(all ? 'CLOUD PASS' : 'CLOUD FAIL'); await b.close(); srv.close(); process.exit(all ? 0 : 1);
