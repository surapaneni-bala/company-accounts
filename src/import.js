/* ---------- import old entries (paste rows from a list or sheet) ---------- */
// One entry per line: Date | Currency | Amount | Paid to | Reason | Location | Project | Paid from | Entered by
// "Paid from" is Cash or Bank. Writing "Cash → Bank" (or "Bank → Cash") there makes the line a move
// between cash and bank instead of an expense. Columns may be separated by tabs or "|"; a header line is skipped.
const IMPORT_COLS = ['Date', 'Currency', 'Amount', 'Paid to', 'Reason', 'Location', 'Project', 'Paid from', 'Entered by'];
const IMPORT_TIME = '12:00'; // old lists have no time of day
const MAX_SHOWN_ERRORS = 8;
const MOVE_RE = /^(cash|bank)\s*(?:→|->|>|to)\s*(cash|bank)$/i;
const cap = w => w[0].toUpperCase() + w.slice(1).toLowerCase();

function parseDay(text) {
  const t = clean(text);
  let y, m, d, hit;
  if ((hit = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, y, m, d] = hit.map(Number);
  else if ((hit = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) { [, d, m, y] = hit.map(Number); if (y < 100) y += 2000; }
  else return null;
  const dt = new Date(y, m - 1, d); // rejects 31/02 and month 13
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}
function parseImport(text) {
  const rows = [], errors = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim().replace(/^\||\|$/g, '');
    if (!line.trim() || /^[\s|:-]+$/.test(line)) return; // blank or a "|---|" divider
    const cells = (line.includes('\t') ? line.split('\t') : line.split('|')).map(clean);
    if (/^date$/i.test(cells[0])) return; // header
    const [date, cur = '', amount = '', paidTo = '', reason = '', location = '', project = '', mode = '', by = ''] = cells;
    const day = parseDay(date);
    const c = /^(usd|\$|us\$)$/i.test(cur) ? 'USD' : /^ssp$/i.test(cur) ? 'SSP' : null;
    const a = parseAmount(amount);
    const move = mode.match(MOVE_RE);
    const isMove = !!move && move[1].toLowerCase() !== move[2].toLowerCase();
    const problem = !day ? `date "${date}" not understood (use day/month/year)`
      : !c ? `currency "${cur}" must be USD or SSP`
      : a === null ? `amount "${amount}" not understood`
      : isMove ? ''
      : !paidTo ? '"Paid to" is empty' : !reason ? '"Reason" is empty' : '';
    if (problem) { errors.push(`Line ${i + 1}: ${problem}`); return; }
    const at = `${day}T${IMPORT_TIME}`;
    if (isMove) rows.push({ kind: 'T', at, cur: c, amount: a, from: cap(move[1]), to: cap(move[2]), note: reason || paidTo, by });
    else rows.push({ kind: 'E', at, cur: c, amount: a, paidTo, reason, location, project, mode: accountOf(mode), by });
  });
  return { rows, errors };
}
// the same day, money and reason (or direction) already in the app = already imported; skip it
const importKey = x => (x.kind === 'T'
  ? ['T', x.at.slice(0, 10), x.cur, cents(x.amount), x.from]
  : ['E', x.at.slice(0, 10), x.cur, cents(x.amount), clean(x.reason).toLowerCase()]).join('|');
function importPlan(text) {
  const { rows, errors } = parseImport(text);
  const have = new Set([...live(S.expenses).map(e => importKey({ ...e, kind: 'E' })), ...live(S.transfers).map(t => importKey({ ...t, kind: 'T' }))]);
  const fresh = rows.filter(r => !have.has(importKey(r)));
  return { fresh, errors, skipped: rows.length - fresh.length };
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function importSheet() {
  if (!await unlock('Enter the password to import old entries (they have old dates).')) return;
  openSheet(`${head('Import old entries', 'out')}
    <p class="hint">Paste your old entries — one per line, in this column order:</p>
    <p class="note cols">${IMPORT_COLS.map(esc).join(' | ')}<br><span style="font-weight:600">Paid from: <b>Cash</b> or <b>Bank</b>. For money moved between them write <b>Cash → Bank</b> or <b>Bank → Cash</b>.</span></p>
    <form data-form="import">
      <label class="fld"><span>Paste here</span><textarea name="rows" rows="8" autocomplete="off" spellcheck="false" placeholder="01/09/2026 | USD | 250 | Shop name | Office supplies | | | Cash | Your name" autofocus></textarea></label>
      <div id="importPreview"></div>
      <p class="err"></p>
      <button class="btn out" id="importBtn" disabled>Import</button>
    </form>`);
}
function previewImport(f) {
  const { fresh, errors, skipped } = importPlan(f.elements.rows.value);
  const E = fresh.filter(r => r.kind === 'E'), T = fresh.filter(r => r.kind === 'T');
  const days = fresh.map(r => r.at.slice(0, 10)).sort();
  const btn = $('#importBtn');
  btn.disabled = !fresh.length || errors.length > 0;
  btn.textContent = fresh.length ? `Import ${fresh.length} ${fresh.length === 1 ? 'entry' : 'entries'}` : 'Import';
  $('#importPreview').innerHTML = (fresh.length ? `<p class="ok-line">✅ <b>${fresh.length} ready</b> · ${fmtDate(days[0])} to ${fmtDate(days[days.length - 1])}</p>
      <p class="ok-line">${E.length ? `${plural(E.length, 'expense')}: ${esc(sumText(E))}` : ''}${E.length && T.length ? ' · ' : ''}${T.length ? `${plural(T.length, 'cash/bank move')}: ${esc(sumText(T))}` : ''}</p>` : '')
    + (skipped ? `<p class="muted">${skipped} already in the app — they will be skipped.</p>` : '')
    + (errors.length ? `<div class="err-list"><b>Fix these lines first:</b><ul>${errors.slice(0, MAX_SHOWN_ERRORS).map(e => `<li>${esc(e)}</li>`).join('')}</ul>${errors.length > MAX_SHOWN_ERRORS ? `<p>…and ${errors.length - MAX_SHOWN_ERRORS} more.</p>` : ''}</div>` : '');
}
function doImport(f) {
  const { fresh, errors } = importPlan(f.elements.rows.value);
  if (errors.length) return formErr(f, null, 'Fix the lines listed above first.');
  if (!fresh.length) return formErr(f, null, 'Nothing new to import.');
  const E = fresh.filter(r => r.kind === 'E'), T = fresh.filter(r => r.kind === 'T');
  const who = S.lastBy || fresh[0].by || 'Import';
  let seq = S.seq, projects = S.projects, batch, eIds, tIds;
  [[batch], seq] = nextIds('B', 1, seq);
  [eIds, seq] = nextIds('E', E.length, seq);
  [tIds, seq] = nextIds('T', T.length, seq);
  const projectId = name => {
    if (!name) return '';
    const hit = projects.find(p => !p.deleted && p.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    let id;
    [[id], seq] = nextIds('P', 1, seq);
    projects = [...projects, { id, name, value: 0, valueCur: 'USD', by: who, createdAt: stampSec() }];
    return id;
  };
  const recs = E.map((r, i) => ({ id: eIds[i], cur: r.cur, amount: r.amount, paidTo: r.paidTo, reason: r.reason, location: r.location, project: projectId(r.project), mode: r.mode, at: r.at, manualDate: true, by: r.by || who, createdAt: stampSec(), batch }));
  const moves = T.map((r, i) => ({ id: tIds[i], cur: r.cur, amount: r.amount, from: r.from, to: r.to, note: r.note, at: r.at, manualDate: true, by: r.by || who, createdAt: stampSec() }));
  const days = fresh.map(r => r.at.slice(0, 10)).sort();
  const what = [recs.length && `${plural(recs.length, 'old expense')} (${sumText(recs)})`, moves.length && `${plural(moves.length, 'cash/bank move')} (${sumText(moves)})`].filter(Boolean).join(' and ');
  update({
    expenses: [...S.expenses, ...recs], transfers: [...S.transfers, ...moves], projects, seq,
    log: logWith([['Imported', recs.length ? batch : moves[0].id, `${what} imported, dated ${fmtDate(days[0])} to ${fmtDate(days[days.length - 1])}`]], who),
  });
  closeSheet(); render();
  toast(`Imported ✓ ${fresh.length} entries`);
}

/* ---------- repairs ---------- */
const moveKey = x => [x.at.slice(0, 10), x.cur, cents(x.amount), x.from].join('|');
// The importer before cash/bank moves saved "Cash → Bank" lines as expenses. Turn each into the move
// it was meant to be. Ids are made from the expense id, so every device repairs to the same records.
function repairImportedMoves() {
  if (!S || !can('delete')) return 0; // the repair deletes expenses, so only admins (or phones without logins) run it
  const bad = live(S.expenses).map(e => ({ e, m: clean(e.mode).match(MOVE_RE) }))
    .filter(({ m }) => m && m[1].toLowerCase() !== m[2].toLowerCase());
  if (!bad.length) return 0;
  const have = new Set(live(S.transfers).map(moveKey));
  const moves = [];
  bad.forEach(({ e, m }) => {
    const mv = { id: `${e.id}-MOVE`, cur: e.cur, amount: e.amount, from: cap(m[1]), to: cap(m[2]), note: e.reason, at: e.at, manualDate: !!e.manualDate, by: e.by, createdAt: e.createdAt };
    if (!have.has(moveKey(mv))) { have.add(moveKey(mv)); moves.push(mv); } // already imported properly: just drop the expense
  });
  const badIds = new Set(bad.map(({ e }) => e.id));
  update({
    expenses: S.expenses.map(e => (badIds.has(e.id) ? { ...e, deleted: stampSec(), deletedBy: 'App repair' } : e)),
    transfers: [...S.transfers, ...moves],
    log: [...S.log, ...bad.map(({ e }) => ({ lid: `L-repair-${e.id}`, at: stampSec(), action: 'Repaired', id: e.id, by: 'App',
      text: `${money(e.amount, e.cur)} on ${fmtDate(e.at.slice(0, 10))} was imported as an expense by mistake. It is a ${clean(e.mode)} move, so it is now recorded as a move and no longer counted as spending.` }))],
  });
  return bad.length;
}
// An expense with the same day, currency and amount as a cash/bank move, that talks about a deposit
// or the bank, is probably the same money counted twice.
function lookalikeExpenses() {
  const moves = new Set(live(S.transfers).map(t => [t.at.slice(0, 10), t.cur, cents(t.amount)].join('|')));
  return live(S.expenses).filter(e => moves.has([e.at.slice(0, 10), e.cur, cents(e.amount)].join('|')) && /deposit|bank|withdraw|transfer/i.test(`${e.reason} ${e.paidTo}`));
}
function lookalikeBanner() {
  const e = can('delete') && lookalikeExpenses()[0];
  if (!e) return '';
  return `<div class="banner"><span>⚠️ The ${money(e.amount, e.cur)} expense on ${fmtDate(e.at.slice(0, 10))} (“${esc(e.reason)}”) looks like the same money as a cash ↔ bank move. If it is the deposit, delete this expense so it isn't counted as spending.</span><button class="btn small" data-act="open" data-kind="E" data-id="${esc(e.id)}">Show it</button></div>`;
}
