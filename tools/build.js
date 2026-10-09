// Builds the installable app into docs/ (GitHub Pages serves that folder).
// Usage: node tools/build.js          → docs/       the real app
//        node tools/build.js --test   → docs/test/  a practice copy: its own storage, offline copy and name,
//                                                    so it can sit next to the real app on the same phone
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEST = process.argv.includes('--test');
const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', ...(TEST ? ['test'] : []));
const TEST_SWAPS = {
  'core.js': [
    ["const KEY = 'company-accounts-v1';", "const KEY = 'bepl-test-v1';"],
    // a backup from the real app carries the real sheet's link and code: the test copy never reconnects to it
    ["const fresh = migrate({ ...data, seq: {}, dev: newDev(), dirty: [] });", "const fresh = migrate({ ...data, link: null, seq: {}, dev: newDev(), dirty: [] });"],
  ],
  'sync.js': [
    ["const APP_URL = 'https://app.b-e-p-l.com/';", "const APP_URL = 'https://app.b-e-p-l.com/test/';"],
    // the test copy's sheet script is published next to it, so it can't be mixed up with the real one
    ["const SCRIPT_URL = 'https://app.b-e-p-l.com/sheet-script.txt';", "const SCRIPT_URL = 'https://app.b-e-p-l.com/test/sheet-script.txt';"],
  ],
  'update.js': [["const CACHE_PREFIX = 'accounts-';", "const CACHE_PREFIX = 'test-accounts-';"]],
  'sw.js': [["const PREFIX = 'accounts-';", "const PREFIX = 'test-accounts-';"]],
  'manifest.webmanifest': [['"name": "Company Accounts"', '"name": "TEST Accounts"'], ['"short_name": "Accounts"', '"short_name": "TEST"']],
  'shell.html': [
    ['<title>Company Accounts</title>', '<title>TEST Accounts</title>'],
    ['<meta name="apple-mobile-web-app-title" content="Accounts">', '<meta name="apple-mobile-web-app-title" content="TEST">'],
    ['<body>', '<body>\n<div style="position:sticky;top:0;z-index:20;background:#7A1FA2;color:#fff;font-weight:800;text-align:center;padding:8px 12px;font-size:14px">🧪 TEST COPY — practice here. Your real records are not touched.</div>'],
  ],
};
// every swap must hit exactly where expected, or the test copy could end up sharing the real app's storage
function read(f) {
  let text = fs.readFileSync(path.join(root, 'src', f), 'utf8');
  for (const [from, to] of TEST ? TEST_SWAPS[f] || [] : []) {
    if (text.split(from).length !== 2) throw new Error(`build --test: expected exactly one "${from}" in src/${f}`);
    text = text.replace(from, () => to);
  }
  return text;
}

// the app tells admins when their sheet runs an older script: its idea of the newest must match apps-script/Code.gs
const scriptV = fs.readFileSync(path.join(root, 'apps-script', 'Code.gs'), 'utf8').match(/^const VERSION = (\d+);/m)[1];
const appV = fs.readFileSync(path.join(root, 'src', 'sync.js'), 'utf8').match(/^const NEWEST_SCRIPT = (\d+);/m)[1];
if (scriptV !== appV) throw new Error(`Code.gs is version ${scriptV} but src/sync.js NEWEST_SCRIPT is ${appV}`);

const js = ['core.js', 'calc.js', 'files.js', 'sync.js', 'auth.js', 'staff.js', 'import.js', 'update.js', 'main.js'].map(read).join('\n');
const page = read('shell.html').replace('<!--APP-->', () => `<script>\n${js}</script>`);
const version = crypto.createHash('sha256').update(page).digest('hex').slice(0, 10);
const html = page.replace('__VERSION__', version);

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'sw.js'), read('sw.js').replace('__VERSION__', version));
// docs/CNAME = the company's own address; once it exists, version.json tells phones on the old address to move
const cname = path.join(root, 'docs', 'CNAME');
const home = fs.existsSync(cname) ? `https://${fs.readFileSync(cname, 'utf8').trim()}/${TEST ? 'test/' : ''}` : '';
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify(home ? { version, home } : { version }) + '\n'); // the app asks for this to spot updates
fs.writeFileSync(path.join(out, 'manifest.webmanifest'), read('manifest.webmanifest'));
for (const f of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'logo-wide.png']) fs.copyFileSync(path.join(root, 'src', f), path.join(out, f));
fs.copyFileSync(path.join(root, 'apps-script', 'Code.gs'), path.join(out, 'sheet-script.txt')); // .txt so browsers show it, ready to copy
console.log(`built ${path.relative(root, out)}/ — index.html ${(html.length / 1024).toFixed(0)} KB, version ${version}${TEST ? ' (TEST COPY)' : ''}`);
