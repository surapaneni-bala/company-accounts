// Builds the installable app into docs/ (GitHub Pages serves that folder).
// Usage: node tools/build.js
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const out = path.join(root, 'docs');

const js = ['core.js', 'sync.js', 'import.js', 'main.js'].map(read).join('\n');
const html = read('shell.html').replace('<!--APP-->', () => `<script>\n${js}</script>`);
const version = crypto.createHash('sha256').update(html).digest('hex').slice(0, 10);

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'sw.js'), read('sw.js').replace('__VERSION__', version));
for (const f of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) fs.copyFileSync(path.join(root, 'src', f), path.join(out, f));
console.log(`built docs/ — index.html ${(html.length / 1024).toFixed(0)} KB, version ${version}`);
