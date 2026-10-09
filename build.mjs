import { build } from 'esbuild'; import fs from 'fs';
// The app is the call + chat tool (src/call.js). The earlier coding/AI version is parked in src/main.js, src/index.html and friends, and is not built.
const r = await build({ entryPoints: ['src/call.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020', define: { global: 'window' } });
const js = r.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const html = fs.readFileSync('src/call.html', 'utf8').replace('/*AUDIT*/', () => fs.readFileSync('src/audit.js', 'utf8')).replace('/*BUNDLE*/', () => js);
fs.mkdirSync('dist', { recursive: true }); fs.writeFileSync('dist/index.html', html); console.log('size', html.length);
