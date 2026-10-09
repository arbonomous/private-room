import { chromium } from 'playwright'; import http from 'http'; import fs from 'fs';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(fs.readFileSync('dist/index.html')); }).listen(8127);
const b = await chromium.launch({ args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const mk = async (u) => { const p = await (await b.newContext()).newPage(); await p.goto(u); return p; };
const A = await mk('http://localhost:8127/'); await A.click('#create'); await A.click('#nocam'); await A.waitForTimeout(1000);
await A.evaluate(() => { localStorage.setItem('secret', 'room-data'); window.__msgs = []; addEventListener('message', (e) => { if (e.data && e.data.r === undefined && e.data.top) window.__msgs.push(e.data); }); });
const code = `<body><h1 id="x">hello game</h1><canvas id="c" width="50" height="50"></canvas><script>
const r = {};
try { r.top = String(window.top.__pr); } catch (e) { r.top = 'blocked'; }
try { r.parentDoc = String(parent.document.title); } catch (e) { r.parentDoc = 'blocked'; }
try { r.ls = String(localStorage.getItem('secret')); } catch (e) { r.ls = 'blocked'; }
try { r.cookie = document.cookie === '' ? 'empty' : 'has'; } catch (e) { r.cookie = 'blocked'; }
fetch('https://example.com/').then(() => { r.fetch = 'LEAKED'; }).catch(() => { r.fetch = 'blocked'; }).finally(() => { const i = new Image(); i.onload = () => { r.img = 'LEAKED'; parent.postMessage(r, '*'); }; i.onerror = () => { r.img = 'blocked'; parent.postMessage(r, '*'); }; i.src = 'https://example.com/x.png'; });
<\/script></body>`;
await A.click('.cm-content'); await A.evaluate((c) => { const t = window.__pr.doc.getText('code'); t.insert(0, c); }, code);
await A.click('#run'); await A.waitForTimeout(3000);
const msgs = await A.evaluate(() => window.__msgs);
console.log('sandbox report', JSON.stringify(msgs[0]));
const txt = await A.frameLocator('#frame').locator('#x').textContent().catch((e) => 'ERR ' + e.message.slice(0, 80)); console.log('rendered:', txt);
console.log('sandbox attr:', await A.getAttribute('#frame', 'sandbox'));
await A.screenshot({ path: '/tmp/pr_pv.png' });
const ok = msgs[0] && msgs[0].top === 'blocked' && msgs[0].parentDoc === 'blocked' && msgs[0].ls === 'null' && msgs[0].fetch === 'blocked' && msgs[0].img === 'blocked' && txt === 'hello game';
console.log(ok ? 'PV PASS' : 'PV FAIL'); await b.close(); srv.close(); process.exit(ok ? 0 : 1);
