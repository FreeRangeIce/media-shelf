// Outcome-honesty regressions on REAL app.js (CLZ commit, commitItems/saveStore/shadow/sync repair,
// importJson merge route) + REAL tabletop.js, native doubles. Synthetic data; no network.
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/app-real-media.cjs');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('PASS', name); };
const quota = () => { const e = new Error('q'); e.name = 'QuotaExceededError'; return e; };
const clzSeed = h => h.api.setClz({ typeKey: 'comics', evals: [{ kind: 'new', item: h.api.normalizeItem({ id: 'incoming', type: 'comic', title: 'Imported comic', series: 'S', issue: '1' }) }], choices: new Map() });
const inline = h => h.el('#clz-message');
(async () => {
  {
    const h = bootApp(); h.seed([{ id: 'old', type: 'book', title: 'Old' }]); clzSeed(h);
    h.setPolicy((k, op) => { if (k === h.MEDIA) throw quota(); if (k === h.SHADOW && op === 'remove') throw new Error('rollback unavailable'); });
    h.api.commitClz(); h.setPolicy(null);
    check('CLZ: main write + rollback fail -> inline repeats the uncertain toast (no "nothing was imported")', () => { assert.equal(h.toasts.at(-1), 'Import didn’t finish and some items may have changed. Check your shelf.'); assert.equal(inline(h).textContent, h.toasts.at(-1)); assert.doesNotMatch(inline(h).textContent, /nothing was imported/); });
    check('CLZ: comic really is in the shadow (the uncertainty is true)', () => assert(h.store.get(h.SHADOW).includes('Imported comic')));
  }
  {
    const h = bootApp(); h.seed([{ id: 'old', type: 'book', title: 'Old' }]); clzSeed(h);
    h.setPolicy((k) => { if (k === h.MEDIA) throw quota(); });
    h.api.commitClz(); h.setPolicy(null);
    check('CLZ: main write fails, rollback OK -> "nothing was imported" (true) in toast and inline, no shadow', () => { assert.match(h.toasts.at(-1), /nothing was imported/); assert.equal(inline(h).textContent, h.toasts.at(-1)); assert.equal(h.store.has(h.SHADOW), false); assert.deepEqual(h.mediaIds(), ['old']); });
  }
  {
    const h = bootApp(); h.seed([{ id: 'old', type: 'book', title: 'Old' }]); clzSeed(h);
    h.setPolicy((k) => { if (k === h.MEDIA) { const e = new Error('denied'); e.name = 'SecurityError'; throw e; } });
    h.api.commitClz(); h.setPolicy(null);
    check('CLZ: non-quota failure -> generic message, not "didn’t fit", inline agrees', () => { assert.doesNotMatch(h.toasts.at(-1), /didn’t fit/); assert.equal(inline(h).textContent, h.toasts.at(-1)); });
  }
  // Berean's JSON-only chain: shadow repair writes during sync, then a malformed (object) dateUpdated.
  const repairSetup = h => {
    h.seed([{ id: 'old', type: 'book', title: 'Existing book', dateUpdated: '2026-11-01T00:00:00Z' }]);
    const rec = h.api.normalizeItem({ id: 'recover-me', type: 'comic', title: 'Existing comic', series: 'S', issue: '1', dateUpdated: '2026-11-01T00:00:00Z' });
    h.rawSet(h.SHADOW, JSON.stringify({ v: 1, items: [rec], deleted: [] }));
    const main = JSON.parse(h.store.get(h.MEDIA)); main.savedAt = '2026-11-08T12:00:00-08:00'; h.rawSet(h.MEDIA, JSON.stringify(main));
  };
  {
    const h = bootApp(); repairSetup(h);
    await h.restore('merge', { app: 'freerangemedia', version: 3, items: [{ id: 'old', type: 'book', title: 'Incoming book', dateAdded: '2026-10-01T00:00:00Z', dateUpdated: { toString: 1, valueOf: 1 } }] });
    check('JSON object date no longer throws mid-merge; no "Nothing was changed" after the repair write', () => { assert(!h.toasts.some(m => /Nothing was changed/.test(m))); assert.match(h.toasts.at(-1), /^Merged/); });
    check('repair kept (comic recovered) and stored state matches the success message', () => assert(h.mediaIds().includes('recover-me')));
  }
  {
    const h = bootApp(); repairSetup(h); let err = null;
    try { h.api.commitItems(() => { throw new Error('mutation fault'); }, 'restore'); } catch (e) { err = e; }
    check('commitItems marks a mutation failure that follows a sync repair write as storageChanged', () => { assert(err); assert.equal(err.storageChanged, true); assert(h.mediaIds().includes('recover-me')); });
  }
  {
    const h = bootApp(); h.seed([{ id: 'old', type: 'book', title: 'Old' }]); let err = null; const before = h.store.get(h.MEDIA);
    try { h.api.commitItems(() => { throw new Error('mutation fault'); }, 'restore'); } catch (e) { err = e; }
    check('control: mutation failure with no prior write is NOT storageChanged and storage is identical', () => { assert(!err.storageChanged); assert.equal(h.store.get(h.MEDIA), before); });
  }
  console.log(`${passed}/${passed} passed (REAL app.js CLZ/commit/shadow/sync-repair/merge + REAL tabletop.js; native doubles; no browser/provider claims)`);
})().catch(err => { console.error(err); process.exitCode = 1; });
