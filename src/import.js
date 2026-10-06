/* ---------- import old expenses (paste rows from a list or sheet) ---------- */
// One expense per line: Date | Currency | Amount | Paid to | Reason | Location | Project | Paid by | Entered by
// Columns may be separated by tabs (copied from a spreadsheet) or by "|". A header line is skipped.
const IMPORT_COLS = ['Date', 'Currency', 'Amount', 'Paid to', 'Reason', 'Location', 'Project', 'Paid by', 'Entered by'];
const IMPORT_TIME = '12:00'; // old lists have no time of day
const MAX_SHOWN_ERRORS = 8;

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
    const problem = !day ? `date "${date}" not understood (use day/month/year)`
      : !c ? `currency "${cur}" must be USD or SSP`
      : a === null ? `amount "${amount}" not understood`
      : !paidTo ? '"Paid to" is empty' : !reason ? '"Reason" is empty' : '';
    if (problem) { errors.push(`Line ${i + 1}: ${problem}`); return; }
    rows.push({ at: `${day}T${IMPORT_TIME}`, cur: c, amount: a, paidTo, reason, location, project, mode: MODES.find(x => x.toLowerCase() === mode.toLowerCase()) || mode || 'Cash', by });
  });
  return { rows, errors };
}
// the same day, money and reason already in the app = already imported; skip it
const importKey = x => [x.at.slice(0, 10), x.cur, cents(x.amount), clean(x.reason).toLowerCase()].join('|');
function importPlan(text) {
  const { rows, errors } = parseImport(text);
  const have = new Set(live(S.expenses).map(importKey));
  const fresh = rows.filter(r => !have.has(importKey(r)));
  return { fresh, errors, skipped: rows.length - fresh.length };
}

async function importSheet() {
  if (!await unlock('Enter the password to import old expenses (they have old dates).')) return;
  openSheet(`${head('Import old expenses', 'out')}
    <p class="hint">Paste your old expenses — one per line, in this column order:</p>
    <p class="note cols">${IMPORT_COLS.map(esc).join(' | ')}</p>
    <form data-form="import">
      <label class="fld"><span>Paste here</span><textarea name="rows" rows="8" autocomplete="off" spellcheck="false" placeholder="01/09/2026 | USD | 250 | Shop name | Office supplies | | | Cash | Your name" autofocus></textarea></label>
      <div id="importPreview"></div>
      <p class="err"></p>
      <button class="btn out" id="importBtn" disabled>Import</button>
    </form>`);
}
function previewImport(f) {
  const { fresh, errors, skipped } = importPlan(f.elements.rows.value);
  const days = fresh.map(r => r.at.slice(0, 10)).sort();
  const btn = $('#importBtn');
  btn.disabled = !fresh.length || errors.length > 0;
  btn.textContent = fresh.length ? `Import ${fresh.length} expense${fresh.length === 1 ? '' : 's'}` : 'Import';
  $('#importPreview').innerHTML = (fresh.length ? `<p class="ok-line">✅ <b>${fresh.length} ready</b> · ${esc(sumText(fresh))} · ${fmtDate(days[0])} to ${fmtDate(days[days.length - 1])}</p>` : '')
    + (skipped ? `<p class="muted">${skipped} already in the app — they will be skipped.</p>` : '')
    + (errors.length ? `<div class="err-list"><b>Fix these lines first:</b><ul>${errors.slice(0, MAX_SHOWN_ERRORS).map(e => `<li>${esc(e)}</li>`).join('')}</ul>${errors.length > MAX_SHOWN_ERRORS ? `<p>…and ${errors.length - MAX_SHOWN_ERRORS} more.</p>` : ''}</div>` : '');
}
function doImport(f) {
  const { fresh, errors } = importPlan(f.elements.rows.value);
  if (errors.length) return formErr(f, null, 'Fix the lines listed above first.');
  if (!fresh.length) return formErr(f, null, 'Nothing new to import.');
  const who = S.lastBy || fresh[0].by || 'Import';
  let seq = S.seq, projects = S.projects, batch, ids;
  [[batch], seq] = nextIds('B', 1, seq);
  [ids, seq] = nextIds('E', fresh.length, seq);
  const projectId = name => {
    if (!name) return '';
    const hit = projects.find(p => !p.deleted && p.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    let id;
    [[id], seq] = nextIds('P', 1, seq);
    projects = [...projects, { id, name, value: 0, valueCur: 'USD', by: who, createdAt: stampSec() }];
    return id;
  };
  const recs = fresh.map((r, i) => ({ id: ids[i], cur: r.cur, amount: r.amount, paidTo: r.paidTo, reason: r.reason, location: r.location, project: projectId(r.project), mode: r.mode, at: r.at, manualDate: true, by: r.by || who, createdAt: stampSec(), batch }));
  const days = recs.map(r => r.at.slice(0, 10)).sort();
  update({
    expenses: [...S.expenses, ...recs], projects, seq,
    log: logWith([['Imported', batch, `${recs.length} old expenses imported (${fmtDate(days[0])} to ${fmtDate(days[days.length - 1])}), total ${sumText(recs)}`]], who),
  });
  closeSheet(); render();
  toast(`Imported ✓ ${recs.length} expenses · ${sumText(recs)}`);
}
