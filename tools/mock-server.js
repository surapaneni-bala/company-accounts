// Local stand-in for the deployed Google web app: runs the real apps-script/Code.gs on fake
// Google services so the app can be tested without a Google account.
// Usage: node tools/mock-server.js   (prints the company code; state kept in tools/.mock-state.json)
//   NODRIVE=1  like a sheet that may not use Google Drive (allowFiles never run): uploads fail, sync works
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadGas } = require('./fake-gas');

const PORT = Number(process.env.PORT || 8770);
const STATE = path.join(__dirname, '.mock-state.json');
const code = fs.readFileSync(process.env.CODE || path.join(__dirname, '../apps-script/Code.gs'), 'utf8'); // CODE=… tries another script version
const gas = loadGas(code, fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {}, { noDrive: !!process.env.NODRIVE });
if (!gas.props.KEY) gas.setup();

http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    let reply;
    try { reply = req.method === 'POST' ? gas.doPost({ postData: { contents: body } }) : gas.doGet(); }
    catch (e) { // like Google: a script error comes back as an HTML page without CORS headers, which the browser cannot read
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<html><body>Error: ${e.message}</body></html>`);
    }
    fs.writeFileSync(STATE, JSON.stringify(gas.dump()));
    // BLOCK=1 acts like a web app whose access is not "Anyone": the browser gets no usable answer
    res.writeHead(200, { 'Content-Type': 'application/json', ...(process.env.BLOCK ? {} : { 'Access-Control-Allow-Origin': '*' }) });
    res.end(reply.getContent());
  });
}).listen(PORT, '127.0.0.1', () => console.log(`mock Google web app on http://127.0.0.1:${PORT}/exec — company code ${gas.props.KEY}`));
