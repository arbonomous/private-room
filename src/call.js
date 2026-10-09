import { Peer } from 'peerjs';

const APP_NAME = 'mut3'; // working name, change here only
const $ = (s) => document.querySelector(s);
document.title = APP_NAME;
document.querySelectorAll('.appname').forEach((e) => { e.textContent = APP_NAME; });
const enc = new TextEncoder(), dec = new TextDecoder();
const MAX = 4;
const MAXFILE = 25 * 1024 * 1024;
const CHUNK = 16 * 1024;
const b64u = (u) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (u) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));

let key, roomId, aes, local, screen, peer, me = -1, myName = '';
const conns = new Map(), calls = new Map(), tiles = new Map(), info = new Map(), pending = new Map(), lastTry = new Map();
const stats = { sent: 0, recv: 0 };
const colors = ['#e07a5f', '#3d85c6', '#81b29a', '#f2cc8f'];
const state = { mic: true, cam: true };
window.__pr = { conns, stats, Peer, info };

const status = (t) => { $('#status').textContent = t; };
const slotOf = (id) => +id.split('-').pop();
const nameOf = (s) => (info.get(s) && info.get(s).name) || 'Guest ' + (s + 1);

// Every message is bound to its type, its sender and its recipient through AES-GCM additional data.
const aadFor = (type, from, to) => new TextEncoder().encode(type + '|' + from + '|' + to);
const myId = () => roomId + '-' + me;
async function seal(type, u8, c) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(type, myId(), c.peer) }, aes, u8));
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = type; out.set(iv, 1); out.set(ct, 13);
  return out;
}
async function open(d, c) {
  const u = d instanceof Uint8Array ? d : new Uint8Array(d.buffer ? d.buffer : d);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(1, 13), additionalData: aadFor(u[0], c.peer, myId()) }, aes, u.slice(13)));
  return [u[0], pt];
}
async function send(c, type, u8) { if (!c.open) return; c.send(await seal(type, u8, c)); stats.sent++; }
function broadcast(type, u8) { for (const c of conns.values()) send(c, type, u8); }
const json = (o) => enc.encode(JSON.stringify(o));
const sendMeta = () => broadcast(4, json({ name: myName, mic: state.mic, cam: state.cam, sharing: !!screen }));

function fakeStream(label) {
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 240;
  const g = cv.getContext('2d'); let t = 0;
  setInterval(() => {
    g.fillStyle = '#1f2933'; g.fillRect(0, 0, 320, 240);
    g.fillStyle = colors[me >= 0 ? me % 4 : 0]; g.fillRect(20 + (t % 240), 150, 40, 40);
    g.fillStyle = '#fff'; g.font = '20px sans-serif'; g.fillText(label + ' (test video)', 20, 60); t += 4;
  }, 66);
  return cv.captureStream(15);
}
async function getStream(useCam) {
  if (useCam) {
    try { return await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) {
      try { const a = await navigator.mediaDevices.getUserMedia({ audio: true }); status('No camera found, audio only'); state.cam = false; return a; }
      catch (e2) { status('No camera or mic, using test video'); }
    }
  }
  state.mic = false; state.cam = false;
  return fakeStream('Guest');
}

function tile(slot) {
  let t = tiles.get(slot);
  if (!t) {
    const fig = document.createElement('figure');
    fig.innerHTML = '<video autoplay playsinline></video><figcaption><span class="nm"></span><span class="ic"></span></figcaption>';
    $('#videos').appendChild(fig); t = fig; tiles.set(slot, t);
  }
  return t;
}
function paintTile(slot) {
  const t = tiles.get(slot); if (!t) return;
  const i = slot === me ? { name: myName || 'You', mic: state.mic, cam: state.cam, sharing: !!screen } : (info.get(slot) || {});
  t.querySelector('.nm').textContent = slot === me ? (myName || 'You') + ' (you)' : nameOf(slot);
  t.querySelector('.ic').textContent = (i.mic === false ? ' 🔇' : '') + (i.cam === false ? ' 📷off' : '') + (i.sharing ? ' 🖥' : '');
  t.classList.toggle('off', i.cam === false && !i.sharing);
  const n = tiles.size; $('#videos').dataset.n = n;
}
function addVideo(slot, stream, isLocal) {
  const box = tile(slot); const v = box.querySelector('video');
  v.srcObject = stream; v.muted = !!isLocal; v.style.borderColor = colors[slot % 4];
  v.onloadedmetadata = () => v.play().catch(() => {});
  setTimeout(() => { if (v.paused) v.play().catch(() => {}); }, 1500);
  paintTile(slot); v.play().catch(() => {});
}
function dropVideo(slot) { const b = tiles.get(slot); if (b) { b.remove(); tiles.delete(slot); } info.delete(slot); calls.delete(slot); $('#videos').dataset.n = tiles.size; }

function tryAnswer(s) {
  const call = pending.get(s), c = conns.get(s);
  if (!call || !c || !c.__authed || call.peer !== c.peer) return;
  pending.delete(s);
  call.answer(currentOut());
  watchCall(s, call);
}
const currentOut = () => local;
function watchCall(s, call) {
  calls.set(s, call);
  call.on('stream', (st) => addVideo(s, st, false));
  call.on('close', () => { if (calls.get(s) === call) calls.delete(s); });
}

// ---- chat ----
function addMsg(who, text, mine, slot) {
  const d = document.createElement('div'); d.className = 'msg' + (mine ? ' mine' : '');
  const b = document.createElement('b'); b.textContent = who + ' '; b.style.color = colors[(slot || 0) % 4];
  const s = document.createElement('span'); s.textContent = text;
  d.append(b, s); const l = $('#log'); l.appendChild(d); l.scrollTop = l.scrollHeight;
  if (!mine && $('#chatpanel').hidden) $('#chatbtn').classList.add('ping');
}
function sysMsg(text) { const d = document.createElement('div'); d.className = 'sys'; d.textContent = text; $('#log').appendChild(d); $('#log').scrollTop = 1e9; }

// ---- files ----
const incoming = new Map();
const fid = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (x) => x.toString(16).padStart(2, '0')).join('');
function fileRow(who, name, size) {
  const d = document.createElement('div'); d.className = 'msg file';
  d.textContent = who + ': ' + name + ' (' + Math.ceil(size / 1024) + ' KB) ';
  const st = document.createElement('span'); st.textContent = '0%'; d.appendChild(st);
  $('#log').appendChild(d); $('#log').scrollTop = 1e9; if ($('#chatpanel').hidden) $('#chatbtn').classList.add('ping'); return { d, st };
}
async function sendFile(file) {
  if (!conns.size) { sysMsg('Nobody else is here yet.'); return; }
  if (file.size > MAXFILE) { sysMsg('File too big (limit 25 MB).'); return; }
  const id = fid(); const row = fileRow('You sent', file.name, file.size);
  broadcast(5, json({ id, name: file.name, size: file.size, mime: file.type || 'application/octet-stream' }));
  const buf = new Uint8Array(await file.arrayBuffer());
  const idb = enc.encode(id);
  for (let off = 0; off < buf.length || off === 0; off += CHUNK) {
    const part = buf.subarray(off, off + CHUNK); const m = new Uint8Array(8 + part.length); m.set(idb); m.set(part, 8);
    for (const c of conns.values()) {
      while (c.open && c.dataChannel && c.dataChannel.bufferedAmount > 1 << 20) await new Promise((r) => setTimeout(r, 30));
      await send(c, 6, m);
    }
    row.st.textContent = Math.min(100, Math.round(((off + CHUNK) / Math.max(1, buf.length)) * 100)) + '%';
    if (!buf.length) break;
  }
  row.st.textContent = 'sent';
}
function onFileMeta(s, m) {
  if (!m || typeof m.id !== 'string' || m.id.length !== 8 || !(m.size >= 0) || m.size > MAXFILE) return;
  const k = s + ':' + m.id; if (incoming.has(k)) return;
  const row = fileRow(nameOf(s) + ' sends', String(m.name).slice(0, 100), m.size);
  incoming.set(k, { m, parts: [], got: 0, row });
}
function onFileChunk(s, pt) {
  const id = dec.decode(pt.slice(0, 8)); const k = s + ':' + id; const f = incoming.get(k); if (!f) return;
  const part = pt.slice(8); f.got += part.length;
  if (f.got > f.m.size) { incoming.delete(k); f.row.st.textContent = 'rejected'; return; }
  f.parts.push(part); f.row.st.textContent = Math.round((f.got / Math.max(1, f.m.size)) * 100) + '%';
  if (f.got >= f.m.size) {
    incoming.delete(k);
    const url = URL.createObjectURL(new Blob(f.parts, { type: 'application/octet-stream' }));
    const a = document.createElement('a'); a.href = url; a.download = String(f.m.name).replace(/[\\/]/g, '_').slice(0, 100); a.textContent = 'Save file';
    f.row.st.textContent = ''; f.row.d.appendChild(a);
  }
}

function onConn(c, outgoing) {
  const s = slotOf(c.peer);
  if (!c.peer.startsWith(roomId + '-') || !(s >= 0 && s < MAX) || s === me) { c.close(); return; }
  const initiator = () => (outgoing ? me : s);
  c.__authed = false;
  c.__nonce = crypto.getRandomValues(new Uint8Array(16));
  // Admission: nothing is shared and no media flows until the other side proves it holds the room key.
  const timer = setTimeout(() => { if (!c.__authed) c.close(); }, 8000);
  const admit = async () => {
    clearTimeout(timer);
    const ex = conns.get(s);
    if (ex && ex !== c && ex.open) {
      if (ex.__init < initiator()) { c.close(); return; }
      conns.delete(s); ex.close();
    }
    c.__authed = true; c.__init = initiator(); c.__last = Date.now();
    conns.set(s, c);
    await send(c, 4, json({ name: myName, mic: state.mic, cam: state.cam, sharing: !!screen }));
    if (outgoing) {
      const call = peer.call(c.peer, currentOut());
      watchCall(s, call);
    }
    tryAnswer(s);
    sysMsg(nameOf(s) + ' joined');
  };
  const hello = async () => c.send(await seal(2, c.__nonce, c));
  c.on('open', hello);
  if (c.open) hello();
  c.on('data', async (d) => {
    try {
      const [type, pt] = await open(d, c);
      if (type === 2) { c.send(await seal(3, pt, c)); return; }
      if (type === 3) {
        if (c.__authed) return;
        if (pt.length === 16 && pt.every((x, i) => x === c.__nonce[i])) await admit();
        return;
      }
      if (!c.__authed) return;
      stats.recv++; c.__last = Date.now();
      if (type === 7) return;
      if (type === 0) { const m = JSON.parse(dec.decode(pt)); addMsg(nameOf(s), String(m.t).slice(0, 2000), false, s); }
      else if (type === 4) { const m = JSON.parse(dec.decode(pt)); info.set(s, { name: String(m.name || '').slice(0, 24) || 'Guest ' + (s + 1), mic: m.mic !== false, cam: m.cam !== false, sharing: !!m.sharing }); paintTile(s); }
      else if (type === 5) onFileMeta(s, JSON.parse(dec.decode(pt)));
      else if (type === 6) onFileChunk(s, pt);
    } catch (e) { console.warn('bad message dropped'); }
  });
  c.on('close', () => {
    clearTimeout(timer);
    if (conns.get(s) === c) { conns.delete(s); const n = nameOf(s); dropVideo(s); if (c.__authed) sysMsg(n + ' left'); }
  });
}

function register(slot) {
  if (slot >= MAX) {
    window.__pr.fullTries = (window.__pr.fullTries || 0) + 1;
    if (window.__pr.fullTries > 12) { status('Room is full (4 people max).'); return; }
    status('Room looks full. If you just refreshed, waiting a few seconds for your old spot to free up...');
    setTimeout(() => register(0), 6000); return;
  }
  const p = new Peer(roomId + '-' + slot, { debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] } });
  p.on('disconnected', () => { if (me >= 0 && !p.destroyed) { status('Reconnecting...'); try { p.reconnect(); } catch (e) { /* next sweep retries */ } } });
  p.on('error', (e) => {
    if (e.type === 'unavailable-id' && me < 0) { p.destroy(); register(slot + 1); }
    else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' || e.type === 'socket-closed') status('Network problem, retrying...');
    else if (e.type !== 'peer-unavailable') status('Connection problem: ' + e.type);
  });
  p.on('open', () => {
    peer = p; me = slot; window.__pr.peer = p;
    addVideo(slot, local, true);
    status('In the call');
    sweep();
  });
  p.on('connection', (c) => onConn(c, false));
  p.on('call', (call) => {
    const s = slotOf(call.peer);
    if (!call.peer.startsWith(roomId + '-') || !(s >= 0 && s < MAX)) { call.close(); return; }
    pending.set(s, call); tryAnswer(s);
    setTimeout(() => { if (pending.get(s) === call) { pending.delete(s); call.close(); } }, 8000);
  });
}
// Keep trying to reach empty slots so late joiners, dropped links and flaky networks heal themselves.
function sweep() {
  if (!peer || peer.destroyed || me < 0) return;
  if (peer.disconnected) { try { peer.reconnect(); } catch (e) { /* retry */ } return; }
  broadcast(7, new Uint8Array(1));
  for (const c of conns.values()) if (Date.now() - (c.__last || 0) > 15000) c.close();
  for (let j = 0; j < MAX; j++) {
    if (j === me) continue;
    const c = conns.get(j);
    if (c && c.open) continue;
    const t = lastTry.get(j) || 0;
    if (Date.now() - t < 4000) continue;
    lastTry.set(j, Date.now());
    onConn(peer.connect(roomId + '-' + j, { reliable: true }), true);
  }
  if ($('#status').textContent === 'Reconnecting...' || $('#status').textContent === 'Network problem, retrying...') status('In the call');
}

// ---- controls ----
function setTracks() {
  local.getAudioTracks().forEach((t) => { t.enabled = state.mic; });
  local.getVideoTracks().forEach((t) => { t.enabled = state.cam; });
  $('#mic').textContent = state.mic ? 'Mute' : 'Unmute'; $('#mic').classList.toggle('off', !state.mic);
  $('#camb').textContent = state.cam ? 'Camera off' : 'Camera on'; $('#camb').classList.toggle('off', !state.cam);
  paintTile(me); sendMeta();
}
function swapVideo(track) {
  for (const call of calls.values()) {
    const pc = call.peerConnection; if (!pc) continue;
    const snd = pc.getSenders().find((x) => x.track && x.track.kind === 'video') || pc.getSenders().find((x) => !x.track || x.track.kind === 'video');
    if (snd && track) snd.replaceTrack(track).catch(() => {});
  }
}
async function toggleShare() {
  if (screen) { stopShare(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { sysMsg('Screen share is not supported on this browser (phones usually cannot).'); return; }
  try {
    screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const t = screen.getVideoTracks()[0]; t.onended = stopShare;
    swapVideo(t); const box = tile(me).querySelector('video'); box.srcObject = screen;
    $('#share').textContent = 'Stop sharing'; paintTile(me); sendMeta();
  } catch (e) { screen = null; }
}
function stopShare() {
  if (!screen) return;
  screen.getTracks().forEach((t) => t.stop()); screen = null;
  const v = local.getVideoTracks()[0]; if (v) swapVideo(v);
  tile(me).querySelector('video').srcObject = local;
  $('#share').textContent = 'Share screen'; paintTile(me); sendMeta();
}
function leave() {
  try { peer && peer.destroy(); } catch (e) { /* closing */ }
  if (local) local.getTracks().forEach((t) => t.stop());
  if (screen) screen.getTracks().forEach((t) => t.stop());
  location.href = location.pathname; // key is dropped from the address; nothing was stored
}

function scan() {
  const a = window.__audit; let k = 0;
  for (const f of a.log) if (key && f.includes(key)) k++;
  return k;
}
function refresh() {
  const a = window.__audit;
  $('#audit').innerHTML = 'People connected directly: ' + conns.size + '<br>Encrypted messages sent / received: ' + stats.sent + ' / ' + stats.recv +
    '<br>Introduction server: ' + (a.hosts.join(', ') || 'none') + '<br>Messages sent to it: ' + a.frames + ' (' + a.bytes + ' bytes)' +
    '<br>Containing your room key: <b>' + scan() + '</b>';
}

async function start(useCam) {
  key = location.hash.slice(1);
  myName = ($('#name').value || '').trim().slice(0, 24);
  roomId = hex(await sha('room:' + key)).slice(0, 24);
  aes = await crypto.subtle.importKey('raw', await sha('enc:' + key), 'AES-GCM', false, ['encrypt', 'decrypt']);
  window.__pr.roomId = roomId;
  $('#gate').hidden = true; $('#room').hidden = false;
  local = await getStream(useCam);
  state.mic = local.getAudioTracks().length > 0; state.cam = local.getVideoTracks().length > 0 && useCam;
  $('#mic').onclick = () => { state.mic = !state.mic; setTracks(); };
  $('#camb').onclick = () => { state.cam = !state.cam; setTracks(); };
  $('#share').onclick = toggleShare;
  $('#leave').onclick = leave;
  $('#chatbtn').onclick = () => { const p = $('#chatpanel'); p.hidden = !p.hidden; $('#chatbtn').classList.remove('ping'); if (!p.hidden) $('#msg').focus(); };
  $('#sendf').onsubmit = (e) => { e.preventDefault(); const t = $('#msg').value.trim(); if (!t) return; addMsg('You', t, true, me); broadcast(0, json({ t })); $('#msg').value = ''; };
  $('#file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) sendFile(f); };
  $('#attach').onclick = () => $('#file').click();
  $('#copy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(location.href); $('#copy').textContent = 'Link copied'; setTimeout(() => { $('#copy').textContent = 'Copy invite link'; }, 2000); };
  setTracks();
  register(0);
  setInterval(sweep, 4000);
  setInterval(refresh, 1000);
  window.addEventListener('online', sweep);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sweep(); });
}

function boot() {
  const hasKey = () => location.hash.length > 10;
  $('#create').onclick = () => { location.hash = b64u(crypto.getRandomValues(new Uint8Array(16))); show(); };
  $('#cam').onclick = () => start(true);
  $('#nocam').onclick = () => start(false);
  function show() { $('#create').hidden = hasKey(); $('#join').hidden = !hasKey(); }
  show();
  window.addEventListener('hashchange', show);
}
boot();
