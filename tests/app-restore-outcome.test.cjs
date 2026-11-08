// Parent restore callbacks: the EXACT doReplace/doMerge source from app.js runs in a vm with small
// doubles for the media side; TT is either the real production tabletop.js (native storage doubles)
// or a controlled mock. Synthetic data only; not a browser test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { boot } = require('./helpers/tt-dom-double.cjs');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('PASS', name); };
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const marker = app.indexOf('      // Tabletop restore outcome:');
const start = marker > 0 ? marker : app.indexOf('      const doReplace = () => {'), end = app.indexOf('      if (hasCurrent) {', start);
assert(start > 0 && end > start, 'callback region found');
const region = app.slice(start, end);
const KEY = 'media-tracker-v1:tabletop';
const OLD = { id: 'old', title: 'Old game', subtype: 'board', dateUpdated: '2026-01-01T00:00:00.000Z' };
const NEW = { id: 'new', title: 'Backup game', subtype: 'board', dateUpdated: '2026-02-01T00:00:00.000Z' };

function harness({ TT, tabletop, mediaFails = false, mediaThrows = false }) {
  const toasts = [], media = { items: [{ id: 'm-old' }] };
  const ctx = {
    TT, parsed: { items: [{ id: 'm-new' }], tabletop, coverQueueIds: [] }, answers: undefined,
    get items() { return media.items; },
    incoming: [{ id: 'm-new' }],
    commitItems: (mutate) => { if (mediaThrows) throw new Error('bad'); if (mediaFails) return false; const n = mutate(media.items); if (Array.isArray(n)) media.items = n; return true; },
    mergeItems: (list, inc) => ({ items: list.concat(inc), added: inc.length, updated: 0 }),
    closeConfirm() {}, restoreCoverQueue() {}, render() {}, showToast: (m) => toasts.push(m),
    countLabel: (n, k) => `${n} ${k === 'item' ? (n === 1 ? 'item' : 'items') : (n === 1 ? 'tabletop game' : 'tabletop games')}`,
  };
  ctx.both = (a, b) => `${ctx.countLabel(a, 'item')} and ${ctx.countLabel(b, 'tt')}`;
  vm.createContext(ctx);
  // `items`/`incoming` are free variables in the region; bind them via the context object.
  vm.runInContext(`var incoming = this.incoming; ${region.replace(/\bitems\.length\b/g, 'this.items.length')}; this.doReplace = doReplace; this.doMerge = doMerge;`, ctx);
  return { ctx, toasts, media };
}
const realTT = (failWrite) => { const t = boot([OLD], []); if (failWrite) { const orig = t.store.set.bind(t.store); t.store.set = (k, v) => { if (k === KEY) throw new Error('quota'); return orig(k, v); }; } return t; };
const SUCCESS = /^(Restored|Merged)/;

(async () => {
  for (const mode of ['replace', 'merge']) {
    const run = async (h) => { if (mode === 'replace') h.ctx.doReplace(); else await h.ctx.doMerge(); return h.toasts.at(-1); };
    {
      const t = realTT(true); const h = harness({ TT: t.tt, tabletop: [NEW] }); const msg = await run(h);
      check(`${mode}: media OK + real tabletop storage failure -> partial message, no full success / up-to-date`, () => { assert.match(msg, /Tabletop games couldn’t be restored, so your tabletop shelf is unchanged/); assert.doesNotMatch(msg, /already up to date|tabletop game[s]? *$/); assert.doesNotMatch(msg, /^Restored .* and .*tabletop/); });
      check(`${mode}: tabletop shelf really unchanged; media write stands (no pretend rollback)`, () => { assert.deepEqual(JSON.parse(t.store.get(KEY)).map(e => e.id), ['old']); assert(h.media.items.some(i => i.id === 'm-new')); assert.match(msg, mode === 'replace' ? /^Restored 1 item\./ : /^Items merged — 1 added\./); });
    }
    {
      const h = harness({ TT: { restore: () => { throw new Error('boom'); }, count: () => 0, previewHandMatches: () => [] }, tabletop: [NEW] });
      const msg = await run(h);
      check(`${mode}: TT.restore exception -> partial message, no crash`, () => assert.match(msg, /couldn’t be restored/));
    }
    {
      const h = harness({ TT: { restore: () => null, count: () => 1, previewHandMatches: () => [] }, tabletop: [NEW] }); const msg = await run(h);
      check(`${mode}: mocked null result -> partial`, () => assert.match(msg, /couldn’t be restored/));
    }
    {
      const t = realTT(false); const h = harness({ TT: t.tt, tabletop: [NEW] }); const msg = await run(h);
      check(`${mode}: full success reports tabletop too`, () => { assert.match(msg, SUCCESS); assert.doesNotMatch(msg, /couldn’t/); assert(JSON.parse(t.store.get(KEY)).some(e => e.id === 'new')); });
    }
    {
      const t = realTT(false); const h = harness({ TT: t.tt, tabletop: [] }); const msg = await run(h);
      check(`${mode}: valid EMPTY tabletop block is a success, not a failure`, () => { assert.match(msg, SUCCESS); assert.doesNotMatch(msg, /couldn’t/); });
      if (mode === 'replace') check('replace with empty tabletop block empties the shelf (explicit Replace semantics)', () => assert.deepEqual(JSON.parse(t.store.get(KEY)), []));
    }
    {
      const t = realTT(false); const h = harness({ TT: t.tt, tabletop: null }); const msg = await run(h);
      check(`${mode}: missing tabletop block -> items-only success, shelf untouched`, () => { assert.match(msg, SUCCESS); assert.doesNotMatch(msg, /couldn’t/); assert.deepEqual(JSON.parse(t.store.get(KEY)).map(e => e.id), ['old']); });
    }
    {
      let called = 0; const h = harness({ TT: { restore: () => { called++; return {}; }, count: () => 0, previewHandMatches: () => [] }, tabletop: [NEW], mediaFails: true }); await run(h);
      check(`${mode}: media failure -> no tabletop write, no success toast`, () => { assert.equal(called, 0); assert(!h.toasts.some(m => SUCCESS.test(m))); });
    }
    {
      let called = 0; const h = harness({ TT: { restore: () => { called++; return {}; }, count: () => 0, previewHandMatches: () => [] }, tabletop: [NEW], mediaThrows: true }); await run(h);
      check(`${mode}: media exception -> truthful failure, nothing else written`, () => { assert.equal(called, 0); assert.equal(h.toasts.at(-1), 'Restore failed. Nothing was changed.'); });
    }
  }
  {
    const t = realTT(true); const h = harness({ TT: t.tt, tabletop: [NEW] }); await h.ctx.doMerge();
    const t2 = realTT(false); t2.store.set(KEY, t.store.get(KEY)); const h2 = harness({ TT: t2.tt, tabletop: [NEW] }); h2.media.items = h.media.items; await h2.ctx.doMerge();
    check('retry after partial merge: tabletop restored once, no duplicate game', () => { const ids = JSON.parse(t2.store.get(KEY)).map(e => e.id).sort(); assert.deepEqual(ids, ['new', 'old']); });
  }
  {
    const t = realTT(false);
    check('TT.restore with malformed input returns null and writes nothing', () => { assert.equal(t.tt.restore(null, 'merge'), null); assert.equal(t.tt.restore({ not: 'array' }, 'merge'), null); assert.deepEqual(JSON.parse(t.store.get(KEY)).map(e => e.id), ['old']); });
  }
  console.log(`${passed}/${passed} passed (exact app.js restore callbacks in vm; real or mocked TT.restore; native storage doubles; no browser claims)`);
})().catch(err => { console.error(err); process.exitCode = 1; });
