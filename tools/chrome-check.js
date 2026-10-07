// Runs a JavaScript expression in a page of a real (headless) Chrome — for checks the Claude Code
// browser pane cannot do, because it blocks service workers (offline copy, app updates).
//
// 1. Start Chrome:  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
//                   --remote-debugging-port=9333 --user-data-dir=/tmp/chrome-test about:blank &
// 2. Run:           node tools/chrome-check.js <url> <file-with-expression.js> [--reload] [--offline]
//    --reload   reload the page first (like reopening the app)
//    --offline  cut the network before reloading (tests the offline copy)
// The expression may return a promise; its value is printed as JSON.
'use strict';
const fs = require('fs');
const [url, exprFile, ...flags] = process.argv.slice(2);
if (!url || !exprFile) { console.error('usage: node tools/chrome-check.js <url> <expr.js> [--reload] [--offline]'); process.exit(2); }
const expr = fs.readFileSync(exprFile, 'utf8');
const WAIT_MS = 3000; // let the page load and the service worker settle
(async () => {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  let page = list.find(x => x.type === 'page' && x.url.startsWith(url));
  if (!page) page = await (await fetch(`http://127.0.0.1:9333/json/new?${url}`, { method: 'PUT' })).json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const waiting = {};
  const call = (method, params = {}) => new Promise(res => { waiting[++id] = res; ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && waiting[d.id]) waiting[d.id](d); };
  await new Promise(r => (ws.onopen = r));
  await call('Network.enable');
  if (flags.includes('--offline')) await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  if (flags.includes('--reload') || flags.includes('--offline')) await call('Page.reload');
  await new Promise(r => setTimeout(r, WAIT_MS));
  const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result.result ? r.result.result.value : r.result));
  ws.close();
})().catch(e => { console.error('chrome-check failed:', e.message, '(is Chrome running with --remote-debugging-port=9333?)'); process.exit(1); });
