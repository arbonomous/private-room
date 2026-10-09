import { chromium } from 'playwright'; import http from 'http'; import fs from 'fs';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(fs.readFileSync('dist/index.html')); }).listen(8123);
const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--allow-loopback-in-peer-connection'] });
const ctx = await b.newContext({ permissions: ['camera', 'microphone'] });
const frames = [];
async function mk(url) {
  const p = await ctx.newPage();
  p.on('websocket', (ws) => { frames.push('WSURL ' + ws.url()); ws.on('framesent', (f) => frames.push(String(f.payload))); });
  p.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text().slice(0, 150)); });
  await p.goto(url); return p;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const A = await mk('http://localhost:8123/');
await A.click('#create'); const url = A.url(); const key = url.split('#')[1];
await A.click('#cam'); await wait(2500);
const B = await mk(url); await B.click('#cam');
const st = async (p) => p.evaluate(() => ({ status: document.querySelector('#status').textContent, conns: window.__pr.conns.size, vids: [...document.querySelectorAll('video')].map((v) => v.videoWidth) }));
await wait(9000);
console.log('A', JSON.stringify(await st(A))); console.log('B', JSON.stringify(await st(B)));
const MARK = 'zq81xsecretmarker', MARK2 = 'bravo9publicsauce';
await A.click('.cm-content'); await A.keyboard.type('const ' + MARK + ' = 1;\n', { delay: 20 });
await B.click('.cm-content'); await B.keyboard.press('Control+End'); await B.keyboard.type('// ' + MARK2, { delay: 20 });
await wait(2000);
const txt = (p) => p.evaluate(() => window.__pr.doc.getText('code').toString());
console.log('A doc:', JSON.stringify(await txt(A))); console.log('B doc:', JSON.stringify(await txt(B)));
// third peer
const C = await mk(url); await C.click('#nocam'); await wait(9000);
console.log('C', JSON.stringify(await st(C)), 'A', JSON.stringify(await st(A)));
console.log('C doc:', JSON.stringify(await txt(C)));
await A.screenshot({ path: '/tmp/pr_shot.png', fullPage: true });
console.log('AUDIT-A:', await A.evaluate(() => document.querySelector('#audit').innerText.replace(/\n/g, ' | ')));
const all = frames.join('\n');
console.log('independent check: frames', frames.length, 'key in frames:', all.includes(key), 'marker1:', all.includes(MARK), 'marker2:', all.includes(MARK2));
await B.close(); await wait(3000);
const B2 = await mk(url); await B2.click('#nocam'); await wait(20000);
for (const [n,p] of [['A',A],['B2',B2],['C',C]]) console.log(n, JSON.stringify(await st(p)), JSON.stringify(await p.evaluate(()=>[...window.__pr.conns.keys()])));
await B2.keyboard.press('Escape'); await B2.click('.cm-content'); await B2.keyboard.type('\n// fromB2', {delay:20}); await wait(1500);
console.log('A has fromB2:', (await txt(A)).includes('fromB2'), 'C has:', (await txt(C)).includes('fromB2'));
await b.close(); srv.close();
