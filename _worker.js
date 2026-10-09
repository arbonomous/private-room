// Feedback endpoint for mut3d (Cloudflare D1). Stores only {worked, text, optional app/device/screen} and a timestamp.
// No room id, key, name, chat or IP is stored. A salted hash of the IP is kept for at most one hour, for rate limiting only.
const MAX = 3000;
let ready = false;
async function init(db) {
  if (ready) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS fb (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, worked TEXT, text TEXT, app TEXT, device TEXT, screen TEXT)'),
    db.prepare('CREATE TABLE IF NOT EXISTS rl (k TEXT PRIMARY KEY, n INTEGER, exp INTEGER)'),
  ]);
  ready = true;
}
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/fb' && req.method === 'POST') {
      try {
        if (!env.DB) return new Response('off', { status: 503 });
        if (+(req.headers.get('content-length') || 0) > MAX) return new Response('too big', { status: 413 });
        const raw = await req.text(); if (raw.length > MAX) return new Response('too big', { status: 413 });
        let o; try { o = JSON.parse(raw); } catch { return new Response('bad', { status: 400 }); }
        const text = typeof o.text === 'string' ? o.text.slice(0, 1500) : '';
        const worked = o.worked === 'yes' || o.worked === 'no' ? o.worked : '';
        if (!text && !worked) return new Response('empty', { status: 400 });
        const c = (k) => (typeof o[k] === 'string' ? o[k].slice(0, 160) : null);
        await init(env.DB);
        const now = Date.now();
        await env.DB.prepare('DELETE FROM rl WHERE exp < ?').bind(now).run();
        await env.DB.prepare('DELETE FROM fb WHERE at < ?').bind(new Date(now - 60 * 86400000).toISOString()).run();
        const ip = req.headers.get('cf-connecting-ip') || 'x';
        const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode((env.SALT || 's') + ip)))].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
        const hk = 'h:' + h + ':' + Math.floor(now / 3600000), dk = 'd:' + Math.floor(now / 86400000);
        const get = async (k) => ((await env.DB.prepare('SELECT n FROM rl WHERE k=?').bind(k).first()) || { n: 0 }).n;
        if ((await get(hk)) >= 5) return new Response('slow down', { status: 429 });
        if ((await get(dk)) >= 300) return new Response('full', { status: 429 });
        const up = (k, ttl) => env.DB.prepare('INSERT INTO rl (k,n,exp) VALUES (?,1,?) ON CONFLICT(k) DO UPDATE SET n=n+1').bind(k, now + ttl).run();
        await up(hk, 3700000); await up(dk, 90000000);
        await env.DB.prepare('INSERT INTO fb (at,worked,text,app,device,screen) VALUES (?,?,?,?,?,?)').bind(new Date(now).toISOString(), worked, text, c('app'), c('device'), c('screen')).run();
        return new Response('ok', { status: 200, headers: { 'cache-control': 'no-store' } });
      } catch (e) { return new Response('err', { status: 500 }); }
    }
    if (u.pathname === '/fb/list') {
      if (!env.DB || !env.ADMIN || req.headers.get('authorization') !== 'Bearer ' + env.ADMIN) return new Response('no', { status: 401 });
      await init(env.DB);
      const since = +(u.searchParams.get('since') || 0);
      const r = await env.DB.prepare('SELECT id,at,worked,text,app,device,screen FROM fb WHERE id > ? ORDER BY id LIMIT 100').bind(since).all();
      return new Response(JSON.stringify(r.results), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    return env.ASSETS.fetch(req);
  },
};
