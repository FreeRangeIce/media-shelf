// Backup restore end to end with REAL app.js media storage/rollback/recovery and REAL tabletop.js.
// Storage faults are injected per phase. Synthetic data; native doubles; not a browser test.
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/app-real-media.cjs');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('PASS', name); };
const quota = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; return e; };
const BACKUP = { app: 'freerangemedia', version: 3, items: [{ id: 'comic-new', type: 'comic', title: 'New comic' }, { id: 'book-new', type: 'book', title: 'New book' }], tabletop: { v: 1, entries: [{ id: 'tt-new', title: 'New tabletop', subtype: 'board', bggId: '200', dateUpdated: '2026-11-08T00:00:00.000Z' }] } };
const SEED = () => [[{ id: 'old', type: 'book', title: 'Old' }], [{ id: 'tt-old', title: 'Old tabletop', subtype: 'board', bggId: '100', dateUpdated: '2026-01-01T00:00:00.000Z' }]];
(async () => {
  for (const mode of ['replace', 'merge']) {
    {
      const h = bootApp(); h.seed(...SEED()); await h.restore(mode, BACKUP);
      check(`${mode}: success stores media + tabletop, success copy, no POST`, () => { assert(h.mediaIds().includes('comic-new')); assert(h.ttIds().includes('tt-new')); assert.match(h.toasts.at(-1), /^(Restored|Merged)/); assert.doesNotMatch(h.toasts.at(-1), /couldn’t|didn’t/); assert.equal(h.posts(), 0); });
      check(`${mode}: media written before tabletop`, () => { const i = h.ops.findIndex(o => o[1] === h.MEDIA), j = h.ops.findIndex(o => o[1] === h.TABLE); assert(i >= 0 && j > i); });
    }
    {
      const h = bootApp(); h.seed(...SEED()); h.setPolicy((k) => { if (k === h.MEDIA) throw quota(); });
      await h.restore(mode, BACKUP); h.setPolicy(null);
      check(`${mode}: main write fails, rollback OK -> "nothing was restored" is TRUE; no shadow, tabletop untouched`, () => { assert.match(h.toasts.at(-1), /nothing was restored/); assert.equal(h.store.has(h.SHADOW), false); assert.deepEqual(h.mediaIds(), ['old']); assert.deepEqual(h.ttIds(), ['tt-old']); assert(!h.ops.some(o => o[1] === h.TABLE)); });
    }
    {
      const h = bootApp(); h.seed(...SEED());
      h.setPolicy((k, op) => { if (k === h.MEDIA) throw quota(); if (k === h.SHADOW && op === 'remove') throw new Error('storage unavailable'); });
      await h.restore(mode, BACKUP); const msg = h.toasts.at(-1); h.setPolicy(null);
      check(`${mode}: main write + rollback fail -> uncertain copy, never "nothing"`, () => { assert.equal(msg, 'Restore didn’t finish and some items may have changed. Check your shelf.'); assert(!h.toasts.some(m => /nothing was|Nothing was/.test(m))); });
      check(`${mode}: tabletop not restored after the media failure; backup comic is in the shadow (not erased)`, () => { assert.deepEqual(h.ttIds(), ['tt-old']); assert(h.store.get(h.SHADOW).includes('comic-new')); });
      h.api.applyComicRepair(); // the real repair path every startup/sync runs
      check(`${mode}: real recovery later promotes the comic — the "may have changed" message was the honest one`, () => assert(h.api.getItems().some(i => i.id === 'comic-new')));
    }
    {
      const h = bootApp(); h.seed(...SEED()); let fail = false;
      h.t.tt.init({ toast: () => {}, search: () => { if (fail) throw new Error('render failure'); return ''; } }); h.t.tt.show(true); fail = true;
      await h.restore(mode, BACKUP);
      check(`${mode}: tabletop committed then render throws -> committed reported, refresh note, no "unchanged"`, () => { assert(h.ttIds().includes('tt-new')); assert.doesNotMatch(h.toasts.at(-1), /unchanged|couldn’t be restored/); assert.match(h.toasts.at(-1), /^(Restored|Merged).*The tabletop shelf didn’t refresh; reopen the app to see it\.$/); assert.equal(h.posts(), 0); });
    }
    {
      const h = bootApp(); h.seed(...SEED()); h.setPolicy((k) => { if (k === h.TABLE) throw quota(); });
      await h.restore(mode, BACKUP); h.setPolicy(null);
      check(`${mode}: tabletop write fails after media commit -> partial "unchanged" is true`, () => { assert.deepEqual(h.ttIds(), ['tt-old']); assert(h.mediaIds().includes('comic-new')); assert.match(h.toasts.at(-1), /tabletop shelf is unchanged/); });
    }
  }
  console.log(`${passed}/${passed} passed (REAL app.js media commit/shadow/rollback/recovery + REAL tabletop.js; injected storage faults; native doubles; no browser/provider claims)`);
})().catch(err => { console.error(err); process.exitCode = 1; });
