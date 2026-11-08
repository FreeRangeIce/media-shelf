// Duplicate-prompt staleness and legacy source materialization in mergeUpdate. Production tabletop.js
// with native DOM/localStorage doubles; mocked fetch; synthetic data. Not a browser/device test.
const assert = require('node:assert/strict');
const { boot, tick } = require('./helpers/tt-dom-double.cjs');
const core = require('../tabletop.js');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('PASS', name); };
const A = { id: 'g1', title: 'Old Game A', subtype: 'board', status: 'owned', bggId: '100', year: '2001', designer: 'Designer A', coverUrl: 'https://cf.geekdo-images.com/a.jpg', dateAdded: '2026-01-01T00:00:00.000Z', dateUpdated: '2026-01-01T00:00:00.000Z' };
const sparse = id => ({ bggId: id, bggType: 'boardgame', name: `Direct ${id}`, image: '', designer: '', year: '0' });
const type = (t, k, v) => { t.F(`tt-${k}`).value = v; t.F('tt-form').trigger('input', { target: t.F(`tt-${k}`) }); };
const prompt = t => { t.F('tt-empty-add').trigger('click'); type(t, 'title', 'Old Game A'); type(t, 'bggId', '100'); t.F('tt-form').trigger('submit'); };
const setStore = (t, list) => t.store.set('media-tracker-v1:tabletop', JSON.stringify(list));
async function direct(t, id) { type(t, 'bggId', id); t.F('tt-bgg-go').trigger('click'); await tick(); await tick(); t.panelClick({ bggPick: '1' }); t.panelClick({ bggUse: '1' }); if (/Overwrite filled/.test(t.F('tt-bgg-panel').innerHTML)) t.panelClick({ bggOverwrite: '1' }); }

(async () => {
  {
    const t = boot([A], []); prompt(t);
    check('prompt shown for legacy A (id 100)', () => assert.equal(t.F('tt-dup').hidden, false));
    type(t, 'bggId', '200');
    check('editing the id hides the stale prompt', () => assert.equal(t.F('tt-dup').hidden, true));
    t.F('tt-dup-update').trigger('click'); // stale button press anyway
    const s = t.saved(); const a = s.find(e => e.id === 'g1');
    check('stale Update never rewrites A under id 200; A keeps id/cover', () => { assert.equal(a.bggId, '100'); assert.equal(a.coverUrl, A.coverUrl); assert(!s.some(e => e.bggId === '200' && e.coverUrl === A.coverUrl)); });
  }
  {
    const t = boot([A], []); prompt(t);
    t.F('tt-bggId').value = '200'; // changed with no input event (programmatic): Save-time revalidation must catch it
    t.F('tt-dup-update').trigger('click');
    const s = t.saved();
    check('revalidation: id changed without an event -> no merge into A', () => { assert.equal(s.find(e => e.id === 'g1').bggId, '100'); assert.equal(s.find(e => e.id === 'g1').coverUrl, A.coverUrl); });
    const n = s.find(e => e.id !== 'g1');
    check('the new 200 entry gets no A cover/designer/year', () => { assert(n); assert.equal(n.bggId, '200'); assert.equal(n.coverUrl, ''); assert.equal(n.designer, ''); });
  }
  {
    const t = boot([A], []); prompt(t); t.F('tt-title').value = 'Different title'; t.F('tt-bggId').value = '';
    t.F('tt-dup-add').trigger('click');
    check('stale Add-copy with edited title/id re-checks (no match -> plain save)', () => { assert.equal(t.saved().length, 2); assert.equal(t.saved().find(e => e.id === 'g1').coverUrl, A.coverUrl); });
  }
  {
    const t = boot([A], []); prompt(t); setStore(t, []); // target deleted (another tab) between prompt and click
    t.F('tt-dup-update').trigger('click'); const s = t.saved();
    check('deleted target: no resurrection of A; saved as a new entry without A data', () => { assert.equal(s.length, 1); assert.notEqual(s[0].id, 'g1'); assert.equal(s[0].coverUrl, ''); });
  }
  {
    const t = boot([A], []); prompt(t); const A2 = { ...A, id: 'g2', title: 'Replacement', coverUrl: 'https://x/r.jpg' }; setStore(t, [A2]);
    t.F('tt-dup-update').trigger('click');
    check('target replaced by a different entry with id 100: asks again, writes nothing', () => { assert.equal(t.F('tt-dup').hidden, false); assert.match(t.F('tt-dup-text').textContent, /Replacement/); assert.deepEqual(t.saved().map(e => e.id), ['g2']); assert.equal(t.saved()[0].coverUrl, 'https://x/r.jpg'); });
    t.F('tt-dup-update').trigger('click');
    check('after the fresh prompt, Update goes to the new target', () => { assert.equal(t.saved().length, 1); assert.equal(t.saved()[0].id, 'g2'); });
  }
  {
    const t = boot([A], []); prompt(t); t.F('tt-form-modal').hidden = true; // closed/cancelled
    check('cancel after prompt writes nothing', () => assert.deepEqual(t.saved(), [A]));
    const t2 = boot(t.saved(), []); t2.edit('g1'); check('reopen after cancel shows A intact', () => assert.equal(t2.F('tt-coverUrl').value, A.coverUrl));
  }
  {
    const t = boot([A], [sparse('200')]); prompt(t); t.F('tt-dup-update').trigger('click');
    const s = t.saved()[0];
    check('valid Update of legacy A materializes ?100 tags for kept cover/year/designer', () => { assert.equal(s.id, 'g1'); assert.equal(s.bggSrc.coverUrl, '?100'); assert.equal(s.bggSrc.year, '?100'); assert.equal(s.bggSrc.designer, '?100'); });
    const t2 = boot(t.saved(), [sparse('200')]); t2.edit('g1'); await direct(t2, '200'); t2.F('tt-form').trigger('submit');
    const t3 = boot(t2.saved(), []); t3.edit('g1');
    check('later switch to 200 (sparse) clears A cover/year/designer after save+reopen', () => { assert.equal(t3.F('tt-coverUrl').value, ''); assert.equal(t3.F('tt-designer').value, ''); assert.equal(t3.F('tt-year').value, ''); });
  }
  check('pure mergeUpdate: legacy old 100 + incoming 200 keeps old fields tied to ?100', () => {
    const m = core.mergeUpdate(core.normalize(A), { bggId: '200', title: 'B' });
    assert.equal(m.bggId, '200'); assert.equal(m.bggSrc.coverUrl, '?100'); assert.equal(m.bggSrc.designer, '?100'); assert.equal(m.bggSrc.year, '?100');
  });
  check('pure mergeUpdate: explicit old tags win over fallback', () => assert.equal(core.mergeUpdate(core.normalize({ ...A, bggSrc: { coverUrl: '' } }), { bggId: '200' }).bggSrc.coverUrl, ''));
  check('hand-match MERGE (restore) also materializes legacy tags', () => {
    const cur = [core.normalize({ ...A, bggId: '' })];
    const r = core.mergeRestore(cur, [{ id: 'z', title: 'Old Game A', subtype: 'board', bggId: '200', dateUpdated: '2026-02-01T00:00:00.000Z' }], { onHandMatch: () => core.HAND_MATCH.MERGE });
    assert.equal(r.list[0].bggId, '200'); assert.equal(r.list[0].bggSrc.coverUrl, '?');
  });
  console.log(`${passed}/${passed} passed (production tabletop.js with native DOM/storage doubles; mocked fetch; no browser/device/provider claims)`);
})().catch(err => { console.error(err); process.exitCode = 1; });
