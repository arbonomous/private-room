import { chromium } from 'playwright'; import http from 'http'; import fs from 'fs';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(fs.readFileSync('dist/index.html')); }).listen(8133);
const BASE = process.env.URL0 || 'http://localhost:8133/';
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await (await b.newContext()).newPage(); p.on('dialog', (d) => d.accept()); await p.goto(BASE); await p.click('#create'); await p.click('#nocam'); await p.waitForTimeout(1200);
const F = p.frameLocator('#frame'); const res = [];
const ok = (n, v, x) => { res.push(v); console.log(v ? 'PASS' : 'FAIL', n, x || ''); };
const noerr = async () => !/Error|Blocked/.test(await p.textContent('#pvlog'));
const px = () => F.locator('#c').evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) n++; return n; });
// snake
await p.click('[data-t=snake]'); await p.waitForTimeout(1500); ok('snake no error', await noerr()); const a1 = await px();
await F.locator('body').click(); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(600); ok('snake draws', a1 > 100, a1 + ' px');
await p.waitForTimeout(3500); ok('snake dies on wall and shows game over', /Game over|Score/.test(await F.locator('#msg').innerText()), await F.locator('#msg').innerText());
// pong
await p.click('[data-t=pong]'); await p.waitForTimeout(1500); ok('pong no error', await noerr()); ok('pong draws', (await px()) > 100);
await p.keyboard.press('ArrowDown'); await p.waitForTimeout(3000); ok('pong scores update', /You \d - \d Computer|wins/.test(await F.locator('#msg').innerText()), await F.locator('#msg').innerText());
// clicker
await p.click('[data-t=clicker]'); await p.waitForTimeout(1200); ok('clicker no error', await noerr());
for (let i = 0; i < 12; i++) await F.locator('#cookie').click(); await F.locator('#b1').click(); await F.locator('#b1').click().catch(() => {});
const m = await F.locator('#msg').innerText(); ok('clicker counts and buys', /Cookies: \d+/.test(m) && /2 per click|1 per click/.test(m), m);
// memory
await p.click('[data-t=memory]'); await p.waitForTimeout(1200); ok('memory no error', await noerr());
const btns = F.locator('#board button'); ok('memory has 16 cards', (await btns.count()) === 16);
const icons = await btns.evaluateAll((l) => l.map((x) => x.dataset.icon)); let done = 0;
for (let i = 0; i < 16; i++) { const j = icons.findIndex((v, k) => k > i && v === icons[i] && v !== null && icons[i] !== null); if (icons[i] === null || j < 0) continue; await btns.nth(i).click(); await btns.nth(j).click(); icons[i] = null; icons[j] = null; done++; }
await p.waitForTimeout(300); const mm = await F.locator('#msg').innerText(); ok('memory can be won', done === 8 && /won in 8 moves/.test(mm), mm);
const cps = await p.evaluate(() => window.__pr.doc.getMap('checkpoints').size); ok('old code saved as checkpoint before loading', cps >= 3, 'checkpoints ' + cps);
const all = res.every(Boolean); console.log(all ? 'TPL PASS' : 'TPL FAIL'); await b.close(); srv.close(); process.exit(all ? 0 : 1);
