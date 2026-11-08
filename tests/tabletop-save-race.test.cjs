// Final-write race: another tab changes shared storage BETWEEN saveForm's check read and commit's
// write read. Deterministic via a storage double hook. Production tabletop.js; mocked fetch; synthetic.
const assert = require('node:assert/strict');
const { boot, tick } = require('./helpers/tt-dom-double.cjs');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('PASS', name); };
const KEY = 'media-tracker-v1:tabletop';
const X = { id: 'x1', title: 'GameUPC Game B', subtype: 'board', status: 'owned', bggId: '200', coverUrl: 'https://cf.geekdo-images.com/x.jpg', dateAdded: '2026-01-01T00:00:00.000Z', dateUpdated: '2026-01-01T00:00:00.000Z' };
const upcB = { bggId: '200', name: 'GameUPC Game B', year: '2025' };
// Fire `change` on the 2nd tabletop read after arming (1st = saveForm's check, 2nd = commit's read).
const armSecondRead = (t, change) => { let n = 0; t.setGetHook(k => { if (k !== KEY) return; if (++n === 2) { t.setGetHook(null); change(); } }); };
const setList = (t, list) => t.store.set(KEY, JSON.stringify(list));
const posts = t => t.fetches.filter(f => f.method === 'POST').length;
function assertAborted(t, before, label, fields) {
  check(`${label}: storage holds only the other tab's state`, () => assert.deepEqual(JSON.parse(t.store.get(KEY)), before));
  check(`${label}: no success toast; recoverable status shown`, () => { assert(!t.toasts.some(x => /^(Updated|Saved)$/.test(x))); assert.match(t.toasts.at(-1), /Not saved/); assert.equal(t.F('tt-save-status').hidden, false); });
  check(`${label}: form stays open with typed values`, () => { assert.equal(t.F('tt-form-modal').hidden, false); for (const [k, v] of Object.entries(fields)) assert.equal(t.F(`tt-${k}`).value, v); });
}
async function upcPrompt(seed) {
  const t = boot(seed, [], upcB); t.F('tt-empty-add').trigger('click');
  t.F('tt-barcode').value = '200000000001'; t.F('tt-upc-go').trigger('click'); await tick(); await tick();
  t.upcClick({ upcPick: '0' }); t.upcClick({ upcConfirm: '1' }); t.F('tt-notes').value = 'typed notes';
  t.F('tt-form').trigger('submit'); assert.equal(t.F('tt-dup').hidden, false); return t;
}
(async () => {
  for (const [label, change] of [
    ['dup target deleted', t => setList(t, [])],
    ['dup target replaced', t => setList(t, [{ ...X, coverUrl: 'https://cf.geekdo-images.com/other-tab.jpg', dateUpdated: '2026-11-08T19:00:00.000Z' }])],
  ]) {
    const t = await upcPrompt([X]); armSecondRead(t, () => change(t)); const after = () => JSON.parse(t.store.get(KEY));
    t.F('tt-dup-update').trigger('click'); await tick();
    assertAborted(t, after(), label, { title: 'GameUPC Game B', bggId: '200', notes: 'typed notes', barcode: '200000000001' });
    check(`${label}: no GameUPC confirmation POST`, () => assert.equal(posts(t), 0));
    t.F('tt-form').trigger('submit'); await tick();
    if (t.F('tt-dup').hidden === false) t.F('tt-dup-update').trigger('click'); await tick();
    check(`${label}: retry Save after the race succeeds against fresh data`, () => { assert.equal(t.F('tt-form-modal').hidden, true); assert(t.toasts.some(x => /^(Updated|Saved)$/.test(x))); assert(JSON.parse(t.store.get(KEY)).some(e => e.notes === 'typed notes')); });
  }
  for (const [label, change] of [
    ['edited entry deleted', t => setList(t, [])],
    ['edited entry changed', t => setList(t, [{ ...X, title: 'Renamed in other tab', dateUpdated: '2026-11-08T19:00:00.000Z' }])],
  ]) {
    const t = boot([X], []); t.edit('x1'); t.F('tt-notes').value = 'my edit';
    armSecondRead(t, () => change(t)); t.F('tt-form').trigger('submit');
    assertAborted(t, JSON.parse(t.store.get(KEY)), label, { notes: 'my edit', bggId: '200' });
  }
  {
    const t = boot([], []); t.F('tt-empty-add').trigger('click'); t.F('tt-title').value = 'Fresh'; t.F('tt-bggId').value = '200';
    armSecondRead(t, () => setList(t, [X])); t.F('tt-form').trigger('submit');
    assertAborted(t, [X], 'duplicate appeared during plain Add', { title: 'Fresh', bggId: '200' });
    t.F('tt-form').trigger('submit');
    check('plain Add retry now shows the duplicate prompt instead of a silent second copy', () => { assert.equal(t.F('tt-dup').hidden, false); assert.equal(JSON.parse(t.store.get(KEY)).length, 1); });
  }
  {
    const t = boot([X], []); t.edit('x1'); t.F('tt-notes').value = 'ok'; t.F('tt-form').trigger('submit');
    check('control: no race -> saved, closed, "Saved"', () => { assert.equal(t.F('tt-form-modal').hidden, true); assert(t.toasts.includes('Saved')); assert.equal(JSON.parse(t.store.get(KEY))[0].notes, 'ok'); });
    t.edit('x1'); check('status line is cleared on reopen', () => assert.equal(t.F('tt-save-status').hidden, true));
  }
  console.log(`${passed}/${passed} passed (production tabletop.js with native DOM/storage doubles; deterministic storage-timing hook; mocked fetch; no browser/device/provider claims)`);
})().catch(err => { console.error(err); process.exitCode = 1; });
