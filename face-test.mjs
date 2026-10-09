import { chromium } from 'playwright'; import http from 'http'; import fs from 'fs';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(fs.readFileSync('dist/index.html')); }).listen(8185);
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--allow-loopback-in-peer-connection', '--autoplay-policy=no-user-gesture-required'] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const ok = (n, c) => { console.log(c ? 'PASS' : 'FAIL', n); if (!c) fail++; };
const mk = async (u) => { const c = await b.newContext(); const p = await c.newPage(); p.on('pageerror', (e) => console.log('ERR', e.message)); await p.goto(u); return p; };
const A = await mk('http://localhost:8185/'); await A.uncheck('#approve'); await A.click('#create'); const url = A.url(); await A.click('#cam'); await wait(2000);
const B = await mk(url); await B.click('#cam'); await wait(14000);
const probe = () => B.evaluate(async () => {
  const v = [...document.querySelectorAll('figure')].find((f) => f.__local === false).querySelector('video');
  const t0 = v.currentTime; await new Promise((r) => setTimeout(r, 1200));
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; const x = c.getContext('2d'); x.drawImage(v, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data; let eq = 0, n = 0, em = 0;
  for (let y = 0; y < c.height; y += 4) for (let i = 1; i < c.width; i++) { const k = (y * c.width + i) * 4; const dd = Math.abs(d[k] - d[k - 4]) + Math.abs(d[k + 1] - d[k - 3]); n++; if (dd < 8) eq++; }
  return { w: v.videoWidth, moving: v.currentTime > t0, flat: +(eq / n).toFixed(3) };
});
const base = await probe(); console.log('base', base); ok('remote video flowing', base.w > 0 && base.moving);
await A.click('#more'); await A.selectOption('#face', 'pixel'); await wait(3000);
console.log('faceErr', await A.evaluate(() => window.__pr.faceErr), await A.evaluate(() => window.__pr.face));
const px = await probe(); console.log('pixel', px);
ok('pixelate flows, w<=480', px.moving && px.w <= 480 && px.w > 0); ok('effect path active (resized to 480 canvas)', px.w === 480 && base.w === 640);
const sender = await A.evaluate(() => { const c = window.__pr.peer; return 'ok'; });
await A.selectOption('#face', 'blur'); await wait(2500); const bl = await probe(); console.log('blur', bl); ok('blur flows', bl.moving && bl.w === 480);
await A.selectOption('#face', 'emoji'); await wait(2500); const em = await probe(); console.log('emoji', em); ok('emoji overlay drawn', em.moving && em.flat < px.flat - 0.01);
await A.click('#camb'); await wait(1500); await A.click('#camb'); await wait(2500); const re = await probe(); ok('camera off/on still flows with effect', re.moving);
await A.selectOption('#face', 'off'); await wait(3000); const off = await probe(); console.log('off', off); ok('off restores raw camera', off.moving && off.w === 640);
await b.close(); srv.close(); process.exit(fail ? 1 : 0);
