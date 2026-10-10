import { chromium } from 'playwright'; import http from 'http'; import fs from 'fs';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(fs.readFileSync('dist/index.html')); }).listen(8136);
const BASE = process.env.URL0 || 'http://localhost:8136/';
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await (await b.newContext()).newPage(); p.on('dialog', (d) => d.accept()); await p.goto(BASE); await p.click('#create'); await p.click('#nocam'); await p.waitForTimeout(1200);
const F = p.frameLocator('#frame'); const res = []; const ok = (n, v, x) => { res.push(v); console.log(v ? 'PASS' : 'FAIL', n, x || ''); };
await p.click('[data-t=doom]'); await p.waitForTimeout(1500);
ok('doom no error', !/Error|Blocked/.test(await p.textContent('#pvlog')), await p.textContent('#pvlog'));
const stats = () => F.locator('#c').evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const s = new Set(); for (let i = 0; i < d.length; i += 400) s.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]); return s.size; });
ok('renders many colors (walls, floor, hud)', (await stats()) > 40, await stats());
await F.locator('body').click(); const a0 = await F.locator('body').evaluate(() => pa); await p.keyboard.down('ArrowRight'); await p.waitForTimeout(500); await p.keyboard.up('ArrowRight');
ok('turning works', (await F.locator('body').evaluate(() => pa)) > a0 + 0.3);
const x0 = await F.locator('body').evaluate(() => px + ',' + py); await p.keyboard.down('w'); await p.waitForTimeout(500); await p.keyboard.up('w');
ok('moving works', (await F.locator('body').evaluate(() => px + ',' + py)) !== x0);
// aim at enemy 1 from open space and shoot
await F.locator('body').evaluate(() => { const e = enemies[1]; e.x = 9.5; e.y = 8.5; px = 6.5; py = 8.5; pa = 0; });
await p.waitForTimeout(100);
await p.keyboard.press(' '); await p.waitForTimeout(400);
const hp1 = await F.locator('body').evaluate(() => enemies[1].hp); ok('shot damages enemy', hp1 === 1, 'hp ' + hp1);
await p.waitForTimeout(400); await p.keyboard.press(' '); await p.waitForTimeout(400);
const k = await F.locator('body').evaluate(() => kills + ',' + enemies[1].hp); ok('second shot kills and counts', k.startsWith('1,'), k);
// wall blocks shot
await F.locator('body').evaluate(() => { const e = enemies[0]; px = 1.5; py = 1.5; e.x = 12.5; e.y = 14.5; pa = Math.atan2(e.y - py, e.x - px); });
const hpw = await F.locator('body').evaluate(() => enemies[0].hp); ok('enemy alive and not hit through walls initially', hpw === 2);
// win flow
await F.locator('body').evaluate(() => { enemies.forEach((e) => { e.hp = 0; }); kills = enemies.length - 1; enemies[0].hp = 1; px = 8.5; py = 8.5; enemies[0].x = 11.5; enemies[0].y = 8.5; pa = 0; shootAt = 0; });
await p.waitForTimeout(100); await p.keyboard.press(' '); await p.waitForTimeout(500);
ok('win message', /You win/.test(await F.locator('body').evaluate(() => over)), await F.locator('body').evaluate(() => over));
await p.keyboard.press('r'); await p.waitForTimeout(200); ok('restart works', (await F.locator('body').evaluate(() => kills)) === 0 && (await F.locator('body').evaluate(() => health)) === 100);
// enemies hurt the player
await F.locator('body').evaluate(() => { px = 5.5; py = 5.5; enemies[0].x = 5.5; enemies[0].y = 6.2; }); await p.waitForTimeout(700);
ok('enemy contact hurts', (await F.locator('body').evaluate(() => health)) < 100);
// one-box doom prompt loads template
await p.fill('#onebox', 'a first person shooter like doom'); await p.click('#build'); await p.waitForTimeout(1500);
ok('one-box doom prompt loads tested template', /hand-tested Doom-style shooter/.test(await p.textContent('#buildst')) && !/Error/.test(await p.textContent('#pvlog')), await p.textContent('#buildst'));
const all = res.every(Boolean); console.log(all ? 'DOOM PASS' : 'DOOM FAIL'); await b.close(); srv.close(); process.exit(all ? 0 : 1);
