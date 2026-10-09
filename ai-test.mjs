import { chromium } from 'playwright'; import http from 'http'; import fs from 'fs';
const types = { '.js': 'text/javascript', '.html': 'text/html' };
const srv = http.createServer((q, r) => { const f = q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1); try { r.writeHead(200, { 'content-type': types[f.slice(f.lastIndexOf('.'))] || 'text/plain' }); r.end(fs.readFileSync('dist/' + f)); } catch { r.writeHead(404); r.end(); } }).listen(8125);
const MODEL = process.env.MODEL || 'Qwen2.5-Coder-0.5B-Instruct';
const ctx0 = await chromium.launchPersistentContext('/tmp/pw-ai-profile', { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox', '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-features=Vulkan,WebGPU'] });
const b = ctx0; const p = await ctx0.newPage();
const reqs = []; p.on('request', (r) => reqs.push(r.url()));
p.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text().slice(0, 200)); });
await p.goto('http://localhost:8125/'); await p.click('#create'); await p.click('#nocam'); await p.waitForTimeout(2000);
console.log('webgpu', await p.evaluate(async () => { if (!navigator.gpu) return 'none'; const a = await navigator.gpu.requestAdapter(); return a ? 'adapter f16=' + a.features.has('shader-f16') : 'no adapter'; }));
await p.selectOption('#aimodel', MODEL); await p.click('#aiload');
const t0 = Date.now();
for (let i = 0; i < 100; i++) { await p.waitForTimeout(3000); const t = await p.textContent('#aiprog'); if (i % 3 === 0) console.log(Math.round((Date.now() - t0) / 1000) + 's', t.slice(0, 120)); if (/^Ready|Could not|no WebGPU|No usable/.test(t) || t.startsWith('Model not')) break; }
const ready = await p.textContent('#aiprog'); console.log('LOAD:', ready.slice(0, 200));
if (/^Ready/.test(ready)) {
  await p.evaluate(() => { window.__aiMax = 24; }); await p.fill('#aiq', 'Write a JavaScript function add(a,b) that returns the sum.'); await p.click('#aiask');
  for (let i = 0; i < 120; i++) { await p.waitForTimeout(3000); if (/^Answered/.test(await p.textContent('#aiprog'))) break; }
  console.log('ANSWER:', (await p.textContent('#aiout')).slice(0, 400)); console.log(await p.textContent('#aiprog'));
  await p.click('#aiins'); console.log('DOC after insert:', JSON.stringify(await p.evaluate(() => window.__pr.doc.getText('code').toString())).slice(0, 200));
}
const hosts = [...new Set(reqs.map((u) => new URL(u).host))]; console.log('hosts contacted:', hosts.join(', '));
await b.close(); srv.close();
