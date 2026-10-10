import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage();
await p.goto('https://arbonomous-private-room.pages.dev/');
const r = await p.evaluate(async () => {
  const j = await (await fetch('/turn', { cache: 'no-store' })).json();
  const mk = () => new RTCPeerConnection({ iceServers: j.iceServers.filter((s) => /transport=tcp/.test(s.urls)), iceTransportPolicy: 'relay' });
  const a = mk(), c = mk(); const types = [];
  a.onicecandidate = (e) => { if (e.candidate) { types.push(e.candidate.type); c.addIceCandidate(e.candidate); } };
  c.onicecandidate = (e) => { if (e.candidate) a.addIceCandidate(e.candidate); };
  a.onicecandidateerror = (e) => types.push('ERR' + e.errorCode + ':' + (e.errorText||'').slice(0,60) + ':' + e.url);
  const dc = a.createDataChannel('x'); let got = '';
  const done = new Promise((res) => { c.ondatachannel = (e) => { e.channel.onmessage = (m) => res(m.data); }; setTimeout(() => res('timeout'), 15000); });
  dc.onopen = () => dc.send('hi-via-relay');
  const o = await a.createOffer(); await a.setLocalDescription(o); await c.setRemoteDescription(o);
  const an = await c.createAnswer(); await c.setLocalDescription(an); await a.setRemoteDescription(an);
  got = await done; return { types: [...new Set(types)], got, state: a.iceConnectionState };
});
console.log(JSON.stringify(r)); console.log(r.got === 'hi-via-relay' && r.types.every((t) => t === 'relay') && r.types.length ? 'RELAY PASS' : 'RELAY FAIL');
await b.close();
