// Serves a folder the way GitHub Pages does: every file may be kept by the browser for 10 minutes
// (Cache-Control: max-age=600). Use it to test that app updates still arrive.
// Usage: node tools/pages-like-server.js <folder> <port>
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const [dir, port] = process.argv.slice(2);
const ROOT = path.resolve(dir);
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
  res.end(fs.readFileSync(file));
}).listen(Number(port), '127.0.0.1', () => console.log(`serving ${dir} like GitHub Pages on http://127.0.0.1:${port}/`));
