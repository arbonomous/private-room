// Optional cloud AI through OpenRouter. The key lives only in this browser tab (and localStorage if the user ticks Remember).
// It is sent only to openrouter.ai, never to the room, the shared document, other people, or the preview.
export const MODELS = [
  ['poolside/laguna-s-2.1:free', 'Laguna S 2.1 (coding model, free)'],
  ['cohere/north-mini-code:free', 'North Mini Code (coding, free)'],
  ['nvidia/nemotron-3-super-120b-a12b:free', 'Nemotron 3 Super 120B (free)'],
  ['google/gemma-4-31b-it:free', 'Gemma 4 31B (free)'],
  ['openrouter/free', 'Any free model (random)'],
];
const DAILY = 50;
const dayKey = () => new Date().toISOString().slice(0, 10);
export function usage() {
  try { const o = JSON.parse(localStorage.getItem('pr_or_count') || '{}'); return o.day === dayKey() ? o.n : 0; } catch (e) { return 0; }
}
function bump() { try { localStorage.setItem('pr_or_count', JSON.stringify({ day: dayKey(), n: usage() + 1 })); } catch (e) { /* ignore */ } }
export const limit = DAILY;
export function makeCloud(getKey, getModel, onUsage) {
  let ctrl = null;
  return {
    async ask(messages, onText) {
      const key = getKey();
      if (!key) throw new Error('Paste your OpenRouter key first.');
      if (usage() >= DAILY) throw new Error('You have used about ' + DAILY + ' free cloud requests today (OpenRouter free limit). Use the local AI for now, it resets tomorrow (UTC).');
      const first = getModel();
      const chain = [first].concat(MODELS.map((m) => m[0]).filter((m) => m !== first));
      let lastErr = '';
      for (const model of chain.slice(0, 3)) {
        if (usage() >= DAILY) break;
        ctrl = new AbortController(); bump(); onUsage();
        let res;
        try {
          res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST', signal: ctrl.signal,
            headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'arbonomous private room' },
            body: JSON.stringify({ model, messages, stream: true, temperature: 0.3, max_tokens: 6000 }),
          });
        } catch (e) { if (e.name === 'AbortError') return ''; throw new Error('Could not reach OpenRouter: ' + (e.message || e)); }
        if (res.status === 401 || res.status === 403) throw new Error('OpenRouter rejected the key (' + res.status + '). Check that you pasted the whole key and that it is not disabled.');
        if (res.status === 402) throw new Error('OpenRouter says this needs credits (402). Pick a model that ends in :free.');
        if (res.status === 429) throw new Error('Rate limit reached (429). The free models allow about ' + DAILY + ' requests a day and a few per minute. Wait a minute, or use the local AI.');
        if (!res.ok) { lastErr = 'HTTP ' + res.status + ' from ' + model; continue; }
        let out = '', buf = '';
        const rd = res.body.getReader(), dec = new TextDecoder();
        try {
          for (;;) {
            const { done, value } = await rd.read(); if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
              if (!line.startsWith('data:')) continue;
              const d = line.slice(5).trim(); if (d === '[DONE]') continue;
              try { const j = JSON.parse(d); if (j.error) { lastErr = (j.error.message || 'error') + ' (' + model + ')'; continue; } const t = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content; if (t) { out += t; onText(out); } } catch (e) { /* partial line */ }
            }
          }
        } catch (e) { if (e.name === 'AbortError') return out; lastErr = String(e.message || e); }
        if (out.trim()) return out;
        lastErr = lastErr || 'empty answer from ' + model;
      }
      throw new Error('The cloud AI did not answer: ' + lastErr);
    },
    stop() { if (ctrl) ctrl.abort(); },
  };
}
