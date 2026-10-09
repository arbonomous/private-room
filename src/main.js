import { Peer } from 'peerjs';
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';
import { EditorView, basicSetup } from 'codemirror';
import { Decoration, ViewPlugin, keymap } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { html } from '@codemirror/lang-html';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { TEMPLATES } from './templates.js';
import { MODELS, makeCloud, usage as cloudUsage, limit as CLOUD_LIMIT } from './cloud.js';

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
const queue = doc.getMap('queue');
const cps = doc.getMap('checkpoints');
const authors = doc.getMap('authors');
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
  v.srcObject = stream; v.muted = !!isLocal; v.style.borderColor = colors[slot % 4]; v.style.borderWidth = '3px'; v.style.borderStyle = 'solid';
  v.onloadedmetadata = () => v.play().catch(() => {});
  setTimeout(() => { if (v.paused) v.play().catch(() => {}); }, 1500);
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
  if (slot >= MAX) {
    // All 4 ids look taken. After a refresh the broker can hold the old id for a while, so wait and retry.
    window.__pr.fullTries = (window.__pr.fullTries || 0) + 1;
    if (window.__pr.fullTries > 12) { status('Room is full (4 people max).'); return; }
    status('Room looks full. If you just refreshed, waiting a few seconds for your old spot to free up...');
    setTimeout(() => register(0), 6000); return;
  }
  const p = new Peer(roomId + '-' + slot, { debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] } });
  p.on('disconnected', () => { if (me >= 0 && !p.destroyed) { try { p.reconnect(); } catch (e) { /* retry on next event */ } } });
  p.on('error', (e) => {
    if (e.type === 'unavailable-id' && me < 0) { p.destroy(); register(slot + 1); }
    else if (e.type !== 'peer-unavailable') status('Connection problem: ' + e.type);
  });
  p.on('open', () => {
    peer = p; me = slot; window.__pr.peer = p; authors.set(String(doc.clientID), me);
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
  // Undo: only changes made on this computer are tracked (remote updates use origin 'remote'), so Ctrl+Z never undoes someone else's work.
  const undo = new Y.UndoManager(ytext);
  window.__pr.undo = undo;
  if (me >= 0) authors.set(String(doc.clientID), me);
  const authorPlugin = ViewPlugin.fromClass(class {
    constructor(v) { this.deco = this.build(v); }
    update(u) { if (u.docChanged || u.transactions.some((t) => t.effects.length) || this.on !== $('#authcol').checked) this.deco = this.build(u.view); }
    build(v) {
      this.on = $('#authcol').checked; const out = [];
      if (!this.on) return Decoration.none;
      let pos = 0;
      for (let it = ytext._start; it; it = it.right) {
        if (it.deleted || !it.countable) continue;
        const slot = authors.get(String(it.id.client));
        if (slot !== undefined && it.length && pos + it.length <= v.state.doc.length) out.push(Decoration.mark({ attributes: { style: 'background:' + colors[slot % 4] + '40' } }).range(pos, pos + it.length));
        pos += it.length;
      }
      return Decoration.set(out, true);
    }
  }, { decorations: (v) => v.deco });
  const redraw = () => { if (view) view.dispatch({}); };
  authors.observe(redraw); $('#authcol').onchange = redraw;
  const legend = $('#authleg'); legend.innerHTML = [0, 1, 2, 3].map((i) => '<span style="background:' + colors[i] + '40;padding:0 6px;border-radius:3px">Guest ' + (i + 1) + (i === me ? ' (you)' : '') + '</span>').join(' ');
  view = new EditorView({
    state: EditorState.create({ doc: ytext.toString(), extensions: [Prec.highest(keymap.of(yUndoManagerKeymap)), yCollab(ytext, awareness, { undoManager: undo }), basicSetup, html(), authorPlugin] }),
    parent: $('#editor'),
  });
}

function setupCheckpoints() {
  const list = $('#cplist');
  const save = (label) => {
    const text = ytext.toString();
    const last = [...cps.values()].sort((x, y) => y.t - x.t)[0];
    if (last && last.text === text) return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    cps.set(id, { id, label, author: 'Guest ' + (me + 1), t: Date.now(), text });
    const all = [...cps.values()].sort((x, y) => y.t - x.t);
    for (const old of all.slice(30)) cps.delete(old.id);
  };
  window.__pr.beforeAccept = save;
  $('#cpsave').onclick = () => { save('Saved by hand'); };
  const render = () => {
    const all = [...cps.values()].sort((x, y) => y.t - x.t);
    list.innerHTML = '';
    if (!all.length) { list.innerHTML = '<span class="muted">Nothing yet. A version is saved automatically before every change.</span>'; return; }
    for (const c of all.slice(0, 10)) {
      const d = document.createElement('div'); d.className = 'cp';
      const when = new Date(c.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const s = document.createElement('span'); s.textContent = when + ' - ' + c.label;
      const b = document.createElement('button'); b.className = 'alt'; b.textContent = 'Go back to this';
      b.onclick = () => {
        if (!window.confirm('Put the game back the way it was? This changes it for everyone. Your current game is saved first.')) return;
        save('Before restoring the ' + when + ' checkpoint');
        doc.transact(() => { ytext.delete(0, ytext.length); ytext.insert(0, c.text); });
      };
      d.appendChild(s); d.appendChild(b); list.appendChild(d);
    }
  };
  $('#undolast').onclick = () => {
    const cur = ytext.toString();
    const prev = [...cps.values()].sort((x, y) => y.t - x.t).find((c) => c.text !== cur);
    if (!prev) { $('#buildst').textContent = 'Nothing to undo yet.'; return; }
    save('Before undoing the last change');
    doc.transact(() => { ytext.delete(0, ytext.length); ytext.insert(0, prev.text); });
    $('#buildst').textContent = 'Undone. Your game is back to how it was.';
  };
  cps.observe(render); render();
}

function setupProposals() {
  const list = $('#proplist');
  const render = () => {
    const all = [...props.values()].sort((x, y) => y.t - x.t);
    list.innerHTML = '';
    if (!all.length && !queue.size) { list.innerHTML = '<span class="muted">When a friend\'s AI wants to change the game, it shows up here. Nothing changes until you accept.</span>'; return; }
    for (const q of [...queue.values()].sort((a, b) => a.t - b.t)) { const w = document.createElement('div'); w.className = 'prop done'; w.textContent = 'In line: ' + q.author + ' wants: ' + q.want; list.appendChild(w); }
    for (const p of all.slice(0, 12)) {
      const d = document.createElement('div'); d.className = 'prop' + (p.status === 'pending' ? '' : ' done');
      if (p.status !== 'pending') { d.textContent = p.author + "'s change was " + (p.status === 'rejected' ? 'skipped' : p.status) + (p.by ? ' by ' + p.by : '') + '.'; list.appendChild(d); continue; }
      const hd = document.createElement('div'); hd.textContent = p.want ? p.author + ' wants: ' + p.want : p.author + "'s AI wants to change the game"; d.appendChild(hd);
      const pre = document.createElement('pre'); pre.className = 'tech'; pre.textContent = p.text; d.appendChild(pre);
      const pvb = document.createElement('button'); pvb.className = 'alt'; pvb.textContent = 'Preview'; pvb.onclick = () => { const full = /^\s*(<!doctype|<html)/i.test(p.text); const at0 = Math.min(view.state.selection.main.head, ytext.length); const t0 = ytext.toString(); window.__pr.previewDoc(full ? p.text : t0.slice(0, at0) + '\n' + p.text + '\n' + t0.slice(at0)); }; d.appendChild(pvb);
      const ok = document.createElement('button'); ok.textContent = 'Accept';
      const no = document.createElement('button'); no.textContent = 'Skip'; no.className = 'alt';
      ok.onclick = () => {
        const cur = props.get(p.id); if (!cur || cur.status !== 'pending') return;
        if (window.__pr.beforeAccept) window.__pr.beforeAccept('Before accepting ' + p.author + "'s suggestion");
        const at = Math.min(view.state.selection.main.head, ytext.length);
        const full = /^\s*(<!doctype|<html)/i.test(p.text);
        doc.transact(() => { if (full) { ytext.delete(0, ytext.length); ytext.insert(0, p.text); } else ytext.insert(at, '\n' + p.text + '\n'); props.set(p.id, { ...cur, status: 'accepted', by: 'Guest ' + (me + 1) }); });
      };
      no.onclick = () => { const cur = props.get(p.id); if (cur && cur.status === 'pending') window.__pr.runPreview(); if (cur && cur.status === 'pending') props.set(p.id, { ...cur, status: 'rejected', by: 'Guest ' + (me + 1) }); };
      d.appendChild(ok); d.appendChild(no); list.appendChild(d);
    }
  };
  props.observe(render); doc.getMap('queue').observe(render); render();
}

const CSP = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:\">";
const CSP_NET = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; media-src data: blob: https:; font-src data: https:; connect-src https: wss:\">";
const csp = () => (window.__pr.net ? CSP_NET : CSP);
const SHIM = `<script>(function(){var P=function(t,m){try{parent.postMessage({__pv:t,m:String(m)},'*')}catch(e){}};
addEventListener('error',function(e){P('error',(e.message||'script error')+(e.lineno?' (line '+e.lineno+')':''))});
addEventListener('unhandledrejection',function(e){P('error',e.reason)});
addEventListener('securitypolicyviolation',function(e){P('blocked',e.blockedURI+' ('+e.violatedDirective+')')});
var ce=console.error;console.error=function(){P('error',[].join.call(arguments,' '));ce.apply(console,arguments)};
var mem={};function st(){return{getItem:function(k){return k in mem?mem[k]:null},setItem:function(k,v){mem[k]=String(v)},removeItem:function(k){delete mem[k]},clear:function(){mem={}},key:function(i){return Object.keys(mem)[i]||null},get length(){return Object.keys(mem).length}}}
try{Object.defineProperty(window,'localStorage',{value:st(),configurable:true});Object.defineProperty(window,'sessionStorage',{value:st(),configurable:true})}catch(e){}
window.alert=function(x){P('note','alert: '+x)};window.confirm=function(){return true};window.prompt=function(){return null};
P('note','started');})()<\/script>`;
function buildDoc(src) {
  const t = src.trim();
  if (!t) return '';
  if (t[0] === '<') {
    const dt = /^\s*<!doctype[^>]*>/i.exec(src);
    if (dt) return dt[0] + csp() + SHIM + src.slice(dt[0].length);
    return '<!doctype html>' + csp() + SHIM + src;
  }
  return '<!doctype html>' + csp() + SHIM + '<body><script>' + src.replace(/<\/script/gi, '<\\/script') + '<\/script></body>';
}
function setupPreview() {
  const frame = $('#frame'), log = $('#pvlog'); let timer = 0;
  const say = (cls, t) => { const d = document.createElement('div'); d.className = cls + (/^Ran at/.test(t) ? ' tech' : ''); if (cls === 'pverr') { const f = document.createElement('span'); f.textContent = "That didn't work. "; d.appendChild(f); const x = document.createElement('span'); x.className = 'tech'; x.textContent = t; d.appendChild(x); const h = document.createElement('span'); h.textContent = ' Tell the AI what went wrong and it will try to fix it.'; d.appendChild(h); } else d.textContent = t; log.appendChild(d); while (log.children.length > 8) log.firstChild.remove(); };
  addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow || !e.data || !e.data.__pv) return;
    const k = e.data.__pv; const OFF = (SHIM.match(/\n/g) || []).length;
    if (typeof e.data.m === 'string') e.data.m = e.data.m.replace(/\(line (\d+)\)/, (x, n) => '(line ' + Math.max(1, +n - OFF) + ')');
    if (k === 'error' || k === 'blocked') window.__pr.lastErr = (k === 'blocked' ? 'Blocked: this code loads something from the internet (' + e.data.m + '), which the preview does not allow. Use only inline code, no external scripts, images or fonts.' : e.data.m);
    if (k === 'error') {
      say('pverr', 'Error in your code: ' + e.data.m);
      const fb = document.createElement('button'); fb.className = 'alt'; fb.textContent = 'Ask AI to fix this error';
      fb.onclick = () => {
        const mm = /line (\d+)/.exec(e.data.m); const ln = mm ? ytext.toString().split('\n')[+mm[1] - 1] : '';
        $('#aiq').value = 'My code gives this error when it runs in the preview: ' + e.data.m + (ln ? '\nThe line it points to is: ' + ln.trim().slice(0, 200) : '') + '\nFix the bug and give me the complete corrected code as ONE self-contained HTML file. Use let (not const) for anything that gets reassigned. No imports or libraries.';
        $('#aictx').checked = true; window.__pr.autoPropose = true;
        if ($('#aiask').disabled) { $('#aiprog').textContent = 'Load the AI first (Load AI button), then press Ask. The question is already filled in.'; }
        else $('#aiask').click();
        $('#ai').scrollIntoView();
      };
      log.appendChild(fb);
      if (/import statement|Cannot use import|import\.meta|Unexpected token 'export'|require is not defined/i.test(e.data.m)) {
        say('pverr', 'In plain words: this code imports a library (an import line). The preview has no internet, so imports cannot work. Ask the AI to rewrite it as one file in plain JavaScript with no imports.');
        const b = document.createElement('button'); b.className = 'alt'; b.textContent = 'Ask AI to remove imports';
        b.onclick = () => {
          $('#aiq').value = 'Rewrite my code so it has NO import statements, NO require and NO libraries or CDN links. Use only plain vanilla JavaScript in one self-contained HTML file. Keep the same game.';
          $('#aictx').checked = true; window.__pr.autoPropose = true;
          if ($('#aiask').disabled) { $('#aiprog').textContent = 'Load the AI first (Load AI button), then press Ask. The question is already filled in.'; $('#ai').scrollIntoView(); }
          else { $('#aiask').click(); $('#ai').scrollIntoView(); }
        };
        log.appendChild(b);
      }
    }
    else if (k === 'blocked') {
      say('pverr', 'Blocked (no internet in the preview): ' + e.data.m);
      if (!window.__pr.net && !log.querySelector('.netbtn')) { const nb = document.createElement('button'); nb.className = 'netbtn'; nb.textContent = 'Turn on internet for this app'; nb.onclick = () => { $('#netok').checked = true; $('#netok').onchange(); }; log.appendChild(nb); }
    }
    else if (k === 'note' && e.data.m !== 'started') say('pvnote2', e.data.m);
  });
  const run = () => {
    log.innerHTML = '';
    const src = ytext.toString(); const doc2 = buildDoc(src);
    if (!doc2) { say('pverr', 'Nothing to run: the editor is empty.'); frame.srcdoc = ''; return; }
    frame.srcdoc = doc2;
    say('pvnote2', 'Ran at ' + new Date().toLocaleTimeString() + '. Click the game once so the keyboard works.');
    setTimeout(() => { try { frame.focus(); } catch (e) { /* ignore */ } }, 300);
  };
  document.querySelectorAll('[data-idea]').forEach((b) => { b.onclick = () => { $('#onebox').value = b.dataset.idea; $('#onebox').focus(); }; });
  $('#advsw').onchange = () => { document.body.classList.toggle('showadv', $('#advsw').checked); };
  $('#gear').onclick = () => { const d = $('#settings'); d.open = !d.open; if (d.open) d.scrollIntoView({ behavior: 'smooth' }); };
  $('#netok').onchange = () => { window.__pr.net = $('#netok').checked; $('#netwarn').textContent = window.__pr.net ? 'On. This app can load things from the internet. It still cannot see your room, your key, or your friends.' : 'Off. Turn on only for apps that need things from the internet.'; run(); };
  window.__pr.previewDoc = (src) => { frame.srcdoc = buildDoc(src); say('pvnote2', 'Trying the change. Press Accept to keep it, or Skip to leave your game as it is.'); };
  $('#run').onclick = run;
  document.querySelectorAll('#starters button').forEach((b) => {
    b.onclick = () => {
      const t = TEMPLATES[b.dataset.t]; if (!t) return;
      if (window.__pr.beforeAccept && ytext.length) window.__pr.beforeAccept('Before loading the ' + t[0] + ' starter');
      doc.transact(() => { ytext.delete(0, ytext.length); ytext.insert(0, t[1]); });
      run();
    };
  });
  ytext.observe(() => { if ($('#autorun').checked) { clearTimeout(timer); timer = setTimeout(run, 1000); } });
  window.__pr.runPreview = run;
}

function extractCode(reply) {
  const blocks = [...reply.matchAll(/```([A-Za-z0-9+#-]*)[ \t]*\n([\s\S]*?)(?:```|$)/g)].map((x) => ({ lang: x[1].toLowerCase(), code: x[2].replace(/\n+$/, '') })).filter((b) => b.code.trim());
  if (!blocks.length) return reply.trim();
  if (blocks.length === 1) return blocks[0].code;
  const css = blocks.filter((b) => b.lang === 'css').map((b) => b.code).join('\n');
  const js = blocks.filter((b) => /^(js|javascript|jsx|ts)$/.test(b.lang)).map((b) => b.code).join('\n');
  const htm = blocks.filter((b) => /^(html|htm)$/.test(b.lang) || (!b.lang && b.code.trim()[0] === '<')).map((b) => b.code).join('\n');
  if (!htm && !css) return blocks.map((b) => b.code).join('\n');
  let out = htm || '<!doctype html>\n<html><body></body></html>';
  const add = (s, tag) => { if (!s) return; const blk = '<' + tag + '>\n' + s + '\n</' + tag + '>\n'; out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, () => blk + '</body>') : out + '\n' + blk; };
  if (css && !/<style/i.test(out)) add(css, 'style');
  if (js && !/<script[^>]*>[^<]/i.test(out)) add(js, 'script');
  return out;
}

function setupAI() {
  let ai = null, last = '', localReady = false;
  const cloud = makeCloud(() => $('#orkey').value.trim(), () => $('#ormodel').value, () => cloudUi());
  const useCloud = () => $('#cloudon').checked;
  const brain = () => (useCloud() ? cloud : ai);
  const cloudUi = () => {
    $('#orbox').hidden = !useCloud();
    $('#cloudst').textContent = 'Cloud requests used today: ' + cloudUsage() + ' of about ' + CLOUD_LIMIT + (useCloud() && !$('#orkey').value.trim() ? '. Paste your key to start.' : '.');
    $('#aiask').disabled = useCloud() ? !$('#orkey').value.trim() : !localReady;
  };
  $('#ormodel').innerHTML = MODELS.map((m) => '<option value="' + m[0] + '">' + m[1] + '</option>').join('');
  try { const k = localStorage.getItem('pr_or_key'); if (k) { $('#orkey').value = k; $('#orremember').checked = true; } } catch (e) { /* ignore */ }
  $('#cloudon').onchange = cloudUi;
  $('#orkey').oninput = () => { try { if ($('#orremember').checked) localStorage.setItem('pr_or_key', $('#orkey').value.trim()); } catch (e) { /* ignore */ } cloudUi(); };
  $('#orremember').onchange = () => { try { if ($('#orremember').checked) localStorage.setItem('pr_or_key', $('#orkey').value.trim()); else localStorage.removeItem('pr_or_key'); } catch (e) { /* ignore */ } };
  $('#orforget').onclick = () => { $('#orkey').value = ''; try { localStorage.removeItem('pr_or_key'); } catch (e) { /* ignore */ } cloudUi(); };
  window.__pr.cloudUi = cloudUi;
  const sys = 'You are a concise coding assistant inside a pair-programming room. Answer briefly. If the user asks for a page, game or app, reply with ONE complete self-contained HTML file in a single ```html code block: inline CSS and JavaScript, no external libraries, images or network calls, no localStorage. Use let (not const) for any variable that is reassigned later, such as score, lives, position or game state; use const only for values that never change. For shooter, 3D or doom-like requests, build a Wolfenstein-style raycaster: a 2D map array, cast one ray per screen column with a small step, draw one vertical wall strip per column on a canvas, draw enemies as sprites compared against the wall distance. NEVER use import, export, require or <script src>. Do not use frameworks (no Phaser, p5, three.js, jQuery); write vanilla JavaScript with the canvas or DOM only, with all code inline. Otherwise put code in one fenced code block.';
  const prog = (t) => { $('#aiprog').textContent = t; };
  $('#aiload').onclick = async () => {
    try {
      ai = ai || await import(new URL('./ai.js', location.href).href);
      const g = await ai.gpuInfo();
      if (!g.ok) { prog(g.why); return; }
      const names = { 'Qwen3.5-9B': 'Strongest (9B)', 'Qwen2.5-Coder-7B-Instruct': 'Strong (7B coder)', 'Qwen2.5-Coder-3B-Instruct': 'Stronger (3B)', 'Qwen2.5-Coder-1.5B-Instruct': 'Balanced (1.5B)', 'Qwen2.5-Coder-0.5B-Instruct': 'Light (0.5B)' };
      const order = ['Qwen3.5-9B', 'Qwen2.5-Coder-7B-Instruct', 'Qwen2.5-Coder-3B-Instruct', 'Qwen2.5-Coder-1.5B-Instruct', 'Qwen2.5-Coder-0.5B-Instruct'];
      const chosen = $('#aimodel').value; const tries = order.slice(order.indexOf(chosen));
      $('#aiload').disabled = true; const t0 = performance.now(); let loaded = '', why = '';
      for (const base of tries) {
        const id = base + (g.f16 ? '-q4f16_1-MLC' : '-q4f32_1-MLC');
        if (!ai.hasModel(id)) continue;
        try { await ai.loadModel(id, (t, pr) => prog(names[base] + ' model: ' + Math.round(pr * 100) + '% ' + t)); loaded = base; break; }
        catch (e) { why = String(e.message || e).slice(0, 100); if (base !== tries[tries.length - 1]) prog('The ' + names[base] + ' model did not fit on this computer (' + why + '). Switching to a smaller one...'); }
      }
      if (!loaded) throw new Error(why || 'no model could be loaded');
      $('#aimodel').value = loaded;
      prog('Ready. Running the ' + names[loaded] + ' model' + (loaded !== chosen ? ' (the bigger one did not fit, so this smaller one was used)' : '') + ', loaded in ' + Math.round((performance.now() - t0) / 1000) + 's. It runs on this device only.');
      localReady = true; cloudUi(); $('#aiload').disabled = false;
    } catch (e) { prog('Could not load the AI: ' + (e.message || e)); $('#aiload').disabled = false; }
  };
  $('#aiask').onclick = async () => {
    const q = $('#aiq').value.trim(); if (!q) return;
    const code = $('#aictx').checked ? '\n\nCurrent code:\n```\n' + ytext.toString().slice(0, 6000) + '\n```' : '';
    $('#aiask').disabled = true; $('#aistop').disabled = false; $('#aiins').disabled = true; $('#aiout').textContent = '';
    const t0 = performance.now();
    try { last = await brain().ask([{ role: 'system', content: sys }, { role: 'user', content: q + code }], (t) => { $('#aiout').textContent = t; }); }
    catch (e) { $('#aiout').textContent = 'Error: ' + (e.message || e); }
    prog('Answered in ' + Math.round((performance.now() - t0) / 1000) + 's');
    cloudUi(); $('#aistop').disabled = true; $('#aiins').disabled = !last;
    if (window.__pr.autoPropose && last) { window.__pr.autoPropose = false; $('#aiins').click(); }
  };

  const bst = (t) => { $('#buildst').textContent = t; };
  const ensureAI = async () => {
    if (useCloud()) return !!$('#orkey').value.trim() || (bst('Paste your OpenRouter key in the Cloud AI box first.'), false);
    if (localReady) return true;
    $('#aiload').click();
    for (let i = 0; i < 1800; i++) { await new Promise((r) => setTimeout(r, 500)); if (!$('#aiask').disabled) return true; if (/Could not|not available|WebGPU|GPU/i.test($('#aiprog').textContent) && !$('#aiload').disabled) return false; }
    return false;
  };
  let building = false, cancel = false;
  $('#bstop').onclick = () => { cancel = true; const b = brain(); if (b) b.stop(); };
  const CHANGE_RE = /^(make|add|change|remove|fix|turn|let|give|now|also|and|can|please|use|set|speed|slow|bigger|smaller|it |the )|\b(it|the game|my game)\b/i;
  const pendingAny = () => [...props.values()].some((x) => x.status === 'pending');
  $('#build').onclick = () => { const d = $('#onebox').value.trim(); if (!d || building) return; doBuild(d, false); };
  const doBuild = async (desc, fromQueue) => {
    if (building) return;
    const peers = conns.size > 0;
    if (peers && ytext.length > 0 && !fromQueue && (pendingAny() || queue.size > 0) && CHANGE_RE.test(desc)) {
      const qid = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      queue.set(qid, { id: qid, author: 'Guest ' + (me + 1), want: desc, t: Date.now() });
      $('#onebox').value = ''; bst('Added to the line. Someone is deciding on another change first. Yours will be built on top of the newest game right after.');
      return;
    }
    const changeMode = ytext.length > 0 && CHANGE_RE.test(desc);
    const request = changeMode && peers;
    const kw = changeMode ? '' : /doom|wolfenstein|first[- ]?person|\bfps\b|3d shooter/i.test(desc) ? 'doom' : desc.length < 50 && /\bsnake\b/i.test(desc) ? 'snake' : desc.length < 50 && /\bpong\b/i.test(desc) ? 'pong' : desc.length < 50 && /clicker/i.test(desc) ? 'clicker' : desc.length < 50 && /memory/i.test(desc) ? 'memory' : '';
    if (kw) {
      if (window.__pr.beforeAccept && ytext.length) window.__pr.beforeAccept('Before loading the ' + TEMPLATES[kw][0] + ' starter');
      doc.transact(() => { ytext.delete(0, ytext.length); ytext.insert(0, TEMPLATES[kw][1]); });
      window.__pr.runPreview();
      bst('A small AI cannot reliably write this one from scratch, so I loaded the hand-tested ' + TEMPLATES[kw][0] + ' game. It is running in the preview. Click inside it to play, then ask the AI to change things.');
      return;
    }
    building = true; cancel = false; $('#build').disabled = true; $('#bstop').disabled = false;
    try {
      bst('Starting the AI (the first time downloads the model, this can take a few minutes)...');
      if (!(await ensureAI())) { bst('The AI could not start here: ' + $('#aiprog').textContent + ' You can still use the Start here games above.'); return; }
      const MAXTRY = useCloud() ? 2 : 3;
      const code0 = ytext.toString();
      let code = '', err = '', saved = false;
      for (let attempt = 0; attempt <= MAXTRY; attempt++) {
        if (cancel) { bst('Stopped.'); return; }
        const user = attempt === 0 ? (changeMode ? 'Here is my current game:\n```html\n' + code0.slice(0, 6000) + '\n```\nChange it like this: ' + desc + '\nGive me the complete updated code as ONE self-contained HTML file. Use let (not const) for anything reassigned. No imports or libraries.' : desc) : 'This code failed with: ' + err + '\nHere is the code:\n```html\n' + code.slice(0, 6000) + '\n```\nFix it and give me the complete corrected code as ONE self-contained HTML file. Use let (not const) for anything reassigned. No imports or libraries.';
        bst(attempt === 0 ? 'Writing your game...' : 'Fixing a problem automatically (try ' + attempt + ' of ' + MAXTRY + ')...');
        let reply = '';
        try { reply = await brain().ask([{ role: 'system', content: sys }, { role: 'user', content: user }], (t) => { $('#aiout').textContent = t; }); } catch (e) { bst('The AI stopped with an error: ' + (e.message || e)); return; }
        if (cancel) { bst('Stopped.'); return; }
        const next = extractCode(reply);
        if (!next.trim()) { err = 'The reply had no code.'; continue; }
        code = next;
        if (!saved && window.__pr.beforeAccept && ytext.length) { window.__pr.beforeAccept('Before AI built: ' + desc.slice(0, 40)); saved = true; }
        if (request) window.__pr.previewDoc(code); else doc.transact(() => { ytext.delete(0, ytext.length); ytext.insert(0, code); });
        window.__pr.lastErr = null; if (!request) window.__pr.runPreview();
        await new Promise((r) => setTimeout(r, 2500));
        if (!window.__pr.lastErr && request) { const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); props.set(id, { id, author: 'Guest ' + (me + 1), want: desc, text: code, status: 'pending', t: Date.now() }); $('#onebox').value = ''; bst('Your change is shared with the room. Everyone can try it, then one person accepts or skips it.'); return; }
        if (!window.__pr.lastErr) { bst(attempt === 0 ? 'Done. It is running in the preview. Click inside it to play.' : 'Done. The AI fixed it by itself (' + attempt + ' ' + (attempt === 1 ? 'fix' : 'fixes') + '). It is running in the preview.'); return; }
        const mm = /line (\d+)/.exec(window.__pr.lastErr); const ln = mm ? (request ? code : ytext.toString()).split('\n')[+mm[1] - 1] : '';
        err = window.__pr.lastErr + (ln ? ' | line: ' + ln.trim().slice(0, 200) : '');
      }
      bst('Could not get it working after ' + MAXTRY + ' automatic fixes (' + String(err).slice(0, 120) + '). Try the Stronger (3B) model in the AI panel, describe it more simply, or tap a Start here game. Your previous code is saved under Checkpoints.');
    } finally { building = false; $('#build').disabled = false; $('#bstop').disabled = true; }
  };
  const pump = () => {
    if (building || pendingAny() || !queue.size) return;
    const head = [...queue.values()].sort((a, b) => a.t - b.t)[0];
    if (head.author !== 'Guest ' + (me + 1)) return;
    queue.delete(head.id); $('#onebox').value = head.want; doBuild(head.want, true);
  };
  props.observe(() => setTimeout(pump, 400)); queue.observe(() => setTimeout(pump, 400));
  $('#aistop').onclick = () => { const b = brain(); if (b) b.stop(); };
  $('#aiins').onclick = () => {
    const txt = extractCode(last);
    if (!txt.trim()) return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    props.set(id, { id, author: 'Guest ' + (me + 1), text: txt, status: 'pending', t: Date.now() });
    $('#aiins').disabled = true; prog('Proposed to the room. Others see it under Suggestions.' + (/^\s*import\s/m.test(txt) || /<script[^>]+src=/i.test(txt) ? ' Warning: this code has import lines or external scripts, which will not run in the preview.' : ''));
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
  setupEditor(); setupCheckpoints(); setupProposals(); setupPreview(); setupAI(); register(0);
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
