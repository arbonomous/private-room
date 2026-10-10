import { chromium } from 'playwright'; import fs from 'fs';
const svg = fs.readFileSync('brand/icon.svg', 'utf8'); const b = await chromium.launch();
for (const n of [192, 512]) { const p = await b.newPage({ viewport: { width: n, height: n } }); await p.setContent(`<body style="margin:0;background:#131A17"><div style="width:${n}px;height:${n}px">${svg.replace('<svg ', `<svg width="${n}" height="${n}" `)}</div></body>`); await p.screenshot({ path: `public/icon-${n}.png` }); }
await b.close();
