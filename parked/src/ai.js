import { CreateMLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';
let engine = null, loaded = '';
export async function gpuInfo() {
  if (!navigator.gpu) return { ok: false, why: 'This browser has no WebGPU. Use a recent Chrome or Edge on a computer.' };
  try {
    const a = await navigator.gpu.requestAdapter();
    if (!a) return { ok: false, why: 'No usable GPU found by the browser.' };
    return { ok: true, f16: a.features.has('shader-f16') };
  } catch (e) { return { ok: false, why: 'WebGPU failed: ' + e.message }; }
}
export const hasModel = (id) => prebuiltAppConfig.model_list.some((m) => m.model_id === id);
export async function loadModel(id, onProgress) {
  if (engine && loaded === id) return;
  if (engine) { await engine.unload(); engine = null; }
  engine = await CreateMLCEngine(id, { initProgressCallback: (r) => onProgress(r.text, r.progress) });
  loaded = id;
}
export async function ask(messages, onText) {
  let out = '';
  const it = await engine.chat.completions.create({ messages, stream: true, temperature: 0.3, max_tokens: window.__aiMax || 1800 });
  for await (const ch of it) { out += (ch.choices[0] && ch.choices[0].delta.content) || ''; onText(out); }
  return out;
}
export const stop = () => engine && engine.interruptGenerate();
