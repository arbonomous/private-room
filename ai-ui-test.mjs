import { chromium } from 'playwright'; import http from 'http'; import fs from 'fs';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(fs.readFileSync('dist/index.html')); }).listen(8126);
const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox', '--allow-loopback-in-peer-connection'] });
const mk = async (u) => { const p = await (await b.newContext()).newPage(); await p.goto(u); return p; };
const A = await mk('http://localhost:8126/');
// stub model module: same API as ai.js, canned answer (UI wiring test only, not model quality)
await A.route('**/ai.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const gpuInfo=async()=>({ok:true,f16:false});export const hasModel=()=>true;export const loadModel=async(id,cb)=>{cb('x',1)};export const ask=async(m,cb)=>{window.__lastMsgs=m;const t='Here:\\n\`\`\`js\\nfunction add(a,b){return a+b}\\n\`\`\`';cb(t);return t};export const stop=()=>{}` }));
await A.click('#create'); const url = A.url(); await A.click('#nocam'); await A.waitForTimeout(1500);
const B = await mk(url); await B.click('#nocam'); await B.waitForTimeout(7000);
await A.click('.cm-content'); await A.keyboard.type('// start', { delay: 10 });
await A.click('#aiload'); await A.waitForTimeout(500); console.log(await A.textContent('#aiprog'));
await A.fill('#aiq', 'add function'); await A.click('#aiask'); await A.waitForTimeout(500);
console.log('asked; ctx included code:', (await A.evaluate(() => window.__lastMsgs[1].content)).includes('// start'));
await A.click('#aiins'); await B.waitForTimeout(2000);
const dA = await A.evaluate(() => window.__pr.doc.getText('code').toString()), dB = await B.evaluate(() => window.__pr.doc.getText('code').toString());
console.log('A doc', JSON.stringify(dA)); console.log('B doc', JSON.stringify(dB));
console.log('B has no ai output panel text:', (await B.textContent('#aiout')) === '');
await A.screenshot({ path: '/tmp/pr_ai.png', fullPage: true });
await b.close(); srv.close();
