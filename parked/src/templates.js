const wrap = (title, body, script) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{margin:0;background:#10151c;color:#eee;font-family:system-ui,sans-serif;text-align:center}canvas{background:#000;display:block;margin:8px auto;border:2px solid #3d85c6}button{font-size:16px;padding:8px 14px;margin:4px}#msg{margin:6px;min-height:22px}</style></head>
<body>${body}
<script>
${script}
</script></body></html>
`;
export const TEMPLATES = {
  doom: ['Doom-style shooter', wrap('Doom-style shooter', '<div id="msg">WASD or arrows: move and turn. Space or click: shoot. R: restart.</div><canvas id="c" width="480" height="300"></canvas>', `const c = document.getElementById('c');
const g = c.getContext('2d');
const W = 480, H = 300;
const MAP = [
  '1111111111111111', '1000000000000001', '1000000000000001', '1001100000011001',
  '1001000000001001', '1000000110000001', '1000000110000001', '1000000000000001',
  '1000000000000001', '1001000000001001', '1001100000011001', '1000000000000001',
  '1000000110000001', '1000000000000001', '1000000000000001', '1111111111111111'
];
const FOV = Math.PI / 3;
const FOCAL = (W / 2) / Math.tan(FOV / 2);
let px, py, pa, health, kills, enemies, keys = {}, shootAt = 0, flash = 0, hurt = 0, over = '', zbuf = new Array(W).fill(99);
function wall(x, y) { const r = MAP[Math.floor(y)]; return !r || r[Math.floor(x)] !== '0'; }
function reset() {
  px = 2.5; py = 2.5; pa = 0.6; health = 100; kills = 0; over = '';
  enemies = [[12.5, 2.5], [4.5, 8.5], [12.5, 8.5], [13.5, 13.5], [8.5, 10.5], [3.5, 13.5]].map(function (e) { return {x: e[0], y: e[1], hp: 2, hit: 0, cool: 0}; });
}
function cast(a) {
  const dx = Math.cos(a), dy = Math.sin(a);
  let d = 0, side = 0;
  while (d < 20) {
    d += 0.02;
    if (wall(px + dx * d, py + dy * d)) {
      side = Math.abs(dx) > Math.abs(dy) ? (Math.floor(px + dx * d - dx * 0.03) !== Math.floor(px + dx * d) ? 0 : 1) : 1;
      break;
    }
  }
  return {d: d, side: side};
}
function shoot() {
  const now = performance.now();
  if (now - shootAt < 250 || over) return;
  shootAt = now; flash = 5;
  const wallD = zbuf[W >> 1];
  let best = null;
  enemies.forEach(function (e) {
    if (e.hp <= 0) return;
    const dx = e.x - px, dy = e.y - py, dist = Math.hypot(dx, dy);
    let ang = Math.atan2(dy, dx) - pa;
    while (ang > Math.PI) ang -= 2 * Math.PI;
    while (ang < -Math.PI) ang += 2 * Math.PI;
    const perp = dist * Math.cos(ang), lateral = Math.abs(dist * Math.sin(ang));
    if (perp > 0 && lateral < 0.45 && perp < wallD && (!best || perp < best.perp)) best = {e: e, perp: perp};
  });
  if (best) {
    best.e.hp--; best.e.hit = 6;
    if (best.e.hp <= 0) {
      kills++;
      if (kills === enemies.length) over = 'You win! All enemies dead. Press R to play again.';
    }
  }
}
function update() {
  if (over) return;
  const turn = 0.045, spd = 0.06;
  if (keys.ArrowLeft || keys.q) pa -= turn;
  if (keys.ArrowRight || keys.e) pa += turn;
  let mx = 0, my = 0;
  if (keys.ArrowUp || keys.w) { mx += Math.cos(pa) * spd; my += Math.sin(pa) * spd; }
  if (keys.ArrowDown || keys.s) { mx -= Math.cos(pa) * spd; my -= Math.sin(pa) * spd; }
  if (keys.a) { mx += Math.sin(pa) * spd; my -= Math.cos(pa) * spd; }
  if (keys.d) { mx -= Math.sin(pa) * spd; my += Math.cos(pa) * spd; }
  if (!wall(px + mx * 3, py)) px += mx;
  if (!wall(px, py + my * 3)) py += my;
  if (keys[' ']) shoot();
  enemies.forEach(function (e) {
    if (e.hp <= 0) return;
    const dx = px - e.x, dy = py - e.y, dist = Math.hypot(dx, dy);
    if (e.hit > 0) e.hit--;
    if (dist > 0.9 && dist < 9) {
      const sx = dx / dist * 0.018, sy = dy / dist * 0.018;
      if (!wall(e.x + sx * 6, e.y)) e.x += sx;
      if (!wall(e.x, e.y + sy * 6)) e.y += sy;
    }
    if (e.cool > 0) e.cool--;
    if (dist < 1.1 && e.cool === 0) { health -= 10; e.cool = 50; hurt = 8; }
  });
  if (health <= 0) { health = 0; over = 'You died. Press R to try again.'; }
}
function draw() {
  const sky = g.createLinearGradient(0, 0, 0, H / 2); sky.addColorStop(0, '#1b1b2f'); sky.addColorStop(1, '#4a3b52');
  g.fillStyle = sky; g.fillRect(0, 0, W, H / 2);
  const fl = g.createLinearGradient(0, H / 2, 0, H); fl.addColorStop(0, '#2b2b2b'); fl.addColorStop(1, '#5a4a3a');
  g.fillStyle = fl; g.fillRect(0, H / 2, W, H / 2);
  for (let i = 0; i < W; i++) {
    const rel = Math.atan((i - W / 2) / FOCAL);
    const r = cast(pa + rel);
    const perp = r.d * Math.cos(rel);
    zbuf[i] = perp;
    const h = Math.min(H * 2, FOCAL * 1.0 / perp);
    const shade = Math.max(0.15, 1 - perp / 12) * (r.side ? 0.75 : 1);
    g.fillStyle = 'rgb(' + Math.floor(150 * shade) + ',' + Math.floor(70 * shade) + ',' + Math.floor(60 * shade) + ')';
    g.fillRect(i, H / 2 - h / 2, 1, h);
  }
  const list = enemies.filter(function (e) { return e.hp > 0; }).map(function (e) {
    const dx = e.x - px, dy = e.y - py;
    let ang = Math.atan2(dy, dx) - pa;
    while (ang > Math.PI) ang -= 2 * Math.PI;
    while (ang < -Math.PI) ang += 2 * Math.PI;
    return {e: e, ang: ang, perp: Math.hypot(dx, dy) * Math.cos(ang)};
  }).filter(function (o) { return Math.abs(o.ang) < Math.PI / 2 && o.perp > 0.2; }).sort(function (a, b) { return b.perp - a.perp; });
  list.forEach(function (o) {
    const size = FOCAL * 0.9 / o.perp, sx = W / 2 + Math.tan(o.ang) * FOCAL, top = H / 2 - size / 2;
    for (let col = Math.floor(sx - size / 4); col < sx + size / 4; col++) {
      if (col < 0 || col >= W || o.perp > zbuf[col]) continue;
      const u = (col - (sx - size / 4)) / (size / 2);
      g.fillStyle = o.e.hit > 0 ? '#ffffff' : '#b3261e';
      g.fillRect(col, top + size * 0.25, 1, size * 0.75);
      g.fillStyle = o.e.hit > 0 ? '#ffffff' : '#d9534f';
      g.fillRect(col, top, 1, size * 0.28);
      if ((u > 0.2 && u < 0.4 || u > 0.6 && u < 0.8) && o.e.hit === 0) { g.fillStyle = '#ffeb3b'; g.fillRect(col, top + size * 0.08, 1, size * 0.07); }
    }
  });
  if (flash > 0) { g.fillStyle = 'rgba(255,220,120,0.35)'; g.fillRect(0, 0, W, H); flash--; }
  if (hurt > 0) { g.fillStyle = 'rgba(200,0,0,0.35)'; g.fillRect(0, 0, W, H); hurt--; }
  g.fillStyle = '#ddd'; g.fillRect(W / 2 - 1, H / 2 - 8, 2, 16); g.fillRect(W / 2 - 8, H / 2 - 1, 16, 2);
  g.fillStyle = '#555'; g.fillRect(W / 2 - 14, H - 34, 28, 34); g.fillStyle = '#888'; g.fillRect(W / 2 - 6, H - 50, 12, 18);
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, W, 22);
  g.fillStyle = '#fff'; g.font = '14px sans-serif';
  g.fillText('Health ' + health + '   Kills ' + kills + '/' + enemies.length, 8, 15);
  const m = 4;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { g.fillStyle = MAP[y][x] === '0' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.7)'; g.fillRect(W - 70 + x * m, 26 + y * m, m, m); }
  g.fillStyle = '#0f0'; g.fillRect(W - 70 + px * m - 1, 26 + py * m - 1, 3, 3);
  g.fillStyle = '#f33'; enemies.forEach(function (e) { if (e.hp > 0) g.fillRect(W - 70 + e.x * m - 1, 26 + e.y * m - 1, 3, 3); });
  if (over) { g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(0, H / 2 - 24, W, 48); g.fillStyle = '#fff'; g.font = '18px sans-serif'; g.textAlign = 'center'; g.fillText(over, W / 2, H / 2 + 6); g.textAlign = 'left'; }
}
document.addEventListener('keydown', function (e) {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys[k] = true;
  if (k === 'r') reset();
  if (k === ' ') shoot();
  if (k.indexOf('Arrow') === 0 || k === ' ') e.preventDefault();
});
document.addEventListener('keyup', function (e) { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
c.addEventListener('mousedown', function () { shoot(); });
reset();
setInterval(function () { update(); draw(); }, 16);
draw();`)],
  snake: ['Snake', wrap('Snake', '<div id="msg">Arrow keys to move. Click the game first.</div><canvas id="c" width="320" height="320" tabindex="0"></canvas>', `const c = document.getElementById('c');
const g = c.getContext('2d');
const SIZE = 16, N = 20;
let snake, dir, food, score, dead, timer;
function reset() {
  snake = [{x: 10, y: 10}, {x: 9, y: 10}, {x: 8, y: 10}];
  dir = {x: 1, y: 0};
  food = {x: 15, y: 10};
  score = 0;
  dead = false;
  document.getElementById('msg').textContent = 'Score: 0';
}
function place() {
  do { food = {x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N)}; }
  while (snake.some(function (s) { return s.x === food.x && s.y === food.y; }));
}
function step() {
  if (dead) return;
  const head = {x: snake[0].x + dir.x, y: snake[0].y + dir.y};
  if (head.x < 0 || head.y < 0 || head.x >= N || head.y >= N || snake.some(function (s) { return s.x === head.x && s.y === head.y; })) {
    dead = true;
    document.getElementById('msg').textContent = 'Game over. Score ' + score + '. Press Space to restart.';
    return;
  }
  snake.unshift(head);
  if (head.x === food.x && head.y === food.y) {
    score++;
    document.getElementById('msg').textContent = 'Score: ' + score;
    place();
  } else { snake.pop(); }
}
function draw() {
  g.fillStyle = '#000'; g.fillRect(0, 0, 320, 320);
  g.fillStyle = '#e07a5f'; g.fillRect(food.x * SIZE, food.y * SIZE, SIZE - 1, SIZE - 1);
  g.fillStyle = '#81b29a';
  snake.forEach(function (s) { g.fillRect(s.x * SIZE, s.y * SIZE, SIZE - 1, SIZE - 1); });
}
document.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowUp' && dir.y !== 1) dir = {x: 0, y: -1};
  else if (e.key === 'ArrowDown' && dir.y !== -1) dir = {x: 0, y: 1};
  else if (e.key === 'ArrowLeft' && dir.x !== 1) dir = {x: -1, y: 0};
  else if (e.key === 'ArrowRight' && dir.x !== -1) dir = {x: 1, y: 0};
  else if (e.key === ' ' && dead) reset();
  if (e.key.indexOf('Arrow') === 0 || e.key === ' ') e.preventDefault();
});
reset();
setInterval(function () { step(); draw(); }, 120);
draw();`)],
  pong: ['Pong', wrap('Pong', '<div id="msg">Move the mouse or use Up/Down arrows. First to 5 wins.</div><canvas id="c" width="400" height="260"></canvas>', `const c = document.getElementById('c');
const g = c.getContext('2d');
let player = 100, ai = 100, bx = 200, by = 130, vx = 3, vy = 2, ps = 0, as = 0, over = false;
const H = 60;
c.addEventListener('mousemove', function (e) {
  const r = c.getBoundingClientRect();
  player = Math.max(0, Math.min(260 - H, e.clientY - r.top - H / 2));
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowUp') player = Math.max(0, player - 20);
  if (e.key === 'ArrowDown') player = Math.min(260 - H, player + 20);
  if (e.key === ' ' && over) { ps = 0; as = 0; over = false; }
  if (e.key.indexOf('Arrow') === 0 || e.key === ' ') e.preventDefault();
});
function serve(dir) { bx = 200; by = 130; vx = 3 * dir; vy = Math.random() * 4 - 2; }
function step() {
  if (over) return;
  bx += vx; by += vy;
  if (by < 4 || by > 256) vy = -vy;
  if (bx < 20 && by > player && by < player + H) { vx = Math.abs(vx) * 1.05; vy += (by - (player + H / 2)) / 15; }
  if (bx > 380 && by > ai && by < ai + H) { vx = -Math.abs(vx) * 1.05; }
  if (bx < 0) { as++; serve(1); }
  if (bx > 400) { ps++; serve(-1); }
  const target = by - H / 2;
  ai += Math.max(-2.5, Math.min(2.5, target - ai));
  if (ps >= 5 || as >= 5) { over = true; document.getElementById('msg').textContent = (ps >= 5 ? 'You win!' : 'Computer wins.') + ' Press Space to play again.'; }
  else document.getElementById('msg').textContent = 'You ' + ps + ' - ' + as + ' Computer';
}
function draw() {
  g.fillStyle = '#000'; g.fillRect(0, 0, 400, 260);
  g.fillStyle = '#3d85c6'; g.fillRect(8, player, 8, H);
  g.fillStyle = '#e07a5f'; g.fillRect(384, ai, 8, H);
  g.fillStyle = '#fff'; g.fillRect(bx - 4, by - 4, 8, 8);
}
setInterval(function () { step(); draw(); }, 16);`)],
  clicker: ['Cookie clicker', wrap('Clicker', '<h2>Cookie Clicker</h2><div id="msg"></div><button id="cookie" style="font-size:48px">🍪</button><div><button id="b1">Buy cursor (+1 per click)</button><button id="b2">Buy bakery (+1 per second)</button></div>', `let cookies = 0, perClick = 1, perSec = 0, cursors = 0, bakeries = 0;
const msg = document.getElementById('msg');
function costCursor() { return 10 + cursors * 10; }
function costBakery() { return 50 + bakeries * 50; }
function show() {
  msg.textContent = 'Cookies: ' + Math.floor(cookies) + '  (' + perClick + ' per click, ' + perSec + ' per second)';
  document.getElementById('b1').textContent = 'Buy cursor (+1 per click) - ' + costCursor();
  document.getElementById('b2').textContent = 'Buy bakery (+1 per second) - ' + costBakery();
}
document.getElementById('cookie').onclick = function () { cookies += perClick; show(); };
document.getElementById('b1').onclick = function () { if (cookies >= costCursor()) { cookies -= costCursor(); cursors++; perClick++; show(); } };
document.getElementById('b2').onclick = function () { if (cookies >= costBakery()) { cookies -= costBakery(); bakeries++; perSec++; show(); } };
setInterval(function () { cookies += perSec; show(); }, 1000);
show();`)],
  memory: ['Memory match', wrap('Memory', '<h2>Memory Match</h2><div id="msg"></div><div id="board" style="display:grid;grid-template-columns:repeat(4,64px);gap:8px;justify-content:center;margin:10px auto"></div><button id="again">New game</button>', `const icons = ['🍎', '🚀', '🐱', '⚽', '🎲', '🌟', '🍕', '🎸'];
const board = document.getElementById('board');
const msg = document.getElementById('msg');
let first = null, lock = false, moves = 0, found = 0;
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function start() {
  board.innerHTML = ''; first = null; lock = false; moves = 0; found = 0;
  msg.textContent = 'Find the pairs. Moves: 0';
  shuffle(icons.concat(icons)).forEach(function (ic) {
    const b = document.createElement('button');
    b.style.cssText = 'width:64px;height:64px;font-size:30px;margin:0';
    b.textContent = '?'; b.dataset.icon = ic;
    b.onclick = function () { flip(b); };
    board.appendChild(b);
  });
}
function flip(b) {
  if (lock || b.disabled || b === first) return;
  b.textContent = b.dataset.icon;
  if (!first) { first = b; return; }
  moves++;
  msg.textContent = 'Moves: ' + moves;
  if (first.dataset.icon === b.dataset.icon) {
    first.disabled = true; b.disabled = true; first = null; found++;
    if (found === 8) msg.textContent = 'You won in ' + moves + ' moves!';
  } else {
    lock = true; const a = first; first = null;
    setTimeout(function () { a.textContent = '?'; b.textContent = '?'; lock = false; }, 700);
  }
}
document.getElementById('again').onclick = start;
start();`)],
};
