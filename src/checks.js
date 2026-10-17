/* ---------- checks: the same payment entered twice ---------- */
// The rent typed by two people, both kept (owner, 17 Oct 2026): the pairs calc.js findDoubles finds, for an admin to delete
// the extra one or say they are two payments. ponytail: "two payments" is kept on this phone, like "Not regular"; a shared
// note needs a sheet-script change.
const doubles = () => (can('edit') ? findDoubles(live(S.expenses), S.notDouble || []) : []);
const doubleBanner = () => { const n = doubles().length; return n ? `<div class="banner"><span>⚠️ ${n === 1 ? 'A payment' : `${n} payments`} may be entered twice.</span><button class="btn small" data-act="doubles">Check</button></div>` : ''; };
function doublesSheet() {
  const list = doubles();
  openSheet(`${head('Entered twice?', 'out')}
    <p class="hint">The same money within two days, entered by two people, or twice by one. If it was one payment, open the extra one and delete it. If they really are two payments, say so.</p>
    ${list.length ? list.map(({ key, a, b }) => `<section class="card pad" style="margin-bottom:12px"><div class="card list inset">${itemRow(a, 'E', true)}${itemRow(b, 'E', true)}</div>
      <button class="btn small ghost" data-act="notDouble" data-key="${esc(key)}" style="margin-top:10px">They are two payments</button></section>`).join('') : empty('Nothing to check', 'No payment looks entered twice.')}`);
  comeBack(doublesSheet);
}
// changes the sheet did not take because someone changed the same entry on another phone first
const lostBanner = () => ((S.lost || []).length ? `<div class="banner"><span>⚠️ ${S.lost.length === 1 ? 'A change was' : `${S.lost.length} changes were`} not saved: someone changed ${S.lost.length === 1 ? 'it' : 'them'} on another phone first, so this phone now shows theirs — ${esc(S.lost.slice(-3).map(l => l.what).join('; '))}. Check ${S.lost.length === 1 ? 'it' : 'them'} and make your change again if it is still needed.</span><button class="btn small" data-act="lostSeen">OK</button></div>` : '');
function notDouble(key) { update({ notDouble: [...(S.notDouble || []), key] }); toast('Kept both ✓'); doublesSheet(); }
