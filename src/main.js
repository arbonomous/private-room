import { Peer } from 'peerjs';
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { html } from '@codemirror/lang-html';
import { yCollab } from 'y-codemirror.next';

const $ = (s) => document.querySelector(s);
const enc = new TextEncoder();
const MAX = 4;
const b64u = (u) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (u) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));

let key, roomId, aes, local, peer, me = -1;
const conns = new Map();
const videos = new Map();
const stats = { sent: 0, recv: 0 };
const doc = new Y.Doc();
const ytext = doc.getText('code');
const awareness = new Awareness(doc);
const props = doc.getMap('proposals');
let view;
const colors = ['#e07a5f', '#3d85c6', '#81b29a', '#f2cc8f'];
window.__pr = { doc, conns, stats, Peer };

function status(t) { $('#status').textContent = t; }
const slotOf = (id) => +id.split('-').pop();

async function seal(type, u8) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, u8));
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = type; out.set(iv, 1); out.set(ct, 13);
  return out;
}
async function open(d) {
  const u = d instanceof Uint8Array ? d : new Uint8Array(d.buffer ? d.buffer : d);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(1, 13) }, aes, u.slice(13)));
  return [u[0], pt];
}
async function send(c, type, u8) { if (!c.open) return; c.send(await seal(type, u8)); stats.sent++; }
function broadcast(type, u8) { for (const c of conns.values()) send(c, type, u8); }

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
    try { return await navigator.mediaDevices.getUserMedia({ video: { width: 480 }, audio: true }); }
    catch (e) { status('no camera or mic, using test video'); }
  }
  return fakeStream('Guest');
}

function addVideo(slot, stream, isLocal) {
  let box = videos.get(slot);
  if (!box) {
    box = document.createElement('figure');
    box.innerHTML = '<video autoplay playsinline></video><figcaption></figcaption>';
    $('#videos').appendChild(box); videos.set(slot, box);
  }
  const v = box.querySelector('video');
  v.srcObject = stream; v.muted = !!isLocal;
  box.querySelector('figcaption').textContent = isLocal ? 'You' : 'Guest ' + (slot + 1);
  v.play().catch(() => {});
}
function dropVideo(slot) { const b = videos.get(slot); if (b) { b.remove(); videos.delete(slot); } }

const pending = new Map();
function tryAnswer(s) {
  const call = pending.get(s), c = conns.get(s);
  if (!call || !c || !c.__authed || call.peer !== c.peer) return;
  pending.delete(s);
  call.answer(local);
  call.on('stream', (st) => addVideo(s, st, false));
}

function onConn(c, outgoing) {
  const s = slotOf(c.peer);
  if (!c.peer.startsWith(roomId + '-') || !(s >= 0 && s < MAX) || s === me) { c.close(); return; }
  const initiator = () => (outgoing ? me : s);
  c.__authed = false;
  c.__nonce = crypto.getRandomValues(new Uint8Array(16));
  // Admission: nothing is shared, no slot is taken and no media flows until the other side
  // proves it holds the room key by returning our fresh nonce, sealed with that key.
  const timer = setTimeout(() => { if (!c.__authed) c.close(); }, 8000);
  const admit = async () => {
    clearTimeout(timer);
    const ex = conns.get(s);
    if (ex && ex !== c && ex.open) {
      if (ex.__init < initiator()) { c.close(); return; }
      conns.delete(s); ex.close();
    }
    c.__authed = true; c.__init = initiator();
    conns.set(s, c);
    await send(c, 0, Y.encodeStateAsUpdate(doc));
    await send(c, 1, encodeAwarenessUpdate(awareness, [doc.clientID]));
    if (outgoing) {
      const call = peer.call(c.peer, local);
      call.on('stream', (st) => addVideo(s, st, false));
    }
    tryAnswer(s);
  };
  const hello = async () => c.send(await seal(2, c.__nonce));
  c.on('open', hello);
  if (c.open) hello();
  c.on('data', async (d) => {
    try {
      const [type, pt] = await open(d);
      if (type === 2) { c.send(await seal(3, pt)); return; }
      if (type === 3) {
        if (c.__authed) return;
        if (pt.length === 16 && pt.every((x, i) => x === c.__nonce[i])) await admit();
        return;
      }
      if (!c.__authed) return;
      stats.recv++;
      if (type === 0) Y.applyUpdate(doc, pt, 'remote');
      else if (type === 1) applyAwarenessUpdate(awareness, pt, 'remote');
    } catch (e) { console.warn('bad message dropped'); }
  });
  c.on('close', () => { clearTimeout(timer); if (conns.get(s) === c) { conns.delete(s); dropVideo(s); } });
}

function register(slot) {
  if (slot >= MAX) { status('Room is full (4 people max).'); return; }
  const p = new Peer(roomId + '-' + slot, { debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] } });
  p.on('error', (e) => {
    if (e.type === 'unavailable-id' && me < 0) { p.destroy(); register(slot + 1); }
    else if (e.type !== 'peer-unavailable') status('Connection problem: ' + e.type);
  });
  p.on('open', () => {
    peer = p; me = slot; window.__pr.peer = p;
    awareness.setLocalStateField('user', { name: 'Guest ' + (slot + 1), color: colors[slot % 4] });
    addVideo(slot, local, true);
    status('In the room as Guest ' + (slot + 1));
    for (let j = 0; j < MAX; j++) if (j !== me) onConn(p.connect(roomId + '-' + j, { reliable: true }), true);
  });
  p.on('connection', (c) => onConn(c, false));
  p.on('call', (call) => {
    const s = slotOf(call.peer);
    if (!call.peer.startsWith(roomId + '-') || !(s >= 0 && s < MAX)) { call.close(); return; }
    pending.set(s, call); tryAnswer(s);
    setTimeout(() => { if (pending.get(s) === call) { pending.delete(s); call.close(); } }, 8000);
  });
}

function setupEditor() {
  doc.on('update', (u, origin) => { if (origin !== 'remote') broadcast(0, u); });
  awareness.on('update', ({ added, updated, removed }, origin) => {
    if (origin === 'remote') return;
    broadcast(1, encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]));
  });
  const undo = new Y.UndoManager(ytext);
  view = new EditorView({
    state: EditorState.create({ doc: ytext.toString(), extensions: [basicSetup, html(), yCollab(ytext, awareness, { undoManager: undo })] }),
    parent: $('#editor'),
  });
}

const CSP = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:\">";
function setupPreview() {
  const frame = $('#frame'); let timer = 0;
  const run = () => {
    const src = ytext.toString();
    const isHtml = /<\s*(html|body|script|canvas|div|style|h1|p|button)\b/i.test(src);
    frame.srcdoc = CSP + (isHtml ? src : '<body><script>' + src.replace(/<\/script/gi, '<\\/script') + '<\/script></body>');
  };
  $('#run').onclick = run;
  ytext.observe(() => { if ($('#autorun').checked) { clearTimeout(timer); timer = setTimeout(run, 1000); } });
  window.__pr.runPreview = run;
}

function setupProposals() {
  const list = $('#proplist');
  const render = () => {
    const all = [...props.values()].sort((x, y) => y.t - x.t);
    list.innerHTML = '';
    if (!all.length) { list.innerHTML = '<span class="muted">None yet. Anyone can propose AI code; nothing changes until someone presses Accept.</span>'; return; }
    for (const p of all.slice(0, 12)) {
      const d = document.createElement('div'); d.className = 'prop' + (p.status === 'pending' ? '' : ' done');
      if (p.status !== 'pending') { d.textContent = p.author + "'s suggestion was " + p.status + (p.by ? ' by ' + p.by : '') + '.'; list.appendChild(d); continue; }
      const hd = document.createElement('div'); hd.textContent = 'Suggestion from ' + p.author; d.appendChild(hd);
      const pre = document.createElement('pre'); pre.textContent = p.text; d.appendChild(pre);
      const ok = document.createElement('button'); ok.textContent = 'Accept (insert at my cursor)';
      const no = document.createElement('button'); no.textContent = 'Reject'; no.className = 'alt';
      ok.onclick = () => {
        const cur = props.get(p.id); if (!cur || cur.status !== 'pending') return;
        if (window.__pr.beforeAccept) window.__pr.beforeAccept('Before accepting ' + p.author + "'s suggestion");
        const at = Math.min(view.state.selection.main.head, ytext.length);
        doc.transact(() => { ytext.insert(at, '\n' + p.text + '\n'); props.set(p.id, { ...cur, status: 'accepted', by: 'Guest ' + (me + 1) }); });
      };
      no.onclick = () => { const cur = props.get(p.id); if (cur && cur.status === 'pending') props.set(p.id, { ...cur, status: 'rejected', by: 'Guest ' + (me + 1) }); };
      d.appendChild(ok); d.appendChild(no); list.appendChild(d);
    }
  };
  props.observe(render); render();
}

function setupAI() {
  let ai = null, last = '';
  const prog = (t) => { $('#aiprog').textContent = t; };
  $('#aiload').onclick = async () => {
    try {
      ai = ai || await import(new URL('./ai.js', location.href).href);
      const g = await ai.gpuInfo();
      if (!g.ok) { prog(g.why); return; }
      const base = $('#aimodel').value, id = base + (g.f16 ? '-q4f16_1-MLC' : '-q4f32_1-MLC');
      if (!ai.hasModel(id)) { prog('Model not available: ' + id); return; }
      $('#aiload').disabled = true; const t0 = performance.now();
      await ai.loadModel(id, (t, p) => prog(Math.round(p * 100) + '% ' + t));
      prog('Ready (' + id + ', loaded in ' + Math.round((performance.now() - t0) / 1000) + 's). Running on this device only.');
      $('#aiask').disabled = false; $('#aiload').disabled = false;
    } catch (e) { prog('Could not load the AI: ' + (e.message || e)); $('#aiload').disabled = false; }
  };
  $('#aiask').onclick = async () => {
    const q = $('#aiq').value.trim(); if (!q) return;
    const sys = 'You are a concise coding assistant inside a pair-programming room. Answer briefly. Put any code in one fenced code block.';
    const code = $('#aictx').checked ? '\n\nCurrent code:\n```\n' + ytext.toString().slice(0, 6000) + '\n```' : '';
    $('#aiask').disabled = true; $('#aistop').disabled = false; $('#aiins').disabled = true; $('#aiout').textContent = '';
    const t0 = performance.now();
    try { last = await ai.ask([{ role: 'system', content: sys }, { role: 'user', content: q + code }], (t) => { $('#aiout').textContent = t; }); }
    catch (e) { $('#aiout').textContent = 'Error: ' + (e.message || e); }
    prog('Answered in ' + Math.round((performance.now() - t0) / 1000) + 's');
    $('#aiask').disabled = false; $('#aistop').disabled = true; $('#aiins').disabled = !last;
  };
  $('#aistop').onclick = () => ai && ai.stop();
  $('#aiins').onclick = () => {
    const mt = /```[a-zA-Z]*\n([\s\S]*?)```/.exec(last); const txt = (mt ? mt[1] : last).replace(/\n$/, '');
    if (!txt.trim()) return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    props.set(id, { id, author: 'Guest ' + (me + 1), text: txt, status: 'pending', t: Date.now() });
    $('#aiins').disabled = true; prog('Proposed to the room. Others see it under Suggestions.');
  };
}

function scan() {
  const a = window.__audit; const text = ytext.toString();
  const toks = (text.match(/[A-Za-z0-9_]{8,}/g) || []);
  let k = 0, t = 0;
  for (const f of a.log) { if (key && f.includes(key)) k++; if (toks.some((x) => f.includes(x))) t++; }
  return { k, t };
}
function refresh() {
  const a = window.__audit; const { k, t } = scan();
  $('#audit').innerHTML =
    '<b>Privacy check</b><br>People connected directly: ' + conns.size +
    '<br>Encrypted messages sent / received: ' + stats.sent + ' / ' + stats.recv +
    '<br>Introduction server: ' + (a.hosts.join(', ') || 'none') +
    '<br>Messages sent to it: ' + a.frames + ' (' + a.bytes + ' bytes)' +
    '<br>Containing your room key: <b>' + k + '</b>' +
    '<br>Containing your editor text: <b>' + t + '</b>';
}

async function start(useCam) {
  key = location.hash.slice(1);
  roomId = hex(await sha('room:' + key)).slice(0, 24);
  aes = await crypto.subtle.importKey('raw', await sha('enc:' + key), 'AES-GCM', false, ['encrypt', 'decrypt']);
  window.__pr.roomId = roomId;
  $('#gate').hidden = true; $('#room').hidden = false;
  local = await getStream(useCam);
  setupEditor(); setupProposals(); setupPreview(); setupAI(); register(0);
  setInterval(refresh, 1000);
}

function boot() {
  const hasKey = () => location.hash.length > 10;
  $('#create').onclick = () => { location.hash = b64u(crypto.getRandomValues(new Uint8Array(16))); show(); };
  $('#cam').onclick = () => start(true);
  $('#nocam').onclick = () => start(false);
  $('#copy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(location.href); $('#copy').textContent = 'Link copied'; };
  function show() { $('#create').hidden = hasKey(); $('#join').hidden = !hasKey(); }
  show();
}
boot();
