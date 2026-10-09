import { chromium } from 'playwright'; import http from 'http'; import fs from 'fs';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(fs.readFileSync('dist/index.html')); }).listen(8172);
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--allow-loopback-in-peer-connection'] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const ok = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); if (!c) fail++; };
const mk = async (u) => { const c = await b.newContext(); const p = await c.newPage(); p.on('dialog', (d) => d.accept()); await p.goto(u); return p; };
const A = await mk('http://localhost:8172/'); await A.fill('#name', 'Ann'); await A.click('#create'); const hostUrl = A.url();
ok('host url has secret part', /\.s[\w-]+$/.test(hostUrl));
const invite = await A.evaluate(() => 0).then(() => hostUrl.replace(/\.s[\w-]+$/, ''));
await A.click('#cam'); await wait(2500);
const B = await mk(invite); await B.fill('#name', 'Bo'); await B.click('#cam'); await wait(9000);
ok('B sees waiting screen', await B.isVisible('#wait'));
ok('A sees knock', (await A.textContent('#knocks')).includes('Bo wants to join'));
await B.evaluate(() => window.__pr.forceSend(0, JSON.stringify({ t: 'sneak' }))); await A.evaluate(() => window.__pr.forceSend(0, JSON.stringify({ t: 'leak' }))); await wait(1500);
ok('unapproved chat dropped both ways', !(await A.textContent('#log')).includes('sneak') && !(await B.textContent('#log')).includes('leak'));
ok('no tile of A on B before approval', await B.evaluate(() => document.querySelectorAll('figure').length) === 1);
// impostor with the key but no host secret
const C = await mk(invite); await C.click('#nocam'); await wait(7000);
await C.evaluate(() => { window.__pr.forceSend(9, new Uint8Array(64)); window.__pr.forceSend(11, JSON.stringify({ self: true, members: [0, 1] })); }); await wait(1500);
ok('impostor cannot self-approve', await C.isVisible('#wait') && await C.evaluate(() => document.querySelectorAll('figure').length) === 1);
await A.click('.knock button:first-of-type'); await wait(10000);
ok('B in call after approval', !(await B.isVisible('#wait')) && await B.evaluate(() => document.querySelectorAll('figure').length) === 2);
ok('B video from A', await B.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.videoWidth > 0).length) >= 2);
await A.click('#chatbtn'); await A.fill('#msg', 'welcome'); await A.press('#msg', 'Enter'); await wait(1500);
ok('chat works after approval', (await B.textContent('#log')).includes('welcome'));
ok('C still not in', await C.isVisible('#wait'));
// verify codes
const code = async (P) => { await P.click('#more'); await P.click('#verbtn'); await wait(800); const t = await P.textContent('#verbox .code'); await P.click('#verclose'); return t; };
const ca = await code(A), cb = await code(B); console.log('codes', ca, '|', cb);
ok('verify codes match', ca === cb && /\S+ \S+ \S+ \S+ \S+/.test(ca));
// deny
const D = await mk(invite); await D.click('#nocam'); await wait(8000);
for (let i = 0; i < 4; i++) { const n = await A.locator('.knock').count(); if (!n) break; await A.locator('.knock').first().locator('button').nth(1).click(); await wait(400); } await wait(2500);
ok('denied guest sees ended screen', await D.isVisible('#ended'));
// non-host cannot burn
ok('guest has no burn button', !(await (async () => { await B.click('#more'); const v = await B.isVisible('#burn'); await B.click('#more'); return v; })()));
// burn
await A.click('#more'); await A.click('#burn'); await wait(3000);
ok('B room ended + wiped', await B.isVisible('#ended') && (await B.textContent('#log')) === '' && await B.evaluate(() => window.__pr.conns.size) === 0);
ok('address cleared', (await B.evaluate(() => location.hash)) === '');
// expiry
const E = await mk('http://localhost:8172/#abcdefghijklmnop.e1'); await E.click('#nocam'); await wait(800);
ok('expired link refused', await E.isVisible('#ended'));
console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); await b.close(); srv.close(); process.exit(fail ? 1 : 0);
