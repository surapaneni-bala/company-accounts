/* ---------- SSP: dollars changed into SSP, what is spent in SSP, and what is left (admins) ---------- */
// A change (kind X) takes dollars out of Cash or Bank and puts SSP into Cash or Bank, at the rate it was done (owner,
// 17 Oct 2026: "the USD to SSP change I have done… a separate tile… the SSP balance, expenses, how much SSP is left").
// It is not spending: Accounts' spending stays the same, and the balances of both currencies move. Before this, changes
// were typed as dollar expenses ("Exchange USD to SSP"); each can be turned into a change once its SSP is known.
const xOf = id => S.exchanges.find(x => x.id === id && !x.deleted);
const xRate = x => Math.round(x.ssp / x.usd * 100) / 100;
// old dollar expenses that were really changes into SSP
const CHANGE_RE = /exchang|forex|usd\s*(?:to|→|->)\s*ss[pd]|\bss[pd]\b.*\bchange|\bchange\b.*\bss[pd]\b/i;
const looksLikeChange = e => e.cur === 'USD' && !e.worker && !e.regular && !e.need && CHANGE_RE.test(`${e.reason} ${e.paidTo}`);
const sspThisMonth = () => { const m = today().slice(0, 7); return { xs: live(S.exchanges).filter(x => x.at.startsWith(m)), spent: live(S.expenses).filter(e => e.cur === 'SSP' && e.at.startsWith(m)) }; };
const xRow = x => `<button class="row in" data-act="openExchange" data-id="${esc(x.id)}"><span class="dot">💱</span>
  <span class="main"><span class="t"><span class="tt">${esc(money(x.usd, 'USD'))} → ${esc(money(x.ssp, 'SSP'))}</span></span><span class="s">${esc([`at ${plain(xRate(x))}`, x.with, fmtDate(x.at.slice(0, 10))].filter(Boolean).join(' · '))}</span></span></button>`;

function sspSheet() {
  const b = balances().SSP, hide = signedIn() && !showMoney, last = live(S.exchanges).sort(byAt).pop(), mo = sspThisMonth();
  const xs = live(S.exchanges).sort((a, c) => byAt(c, a)), spent = live(S.expenses).filter(e => e.cur === 'SSP').sort((a, c) => byAt(c, a)), old = live(S.expenses).filter(looksLikeChange).sort((a, c) => byAt(c, a));
  openSheet(`${head('SSP', 'in')}
    <section class="ssp-big">
      <small>SSP left</small>
      ${hide ? '<b class="mask">••••••</b><button class="link" data-act="revealSsp">Show it 🔒</button>' : `<b>${esc(money(b.Total, 'SSP'))}</b>
      <span>💵 Cash ${esc(money(b.Cash, 'SSP'))} · 🏦 Bank ${esc(money(b.Bank, 'SSP'))}</span>${last ? `<span>≈ ${esc(money(Math.round(b.Total / xRate(last) * 100) / 100, 'USD'))} at the last rate, ${esc(plain(xRate(last)))}</span>` : ''}`}
    </section>
    <div class="two"><button class="btn in" data-act="addExchange">💱 Change dollars</button><button class="btn ghost" data-act="paySsp">＋ Pay in SSP</button></div>
    <p class="note" style="margin-top:12px">This month: changed <b>${esc(money(mo.xs.reduce((t, x) => t + x.usd, 0), 'USD'))}</b> into <b>${esc(money(mo.xs.reduce((t, x) => t + x.ssp, 0), 'SSP'))}</b> · spent <b>${esc(money(mo.spent.reduce((t, e) => t + e.amount, 0), 'SSP'))}</b></p>
    ${old.length ? `<h3 class="subh">Changes typed as payments (${old.length})</h3><p class="muted">Typed before as dollar payments. Say how much SSP each gave: then the dollars stay out, and the SSP shows here.</p>
      <div class="card list inset">${old.map(e => `<div class="sugg">${itemRow(e, 'E', true)}<button class="btn small in" data-act="convertExchange" data-id="${esc(e.id)}">💱 It was a change to SSP</button></div>`).join('')}</div>` : ''}
    <h3 class="subh">Changes (${xs.length})</h3>${xs.length ? `<div class="card list inset">${xs.slice(0, 30).map(xRow).join('')}</div>` : '<p class="muted">None yet. Tap “Change dollars” each time you change USD into SSP.</p>'}
    <h3 class="subh">Spent in SSP (${spent.length})</h3>${spent.length ? `<div class="card list inset">${spent.slice(0, 30).map(e => itemRow(e, 'E', true)).join('')}</div>` : '<p class="muted">Nothing yet. Payments in SSP show here.</p>'}`);
  comeBack(sspSheet);
}
const acctPick = (name, cur, label) => `<div class="fld"><span>${label}</span><div class="curseg">${ACCOUNTS.map(a => `<label><input type="radio" name="${name}" value="${a}" ${a === cur ? 'checked' : ''}><span><b>${ACCOUNT_ICON[a]} ${a}</b></span></label>`).join('')}</div></div>`;
// old: a change being edited; from: an old dollar payment that was really a change; preset: a payment being typed that is one
function exchangeForm(old, from, preset) {
  const d = old || (from ? { usd: from.amount, from: accountOf(from.mode), to: 'Cash', with: from.paidTo === 'Not recorded' ? '' : from.paidTo, at: from.at, note: from.reason } : { usd: '', from: 'Cash', to: 'Cash', with: '', at: stamp(), ...preset });
  // the rate starts from the last one only for a new change typed from nothing: an old payment or a payment being typed has
  // its own day's rate, so the SSP is typed as it was received, never worked out from today's rate
  const rate = old ? xRate(old) : from || preset ? '' : S.lastRate || '', withs = [...new Set(live(S.exchanges).map(x => x.with).filter(Boolean))];
  openSheet(`${head(old ? 'Edit the change' : 'Change dollars to SSP', 'in', old?.id || (from ? `was ${from.id}` : ''))}
    ${from ? `<p class="note">${esc(from.id)}: ${esc(money(from.amount, 'USD'))} “${esc(from.reason)}” on ${esc(fmtDate(from.at.slice(0, 10)))}. Saving makes it a change and takes it out of the payments (a line stays in the Change Log).</p>` : ''}
    <form data-form="exchange" data-id="${esc(old?.id || '')}" data-from="${esc(from?.id || '')}">
      <label class="fld"><span>Dollars changed</span><div class="amt-in"><b>$</b><input name="usd" inputmode="decimal" value="${esc(d.usd ?? '')}" required autocomplete="off"></div></label>
      <label class="fld"><span>Rate: SSP for 1 USD</span><input name="xrate" inputmode="decimal" value="${esc(rate)}" placeholder="e.g. 4500" autocomplete="off"></label>
      <label class="fld"><span>SSP received</span><div class="amt-in"><b>SSP</b><input name="ssp" inputmode="decimal" value="${esc(old ? old.ssp : '')}" required autocomplete="off"></div><small class="amt-preview x-check"></small></label>
      ${acctPick('xfrom', d.from, 'Dollars taken from')}
      ${acctPick('xto', d.to, 'SSP put into')}
      <label class="fld"><span>Changed with <em>(optional — who or where)</em></span><input name="with" value="${esc(d.with)}" list="dl-with" maxlength="80" autocomplete="off" placeholder="e.g. Forex bureau, Fahad"></label>${listFrom('dl-with', withs)}
      <label class="fld"><span>When</span><input type="datetime-local" name="at" value="${esc(d.at)}" max="${esc(stamp())}" required></label>
      ${textField('note', 'Note', '', d.note || '', false)}
      <p class="err"></p>
      <button class="btn in">${old ? 'Save changes' : 'Save the change'}</button>
    </form>`);
  refreshExchange($('#sheet form'));
}
// dollars × rate = SSP: typing the SSP received works out the rate instead
function refreshExchange(f, field) {
  const usd = parseAmount(f.elements.usd.value), rate = parseAmount(f.elements.xrate.value), ssp = parseAmount(f.elements.ssp.value);
  if (field && field.name !== 'ssp' && usd && rate) f.elements.ssp.value = String(Math.round(usd * rate * 100) / 100);
  else if (field && field.name === 'ssp' && usd && ssp) f.elements.xrate.value = String(Math.round(ssp / usd * 100) / 100);
  else if (!field && usd && rate && !ssp) f.elements.ssp.value = String(Math.round(usd * rate * 100) / 100);
  const u = parseAmount(f.elements.usd.value), s = parseAmount(f.elements.ssp.value);
  $('.x-check', f).textContent = u && s ? `${money(u, 'USD')} → ${money(s, 'SSP')} (1 USD = ${plain(Math.round(s / u * 100) / 100)} SSP)` : '';
}
function saveExchange(f) {
  const v = Object.fromEntries(new FormData(f)), old = xOf(f.dataset.id), from = f.dataset.from && S.expenses.find(e => e.id === f.dataset.from && !e.deleted);
  const usd = parseAmount(v.usd), ssp = parseAmount(v.ssp), at = String(v.at || '').slice(0, 16);
  if (usd === null) return formErr(f, 'usd', 'Type the dollars changed, like 1000');
  if (ssp === null) return formErr(f, 'ssp', 'Type the SSP received, like 4500000 — or type the rate');
  if (!AT_RE.test(at) || at > stamp()) return formErr(f, 'at', 'Choose when it was changed');
  const rec = { at, usd, ssp, from: v.xfrom === 'Bank' ? 'Bank' : 'Cash', to: v.xto === 'Bank' ? 'Bank' : 'Cash', with: clean(v.with), note: clean(v.note) };
  const by = myName() || S.lastBy || '', rate = Math.round(ssp / usd * 100) / 100, text = `${money(usd, 'USD')} changed into ${money(ssp, 'SSP')} at ${plain(rate)}`;
  if (old) {
    const changed = ['at', 'usd', 'ssp', 'from', 'to', 'with', 'note'].filter(k => String(old[k] ?? '') !== String(rec[k] ?? ''));
    if (!changed.length) { closeSheet(); return toast('Nothing changed'); }
    update({ exchanges: S.exchanges.map(x => (x.id === old.id ? { ...x, ...rec, editedAt: stampSec(), editedBy: by } : x)), log: logWith([['Edited', old.id, `Change to SSP: now ${text}`]], by), ...newestRate(rec, old, rate) });
    toast('Changes saved ✓');
    return sspSheet();
  }
  const [[id], seq] = nextIds('X', 1, S.seq);
  update({ exchanges: [...S.exchanges, { id, ...rec, ...(from ? { was: from.id } : {}), by, createdAt: stampSec() }], seq, ...newestRate(rec, null, rate),
    ...(from ? { expenses: S.expenses.map(e => (e.id === from.id ? { ...e, deleted: stampSec(), deletedBy: by } : e)) } : {}),
    log: logWith([['Added', id, `Change to SSP: ${text}${rec.with ? ` with ${rec.with}` : ''}`], ...(from ? [['Deleted', from.id, `${describe('E', from)} — it was a change to SSP, now ${id}`]] : [])], by) });
  toast(from ? 'Now a change to SSP ✓' : 'Change saved ✓');
  sspSheet();
}
// the rate SSP payments start from: only the newest change's (an old one turned into a change keeps it as it is)
const newestRate = (rec, old, rate) => (live(S.exchanges).some(x => x.id !== (old && old.id) && x.at > rec.at) ? {} : { lastRate: rate });
function exchangeDetail(id) {
  const x = xOf(id);
  if (!x) return false;
  openSheet(`${head('Change to SSP', 'in', x.id)}
    <div class="dbig in">${esc(money(x.ssp, 'SSP'))}</div>
    ${facts([['Dollars changed', money(x.usd, 'USD')], ['Rate', `${plain(xRate(x))} SSP for 1 USD`], ['Dollars from', x.from], ['SSP into', x.to], ['Changed with', x.with], ['When', fmtAbs(x.at)], ['Note', x.note], ['Entered by', x.by], ['Was', x.was && `${x.was} (a dollar payment before)`]])}
    <div class="two"><button class="btn ghost" data-act="editExchange" data-id="${esc(id)}">✏️ Edit 🔒</button><button class="btn danger" data-act="delExchange" data-id="${esc(id)}">🗑 Delete 🔒</button></div>`);
  comeBack(() => exchangeDetail(id));
}
async function deleteExchange(id) {
  const x = xOf(id);
  if (!x || !await unlock('Enter the password to delete this change.')) return;
  const by = confirmBy(`Delete the change of ${money(x.usd, 'USD')} into ${money(x.ssp, 'SSP')}?${x.was ? `\n\nIt was the payment ${x.was} before: that payment comes back.` : ''}`);
  if (!by) return;
  update({ exchanges: S.exchanges.map(e => (e.id === id ? { ...e, deleted: stampSec(), deletedBy: by } : e)),
    ...(x.was ? { expenses: S.expenses.map(e => (e.id === x.was ? Object.fromEntries(Object.entries({ ...e, editedAt: stampSec(), editedBy: by }).filter(([k]) => !['deleted', 'deletedBy'].includes(k))) : e)) } : {}),
    log: logWith([['Deleted', id, `Change to SSP: ${money(x.usd, 'USD')} → ${money(x.ssp, 'SSP')}${x.was ? ` (payment ${x.was} back)` : ''}`]], by) });
  toast('Deleted ✓'); closeAll(); sspSheet();
}
