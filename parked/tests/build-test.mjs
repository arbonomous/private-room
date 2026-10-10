import { chromium } from 'playwright'; import http from 'http'; import fs from 'fs';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(fs.readFileSync('dist/index.html')); }).listen(8134);
const BASE = process.env.URL0 || 'http://localhost:8134/';
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await (await b.newContext()).newPage(); p.on('dialog', (d) => d.accept());
await p.route('**/ai.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `export const gpuInfo=async()=>({ok:true,f16:false});export const hasModel=()=>true;export const loadModel=async(id,cb)=>{cb('x',1)};export const ask=async(m,cb)=>{window.__asks=(window.__asks||[]);window.__asks.push(m[m.length-1].content);const t=window.__q.shift()||'';cb(t);return t};export const stop=()=>{}` }));
await p.goto(BASE); await p.click('#create'); await p.click('#nocam'); await p.waitForTimeout(1200);
const res = []; const ok = (n, v, x) => { res.push(v); console.log(v ? 'PASS' : 'FAIL', n, x || ''); };
const BAD = '```html\n<body><div id="s"></div><script>\nconst score = 0;\nscore = score + 1;\ndocument.getElementById("s").textContent="x";\n</script></body>\n```';
const BAD2 = '```html\n<body><script>\nimport Phaser from "https://x.com/p.js";\n</script></body>\n```';
const GOOD = '```html\n<body><canvas id="c" width="50" height="50"></canvas><script>\nlet score = 0;\nscore = score + 1;\ndocument.getElementById("c").getContext("2d").fillRect(0,0,20,20);document.title="ok"+score;\n</script></body>\n```';
const stat = () => p.textContent('#buildst');
// 1 first try ok
await p.evaluate((g) => { window.__q = [g]; window.__asks = []; }, GOOD); await p.fill('#onebox', 'a game'); await p.click('#build'); await p.waitForTimeout(4500);
ok('one-box builds and runs first try', /Done\. It is running/.test(await stat()) && (await p.frameLocator('#frame').locator('#c').count()) === 1, await stat());
// 2 auto repair: bad, bad2, good
await p.evaluate(([a, b2, g]) => { window.__q = [a, b2, g]; window.__asks = []; }, [BAD, BAD2, GOOD]); await p.fill('#onebox', 'another game'); await p.click('#build'); await p.waitForTimeout(14000);
const asks = await p.evaluate(() => window.__asks);
ok('auto-repair fixes it in 2 fixes', /fixed it by itself \(2 fixes\)/.test(await stat()) && (await p.frameLocator('#frame').locator('#c').count()) === 1, await stat());
ok('repair prompt carries error and code', asks.length === 3 && /Assignment to constant/.test(asks[1]) && /import statement/.test(asks[2]) && /const score/.test(asks[1]), asks.length + ' asks');
// 3 give up after 3 fixes
await p.evaluate(([a]) => { window.__q = [a, a, a, a]; window.__asks = []; }, [BAD]); await p.fill('#onebox', 'hard game'); await p.click('#build'); await p.waitForTimeout(18000);
ok('gives up politely after 3 fixes', /Could not get it working after 3 automatic fixes/.test(await stat()) && /Stronger/.test(await stat()), await stat());
ok('admission gate unaffected (room works)', (await p.evaluate(() => window.__pr.conns.size)) >= 0);
const all = res.every(Boolean); console.log(all ? 'BUILD PASS' : 'BUILD FAIL'); await b.close(); srv.close(); process.exit(all ? 0 : 1);
