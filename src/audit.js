// Runs before everything else. Records what is sent to the signaling server so the page can show it.
window.__audit = { frames: 0, bytes: 0, hosts: [], log: [] };
(function () {
  const OW = window.WebSocket;
  function W(url, p) {
    const ws = p ? new OW(url, p) : new OW(url);
    try { const h = new URL(url).host; if (!window.__audit.hosts.includes(h)) window.__audit.hosts.push(h); } catch (e) {}
    window.__audit.log.push(String(url));
    const os = ws.send.bind(ws);
    ws.send = function (d) {
      const a = window.__audit; a.frames++;
      a.bytes += d.length || d.size || d.byteLength || 0;
      a.log.push(typeof d === 'string' ? d : '[binary ' + (d.byteLength || d.size) + 'b]');
      if (a.log.length > 600) a.log.splice(0, 100);
      return os(d);
    };
    return ws;
  }
  W.prototype = OW.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(k => (W[k] = OW[k]));
  window.WebSocket = W;
})();
