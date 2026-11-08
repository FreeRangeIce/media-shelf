// Durable per-field BGG provenance (bggSrc) across save/reopen, GameUPC, direct lookup, hand edits,
// duplicate Update, backup/restore and malformed metadata. Production tabletop.js + native DOM/storage
// doubles; all provider data synthetic; mocked fetch only. Not a browser/device test.
const assert = require('node:assert/strict');
const { boot, tick } = require('./helpers/tt-dom-double.cjs');
const core = require('../tabletop.js');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('PASS', name); };
const LEGACY_A = { id: 'g1', title: 'Old Game A', subtype: 'board', status: 'owned', bggId: '100', bggType: 'boardgame', year: '2001', designer: 'Designer A', players: '2–4', playTime: '60', coverUrl: 'https://cf.geekdo-images.com/a.jpg', notes: 'n', dateAdded: '2026-01-01T00:00:00.000Z' };
const res = (id, extra = {}) => ({ bggId: id, bggType: 'boardgame', name: `Direct ${id}`, year: '0', designer: '', players: '', playTime: '0', image: '', thumbnail: '', ...extra });
const upcB = { bggId: '200', name: 'GameUPC Game B', year: '2025' };
const edit = t => t.edit('g1');
const upc = async t => { t.F('tt-barcode').value = '200000000001'; t.F('tt-upc-go').trigger('click'); await tick(); await tick(); t.upcClick({ upcPick: '0' }); t.upcClick({ upcConfirm: '1' }); };
const type = (t, k, v) => { t.F(`tt-${k}`).value = v; t.F('tt-form').trigger('input', { target: t.F(`tt-${k}`) }); };
async function direct(t, id, { accept = true } = {}) {
  type(t, 'bggId', id); t.F('tt-bgg-go').trigger('click'); await tick(); await tick();
  t.panelClick({ bggPick: '1' }); t.panelClick({ bggUse: '1' });
  const w = t.F('tt-bgg-panel').innerHTML;
  if (/Overwrite filled/.test(w)) t.panelClick(accept ? { bggOverwrite: '1' } : { bggBack: '1' });
  return w;
}
const save = t => { t.F('tt-form').trigger('submit'); return t.saved().find(e => e.id === 'g1'); };
const fresh = (t, things, upcC) => boot(t.saved(), things, upcC); // new app instance from persisted storage

(async () => {
  // 1. The Berean repro: A -> GameUPC B -> Save -> fresh reopen -> direct B lacking image/designer.
  for (const seedSrc of ['legacy', 'tagged']) {
    const seed = seedSrc === 'legacy' ? LEGACY_A : { ...LEGACY_A, bggSrc: { year: '100', designer: '100', players: '100', playTime: '100', coverUrl: '100' } };
    let t = boot([seed], [], upcB); edit(t); await upc(t);
    const s1 = save(t);
    check(`[${seedSrc}] UPC-only save keeps A fields tied to A, B year tied to B`, () => { assert.equal(s1.bggId, '200'); assert.equal(s1.bggSrc.year, '200'); assert.equal(core.cleanBggSrc(s1.bggSrc, s1).coverUrl.replace('?', ''), '100'); assert.equal(s1.bggSrc.designer.replace('?', ''), '100'); });
    for (const id of ['100', '200', '300']) {
      t = fresh({ saved: () => [s1] }, [res(id)]); edit(t);
      const w = await direct(t, id); const s2 = save(t);
      t = fresh(t, []); edit(t);
      check(`[${seedSrc}] saved A->UPC B->save->reopen->direct ${id} (no image/designer/year) has no other-game data after save+reopen`, () => {
        if (id === '100') { assert.equal(s2.coverUrl, LEGACY_A.coverUrl); assert.equal(s2.designer, 'Designer A'); assert.equal(s2.year, ''); }
        else if (id === '200') { assert.equal(s2.coverUrl, ''); assert.equal(s2.designer, ''); assert.equal(s2.players, ''); assert.equal(s2.year, '2025'); }
        else { assert.equal(s2.coverUrl, ''); assert.equal(s2.designer, ''); assert.equal(s2.year, ''); }
        assert.equal(t.F('tt-coverUrl').value, s2.coverUrl); assert.equal(t.F('tt-year').value, s2.year);
        assert.doesNotMatch(w, /previous BGG id/);
      });
    }
  }
  // 2. Manual edits survive save/reopen as manual; before and after a lookup.
  {
    let t = boot([LEGACY_A], [res('200')]); edit(t); type(t, 'coverUrl', 'https://mine.example/c.jpg'); type(t, 'year', '1999');
    let s = save(t);
    check('hand edits persist as hand-typed source', () => { assert.equal(s.bggSrc.coverUrl, ''); assert.equal(s.bggSrc.year, ''); assert.equal(s.bggSrc.designer, '?100'); });
    t = fresh(t, [res('200')]); edit(t); const w = await direct(t, '200'); s = save(t);
    check('after reopen, manual cover/year kept and labelled "Kept as you typed"; A designer cleared', () => { assert.equal(s.coverUrl, 'https://mine.example/c.jpg'); assert.equal(s.year, '1999'); assert.equal(s.designer, ''); assert.match(w, /Kept as you typed: year, cover\./); assert.match(w, /has no designer, players, play time\./); });
    t = fresh(t, [res('300', { image: 'https://cf.geekdo-images.com/c.jpg' })]); edit(t); await direct(t, '300'); type(t, 'designer', 'Me'); s = save(t);
    t = fresh(t, [res('400')]); edit(t); await direct(t, '400'); s = save(t);
    check('direct C accepted, hand edit after lookup, save, reopen, switch to D: C cover cleared, manual kept', () => { assert.equal(s.coverUrl, ''); assert.equal(s.designer, 'Me'); assert.equal(s.year, '1999'); assert.equal(s.bggId, '400'); });
  }
  // 3. Same-ID unknown/legacy and same-ID known values: "Kept unchanged", never "as you typed".
  {
    const t = boot([LEGACY_A], [res('100', { name: 'Old Game A' })]); edit(t); const w = await direct(t, '100'); const s = save(t);
    check('legacy same-ID retention is labelled Kept unchanged, data kept, source stays unknown', () => { assert.equal(s.coverUrl, LEGACY_A.coverUrl); if (/Overwrite/.test(w)) { assert.match(w, /Kept unchanged:/); assert.doesNotMatch(w, /as you typed/); } assert.equal(s.bggSrc.coverUrl, '?100'); });
  }
  // 4. Cancellation and plain typing never clear data or sources.
  {
    const t = boot([LEGACY_A], [res('200')], upcB); edit(t); await upc(t); type(t, 'bggId', '200');
    await direct(t, '200', { accept: false }); t.panelClick({ bggCancel: '1' }); const s = save(t);
    check('cancel + typing: nothing cleared, sources intact', () => { assert.equal(s.coverUrl, LEGACY_A.coverUrl); assert.equal(s.bggSrc.coverUrl, '?100'); assert.equal(s.year, '2025'); assert.equal(s.bggSrc.year, '200'); });
  }
  // 5. Duplicate Update merges fields and their sources together.
  {
    const X = { ...LEGACY_A, id: 'x1', title: 'Shared', bggId: '500', bggSrc: { year: '500', designer: '', coverUrl: '500', players: '500', playTime: '500' } };
    const t = boot([X], [res('500', { name: 'Shared', year: '2020' })]);
    t.F('tt-empty-add').trigger('click'); await direct(t, '500'); t.F('tt-form').trigger('submit'); t.F('tt-dup-update').trigger('click');
    const s = t.saved()[0];
    check('duplicate Update: replaced year takes incoming source; untouched fields keep theirs', () => { assert.equal(t.saved().length, 1); assert.equal(s.year, '2020'); assert.equal(s.bggSrc.year, '500'); assert.equal(s.bggSrc.designer, ''); assert.equal(s.bggSrc.coverUrl, '500'); });
  }
  check('pure mergeUpdate: incoming value without source becomes unknown tied to incoming id; empty incoming keeps old source', () => {
    const old = core.normalize({ id: 'o', title: 'T', bggId: '5', year: '2000', coverUrl: 'https://x/a.jpg', bggSrc: { year: '5', coverUrl: '' } });
    const m = core.mergeUpdate(old, { bggId: '6', year: '2001' });
    assert.equal(m.bggSrc.year, '?6'); assert.equal(m.bggSrc.coverUrl, ''); assert.equal(m.coverUrl, 'https://x/a.jpg');
  });
  // 6. Backup/restore round trip keeps metadata; legacy backups stay unknown.
  {
    const t = boot([LEGACY_A], [], upcB); edit(t); await upc(t); save(t);
    const block = t.tt.backupBlock();
    const parsed = core.parseBackupBlock({ tabletop: JSON.parse(JSON.stringify(block)) });
    check('backup -> parseBackupBlock keeps bggSrc', () => assert.deepEqual(parsed[0].bggSrc, t.saved()[0].bggSrc));
    const t2 = boot([], []); t2.tt.restore(parsed, 'replace');
    check('restore replace keeps bggSrc', () => assert.deepEqual(t2.saved()[0].bggSrc, t.saved()[0].bggSrc));
    const r = core.mergeRestore([], parsed);
    check('mergeRestore keeps bggSrc', () => assert.deepEqual(r.list[0].bggSrc, parsed[0].bggSrc));
    check('legacy backup entry without bggSrc stays unknown (no migration)', () => assert.deepEqual(core.parseBackupBlock({ tabletop: { entries: [LEGACY_A] } })[0].bggSrc, {}));
  }
  // 7. Malformed / hostile metadata cannot poison ids or claim sources for empty fields.
  check('malformed bggSrc values and keys are dropped', () => {
    const e = core.normalize({ id: 'm', title: 'T', bggId: '7', year: '2000', designer: 'D', coverUrl: 'https://x/a.jpg', bggSrc: { year: 'abc', designer: 7, coverUrl: '?0', players: '7', title: '7', __proto__x: '1' } });
    assert.deepEqual(e.bggSrc, {});
    for (const bad of [null, 'x', [], 5]) assert.deepEqual(core.normalize({ id: 'm', title: 'T', year: '2000', bggSrc: bad }).bggSrc, {});
  });
  check('valid tags kept only for filled fields', () => assert.deepEqual(core.normalize({ id: 'm', title: 'T', year: '2000', designer: '', bggSrc: { year: '?12', designer: '12' } }).bggSrc, { year: '?12' }));
  {
    const poisoned = { ...LEGACY_A, bggId: '200', bggSrc: { coverUrl: 'evil', designer: '0200' } };
    const t = boot([poisoned], [res('200')]); edit(t); await direct(t, '200'); const s = save(t);
    check('malformed stored tags fall back to unknown-with-saved-id (kept unchanged), never a forged source', () => { assert.equal(s.coverUrl, LEGACY_A.coverUrl); assert.equal(s.bggSrc.coverUrl, '?200'); });
  }
  console.log(`${passed}/${passed} passed (production tabletop.js with native DOM/storage doubles; mocked fetch; no browser/device/provider claims)`);
})().catch(err => { console.error(err); process.exitCode = 1; });
