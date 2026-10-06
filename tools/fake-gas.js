// Just enough of Google Apps Script to run apps-script/Code.gs in Node (tests + local mock server).
// Values are modelled; formatting calls (fonts, colours, borders…) are accepted and ignored.
'use strict';
const vm = require('vm');
const crypto = require('crypto');

// Unknown methods are no-ops that return the object itself, so chained calls keep working.
function chainable(target) {
  const p = new Proxy(target, { get: (t, k) => (k in t ? t[k] : () => p) });
  return p;
}
function makeRange(sh, r, c, nr, nc) {
  // the real service rejects empty ranges and mismatched sizes; so do we
  if (nr < 1 || nc < 1) throw new Error(`The number of rows/columns in the range must be at least 1 (got ${nr}x${nc})`);
  const rg = {};
  const p = chainable(rg);
  const size = (vals, what) => {
    if (vals.length !== nr || vals.some(row => row.length !== nc)) throw new Error(`${what}: range is ${nr}x${nc}, data is ${vals.length}x${vals[0] && vals[0].length}`);
  };
  rg.getValues = () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
    const v = (sh.grid[r - 1 + i] || [])[c - 1 + j];
    return v == null ? '' : v;
  }));
  rg.getValue = () => rg.getValues()[0][0];
  rg.setValues = vals => {
    size(vals, 'setValues');
    vals.forEach((row, i) => {
      const g = (sh.grid[r - 1 + i] = sh.grid[r - 1 + i] || []);
      row.forEach((v, j) => { g[c - 1 + j] = v; });
    });
    return p;
  };
  rg.setValue = v => rg.setValues([[v]]);
  rg.setBackgrounds = vals => { size(vals, 'setBackgrounds'); return p; };
  rg.createFilter = () => {
    if (sh.filter) throw new Error('You cannot create a filter in a sheet that already has a filter.');
    sh.filter = { remove: () => { sh.filter = null; } };
    return sh.filter;
  };
  return p;
}
function makeSheet(name, grid = [], hidden = false) {
  const sh = { name, grid, hidden, filter: null };
  const p = chainable(sh);
  sh.getName = () => sh.name;
  sh.getLastRow = () => {
    for (let r = sh.grid.length; r > 0; r--) if ((sh.grid[r - 1] || []).some(v => v !== '' && v != null)) return r;
    return 0;
  };
  sh.clear = () => { sh.grid.length = 0; return p; };
  sh.hideSheet = () => { sh.hidden = true; return p; };
  sh.getFilter = () => sh.filter;
  sh.getRange = (r, c, nr = 1, nc = 1) => makeRange(sh, r, c, nr, nc);
  return p;
}
function makeSpreadsheet(state) {
  const ss = { sheets: (state.sheets || []).map(s => makeSheet(s.name, s.grid, s.hidden)) };
  ss.getSheetByName = n => ss.sheets.find(s => s.getName() === n) || null;
  ss.insertSheet = (n, i) => {
    if (ss.getSheetByName(n)) throw new Error(`A sheet with the name "${n}" already exists.`);
    const sh = makeSheet(n);
    if (i === undefined) ss.sheets.push(sh); else ss.sheets.splice(i, 0, sh);
    return sh;
  };
  ss.deleteSheet = sh => { ss.sheets = ss.sheets.filter(s => s !== sh); };
  ss.getSheets = () => ss.sheets;
  ss.setActiveSheet = sh => { ss.active = sh; return sh; };
  ss.moveActiveSheet = pos => { ss.sheets = ss.sheets.filter(s => s !== ss.active); ss.sheets.splice(pos - 1, 0, ss.active); };
  ss.getUrl = () => 'https://docs.google.com/spreadsheets/d/LOCAL-TEST/edit';
  return chainable(ss);
}

function loadGas(code, state = {}) {
  const props = { ...(state.props || {}) };
  const ss = makeSpreadsheet(state);
  const sandbox = {
    SpreadsheetApp: { getActive: () => ss, BorderStyle: { SOLID: 'SOLID', SOLID_MEDIUM: 'SOLID_MEDIUM' } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s }) },
    Utilities: { getUuid: () => crypto.randomUUID(), formatDate: d => d.toISOString().slice(0, 16).replace('T', ' ') },
    Session: { getScriptTimeZone: () => 'UTC' },
    Logger: { log: () => {} },
  };
  vm.createContext(sandbox);
  const api = vm.runInContext(`${code}\n;({ setup, doGet, doPost })`, sandbox);
  const dump = () => ({ props, sheets: ss.getSheets().map(s => ({ name: s.getName(), grid: s.grid, hidden: s.hidden })) });
  return { ...api, ss, props, dump };
}

module.exports = { loadGas };
