import { build } from 'esbuild'; import fs from 'fs';
const r = await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020', define: { global: 'window' } });
const js = r.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const html = fs.readFileSync('src/index.html', 'utf8').replace('/*AUDIT*/', () => fs.readFileSync('src/audit.js', 'utf8')).replace('/*BUNDLE*/', () => js);
fs.writeFileSync('dist/index.html', html); console.log('size', html.length);
