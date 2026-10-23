// Opens every screen of the built app in a real (headless) Chrome at phone widths and reports what would spoil it on a
// phone: anything wider than the screen (the page then pans sideways or looks zoomed out), any text box whose text is
// under 16px (an iPhone zooms in when it is tapped, and stays zoomed), and titles or buttons cut off or overlapping.
// Owner, 23 Oct 2026: "some pages are already zoomed", "the titles are misplaced".
//
// 1. Start Chrome:  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
//                   --remote-debugging-port=9333 --user-data-dir=/tmp/chrome-layout about:blank &
// 2. Serve the app: node tools/pages-like-server.js docs 8795 &
// 3. Run:           node tools/layout-check.js http://127.0.0.1:8795/ [--shots DIR]
//    --shots DIR    also saves a picture of every screen at every width (DIR/<width>-<nn>-<screen>.png)
// Exits 1 when something is found; prints each screen, width and element.
'use strict';
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2), url = args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8795/';
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : '';
const WIDTHS = [300, 320, 360, 375, 412]; // 300: a 360px phone with large text (Android font size, also in the APK)

// runs in the page: sample records for every screen; window.__show(i) opens screen i
const SETUP = () => {
  unlock = async () => true; confirm = () => true;
  const at = '2026-10-20T09:00', by = 'Bala', long = 'A very long name that keeps going without any break to see what happens';
  const E = (id, extra = {}) => ({ id, cur: 'USD', amount: 1250.5, paidTo: 'Sample Hardware Supplies Limited', reason: 'Cement 42.5, fifty bags for the slab of the second floor', location: 'Juba', project: 'P-1', mode: 'Cash', at, by, createdAt: at + ':00', ...extra });
  S = { v: 2, pass: null, ...noRecords(), kindsSeen: KINDS_SEEN, dev: 'TST', dirty: [], base: {}, settingsU: 1, createdAt: at + ':00', lastBackup: null, link: null, company: 'Brookfield Enterprises Limited', seq: {}, lastBy: by, lastRate: 4500,
    projects: [{ id: 'P-1', name: 'G+2 Villa project near Fire Tree', value: 250000, valueCur: 'USD', buyBudget: 50000 }],
    expenses: [E('E-1'), E('E-2', { cur: 'SSP', amount: 18694000, rate: 4500 }), E('E-3', { reason: 'Exchange USD to SSP', paidTo: 'Not recorded' }), E('E-4', { by: 'Babu', reason: 'Cement 42.5', paidTo: 'Sample Hardware' }), E('E-6', { reason: 'Transfer ref TRX20261020000123456789000111', paidTo: 'SupercalifragilisticexpialidociousBuildingMaterialsLimited' }), E('E-5', { advance: true, advanceTotal: 2000 })],
    credits: [{ id: 'R-1', cur: 'USD', amount: 100000, project: 'P-1', mode: 'Bank', at, by, createdAt: at + ':00' }],
    workers: [{ id: 'W-1', name: 'Henry Carpenter', job: 'Carpenter', wage: 250, cur: 'USD', start: '2026-08-22', status: 'active' }, { id: 'W-2', name: 'Nabakooza Agnes Mary Long-Surname', job: 'Office manager and site accounts', wage: 400, cur: 'USD', start: '2026-07-01', status: 'active' }],
    regulars: [{ id: 'G-1', name: 'Internet', paidTo: 'Smart Network', cur: 'USD', amount: 100, every: 1, first: '2026-09-24', mode: 'Cash', project: '' }],
    banks: [{ id: 'B-1', bank: 'Sample Bank', accName: 'Brookfield Enterprises Ltd', number: '2000000000001', cur: 'SSP', branch: 'Main Branch, Juba, South Sudan' }, { id: 'B-2', bank: 'Sample Bank', accName: 'Brookfield Enterprises Ltd', number: '2000000000002', cur: 'USD', branch: 'Main Branch, Juba, South Sudan' }],
    docs: [{ id: 'V-1', title: 'Trading licence', kind: 'company', owner: 'Brookfield', expires: '2026-11-01' }],
    clients: [{ id: 'K-1', name: 'Sample Client Ltd', phone: '+211 000 000 000' }],
    invoices: [{ id: 'I-1', type: 'invoice', no: 'INV-0001', client: 'K-1', date: '2026-10-11', due: '2026-10-25', cur: 'USD', items: [{ t: 'Cement', qty: 20, unit: 'bags', price: 15 }], tax: 0 }],
    suppliers: [{ id: 'U-1', name: 'Factory One — sofas and beds', kind: 'factory', city: 'Foshan', country: 'China', phone: '+86 000 0000 0000', wechat: 'sample-wechat-id', market: 'Lecong furniture market, hall 3, shop 12' }],
    trips: [{ id: 'J-1', to: 'Guangzhou & Foshan', country: 'China', who: ['Bala', 'Babu'], out: '2026-10-20', back: '2026-10-27', purpose: 'Furniture, lights and tiles for the villa', budget: 20000 }],
    exchanges: [{ id: 'X-1', at, usd: 1000, ssp: 4500000, from: 'Cash', to: 'Cash', with: 'Forex bureau' }],
    needs: [{ id: 'N-1', t: 'Sofa, L-shape', cat: 'Furniture & décor', status: 'ordered', qty: 3, unit: 'pcs', project: 'P-1', area: 'Living room', where: 'China', pri: 1, tags: ['villa'], trip: 'J-1',
      specs: [['Colour', 'Beige'], ['Size (L × W × H)', '3.2 m × 1.8 m × 0.85 m'], ['Seating arrangement', long]], notes: long, quotes: [{ id: 'q1', sup: 'U-1', price: 6800, cur: 'CNY', moq: '1 set', lead: '20 days', at: '2026-10-21' }],
      order: { sup: 'U-1', price: 6800, cur: 'CNY', rate: 7.1, qty: 3, date: '2026-10-21', alloc: [{ p: 'P-1', q: 2 }] }, steps: { tobuy: '2026-10-19', ordered: '2026-10-21' } },
      { id: 'N-2', t: long, cat: 'Doors & windows', status: 'tobuy', qty: 40, unit: 'm²', under: 'N-1', steps: { tobuy: '2026-10-19' } },
      { id: 'N-3', t: 'Ceiling fans', cat: 'Electronics & appliances', status: 'idea', steps: { idea: '2026-10-19' } }],
  };
  const main = t => () => { closeAll(); tab = t; render(); scrollTo(0, 0); };
  const screens = [
    ['menu', main('menu')], ['accounts', main('home')], ['history', main('hist')], ['projects', main('proj')], ['employees', main('staff')], ['sheet tab', main('sheet')],
    ['add expense', () => expenseForm()], ['expense', () => detail('E', 'E-1')], ['money received', () => creditForm()], ['settings', () => settingsForm()],
    ['regular payments', () => regularsSheet()], ['bank details', () => banksSheet()], ['bank form', () => bankForm()], ['documents', () => docsSheet()],
    ['invoices', () => salesSheet()], ['invoice form', () => invoiceForm('invoice')], ['advances', () => advancesSheet()], ['employee', () => workerDetail('W-2')], ['employee form', () => workerForm(workerOf('W-1'))], ['new employee', () => workerForm()], ['profile photo', () => profileSheet('W-1')],
    ['buying', () => { buyView = { view: 'open', project: '', q: '' }; buyingSheet(); }], ['buying bought', () => { buyView = { view: 'bought', project: '', q: '' }; buyingSheet(); }],
    ['item', () => needDetail('N-1')], ['item form', () => needForm(needOf('N-1'))], ['new item', () => needForm()], ['quote', () => quoteForm('N-1')], ['order', () => orderForm('N-2')],
    ['suppliers', () => suppliersSheet()], ['supplier', () => supplierDetail('U-1')], ['supplier form', () => supplierForm()], ['inspection', () => inspectSheet('U-1')],
    ['trips', () => tripsSheet()], ['trip', () => tripDetail('J-1')], ['trip form', () => tripForm(tripOf('J-1'))], ['link payments', () => linkTripCosts('J-1')],
    ['budgets', () => budgetsSheet()], ['paste list', () => pasteListSheet('one\ntwo')], ['SSP', () => sspSheet()], ['change form', () => exchangeForm()], ['change', () => exchangeDetail('X-1')],
    ['doubles', () => doublesSheet()],
    ['pay salary', () => payForm('W-1', 'salary')], ['pay advance', () => payForm('W-1', 'advance')], ['days not worked', () => absenceForm('W-1')], ['has left', () => leftForm('W-1')],
    ['employee advance', () => empAdvanceSheet('W-1')], ['voucher', () => slipSheet('E', 'E-1')], ['take from advance', () => takeForm('E-5')], ['move money', () => moveForm()], ['bulk', () => bulkForm()],
    ['project', () => projectDetail('P-1')], ['project form', () => projectForm()], ['assign', () => assignSheet('P-1')], ['regular', () => regularDetail('G-1')], ['regular form', () => regularForm()],
    ['bank', () => bankDetail('B-1')], ['document', () => docDetail('V-1')], ['document form', () => docForm(null, 'company')], ['renew', () => renewForm('V-1')],
    ['clients', () => clientsSheet()], ['client', () => clientDetail('K-1')], ['client form', () => clientForm()], ['invoice', () => invoiceDetail('I-1')],
    ['ship', () => shipForm('N-1')], ['trip text', () => tripTextSheet('J-1')], ['account', () => { session = { user: { id: 'u1', name: 'Bala', role: 'admin', username: 'bala' } }; accountSheet(); }], ['alerts', () => alertsSheet()], ['approvals', () => approvalsSheet()],
    ['connect', () => connectForm()], ['import', () => importSheet()], ['invite', () => inviteSheet()], ['letterhead', () => letterheadSheet()], ['my signature', () => mySigSheet()], ['stamp', () => stampSheet()],
    ['sign in', () => signInSheet()], ['logins', () => setupLoginsSheet()], ['users', () => usersSheet()], ['user form', () => userForm()], ['sheet script', () => howUpdateSheet()],
  ];
  window.__show = i => { screens[i][1](); const d = document.querySelector('#sheet[open]'); if (d) d.scrollTop = 0; };
  return screens.map(s => s[0]);
};
// runs in the page after a screen opened: what does not fit
const CHECK = () => {
  const W = innerWidth, out = [], sheet = document.querySelector('#sheet[open]'), root = sheet || document.querySelector('main') || document.body;
  const name = el => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}${el.name ? `[name=${el.name}]` : ''}`;
  const text = el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const shown = el => el.getClientRects().length && !el.closest('[hidden]');
  // wider than the screen: the outermost such element only, skipping what scrolls sideways on purpose
  const wide = [...root.querySelectorAll('*')].filter(el => shown(el) && !el.closest('.subnav, .thumbs, .mini') && el.getBoundingClientRect().right > W + 0.5);
  wide.filter(el => !wide.includes(el.parentElement)).slice(0, 3).forEach(el => out.push(`${name(el)} is ${Math.round(el.getBoundingClientRect().right - W)}px wider than the screen ("${text(el)}")`));
  // text boxes an iPhone zooms into
  [...root.querySelectorAll('input, select, textarea')].filter(el => !['radio', 'checkbox', 'hidden', 'file', 'range'].includes(el.type) && shown(el) && parseFloat(getComputedStyle(el).fontSize) < 16)
    .forEach(el => out.push(`${name(el)} has ${getComputedStyle(el).fontSize} text (an iPhone zooms in when it is tapped)`));
  // titles and buttons whose text is cut off
  [...root.querySelectorAll('h1, h2, h3, button, summary')].filter(el => shown(el) && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible')
    .slice(0, 3).forEach(el => out.push(`${name(el)} cuts its text off ("${text(el)}")`));
  // the sheet's title row: the title must not run under the close button
  const h = sheet && sheet.querySelector('.sh-head'), x = h && h.querySelector('.close'), t = h && h.querySelector('h2');
  if (t && x && t.getBoundingClientRect().right > x.getBoundingClientRect().left + 0.5) out.push(`the title runs under the close button ("${text(t)}")`);
  return out;
};

(async () => {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const page = list.find(x => x.type === 'page') || await (await fetch(`http://127.0.0.1:9333/json/new?${url}`, { method: 'PUT' })).json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const waiting = {};
  const call = (method, params = {}) => new Promise(res => { waiting[++id] = res; ws.send(JSON.stringify({ id, method, params })); });
  const run = async expr => { const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && waiting[d.id]) waiting[d.id](d); };
  await new Promise(r => (ws.onopen = r));
  if (shots) fs.mkdirSync(shots, { recursive: true });
  let found = 0;
  for (const w of WIDTHS) {
    await call('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 2, mobile: true });
    await call('Page.navigate', { url });
    // wait for the app itself (after a new build the offline copy updates and reloads the page once)
    for (let t = 0; t < 40; t++) { await new Promise(r => setTimeout(r, 500)); if (t >= 4 && await run("typeof noRecords === 'function' && document.readyState === 'complete'")) break; }
    const names = await run(`(${SETUP})()`);
    if (!Array.isArray(names)) { console.log(`— ${w}px: could not set up the screens`); found++; continue; }
    const problems = [];
    for (let i = 0; i < names.length; i++) {
      const opened = await run(`(() => { try { __show(${i}); return 'ok'; } catch (e) { return e.message; } })()`);
      await new Promise(r => setTimeout(r, 150));
      if (opened !== 'ok') { problems.push(`${names[i]}: could not open (${opened})`); continue; }
      (await run(`(${CHECK})()`) || []).forEach(p => problems.push(`${names[i]}: ${p}`));
      if (shots) {
        const shot = await call('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(shots, `${w}-${String(i).padStart(2, '0')}-${names[i].replace(/\W+/g, '-')}.png`), Buffer.from(shot.result.data, 'base64'));
      }
    }
    const wider = await run('document.documentElement.scrollWidth - innerWidth');
    if (wider > 0) problems.push(`page: ${wider}px wider than the screen`);
    console.log(`— ${w}px: ${problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'}` : 'all screens fit'}`);
    problems.forEach(p => console.log('   ' + p));
    found += problems.length;
  }
  ws.close();
  process.exit(found ? 1 : 0);
})().catch(e => { console.error('layout-check failed:', e.message, '(is Chrome running with --remote-debugging-port=9333?)'); process.exit(2); });
