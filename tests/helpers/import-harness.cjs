// Boots app.js (any version: the working tree or a source string from git) in a vm with the same
// storage/DOM doubles as app-real-media.cjs, and exposes the import mapping functions so a test can
// check how rows land. No network: fetch throws.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { boot } = require('./tt-dom-double.cjs');

const EXPOSE = [
  'normalizeItem', 'parseClzCsv', 'clzAutoMapping', 'clzCandidate', 'parseImportText', 'importCandidate',
  'CLZ_TYPES', 'CLZ_HEADER_ALIASES', 'clzScore',
];
const OPTIONAL = ['ENRICH', 'enrichPlanFor', 'enrichFillEmpty', 'enrichSummaryText', 'readEnrichQueue', 'writeEnrichQueue', 'enqueueEnrich', 'runEnrich', 'enrichSources', 'commitClz', 'commitImport', 'importJson', 'clzComicFormat', 'clzComicIssue', 'enrichOne', 'resumeEnrichOnOpen', 'renderEnrichUi', 'enrichAfterRestore', 'enrichMarked', 'detailHtml'];

function bootSource(src, { fetch, store: sharedStore, clock } = {}) {
  const t = boot([], []), toasts = [];
  const store = sharedStore || t.store;
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), key: i => [...store.keys()][i] ?? null, get length() { return store.size; } };
  class El { constructor() { this.value = ''; this.hidden = true; this.style = { setProperty() {} }; this.dataset = {}; this.children = []; this.textContent = ''; this.innerHTML = ''; this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; } addEventListener() {} removeEventListener() {} setAttribute() {} removeAttribute() {} getAttribute() { return null; } querySelector() { return new El(); } querySelectorAll() { return []; } appendChild() {} focus() {} closest() { return null; } getBoundingClientRect() { return { width: 400, height: 800, top: 0, bottom: 800, left: 0, right: 400 }; } getClientRects() { return []; } scrollIntoView() {} }
  const els = new Map(); const el = s => { if (!els.has(s)) els.set(s, new El()); return els.get(s); };
  const timers = [];
  const ctx = {
    MutationObserver: class { observe() {} }, document: { querySelector: el, querySelectorAll: () => [], getElementById: el, createElement: () => new El(), addEventListener() {}, body: new El(), documentElement: new El(), visibilityState: 'visible', hidden: false },
    localStorage, sessionStorage: { getItem: () => null, setItem() {} }, navigator: {}, location: { hostname: 'freerangeice.github.io', origin: 'https://freerangeice.github.io', href: 'https://freerangeice.github.io/media-shelf/' },
    addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},

    FileReader: class { readAsText(f) { this.result = f.content; this.onload(); } },
    URL, URLSearchParams, AbortController, console, crypto: globalThis.crypto, performance, FRMTabletop: t.tt, Headers: globalThis.Headers, Response: globalThis.Response,
    fetch: fetch || (() => { throw new Error('no network in tests'); }), __toasts: toasts,
  };
  if (clock) {
    // Fake clock: every timer fires on the next real tick and moves the clock forward by its delay,
    // so a run with 2 s gaps finishes in milliseconds. clock.now is shared with the test.
    const RealDate = Date;
    class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [clock.now])); } static now() { return clock.now; } }
    ctx.Date = FakeDate;
    ctx.setTimeout = (fn, ms) => { const id = ++clock.seq; clock.live.add(id); globalThis.setTimeout(() => { if (!clock.live.has(id)) return; clock.live.delete(id); clock.now += Math.max(0, Number(ms) || 0); fn(); }, 0); return id; };
    ctx.clearTimeout = (id) => { clock.live.delete(id); };
  }
  ctx.window = ctx; ctx.globalThis = ctx;
  const tail = '\n  init();\n})();'; assert(src.includes(tail), 'app.js init tail');
  const names = [...EXPOSE, ...OPTIONAL].map(n => `${n}: (typeof ${n} === 'undefined' ? undefined : ${n})`).join(', ');
  src = src.replace(tail, `\n  showToast = (m) => globalThis.__toasts.push(m);\n  render = () => {};\n  openConfirm = (title, desc, ok, label, opts) => { globalThis.__pending = { ok, opts }; };\n  closeConfirm = () => {};\n  globalThis.__app = { ${names}, getItems: () => items, setItems: (v) => { items = v; }, setSynced: (v) => { lastSyncedRaw = v; }, setClz: (v) => { clz = v; } };\n})();`);
  vm.createContext(ctx); vm.runInContext(src, ctx);
  const MEDIA = 'media-tracker-v1';
  return {
    api: ctx.__app, ctx, store, toasts, timers, el,
    seed(list) { const rows = list.map(ctx.__app.normalizeItem); const raw = JSON.stringify({ version: 1, items: rows }); store.set(MEDIA, raw); ctx.__app.setItems(rows); ctx.__app.setSynced(raw); return rows; },
    stored() { return JSON.parse(store.get(MEDIA)).items; },
    async restore(mode, backup) { ctx.__pending = null; ctx.__app.importJson({ size: JSON.stringify(backup).length, content: JSON.stringify(backup) }); assert(ctx.__pending, 'restore confirm opened'); if (mode === 'replace') await ctx.__pending.ok(); else await ctx.__pending.opts.onAlt(); },
  };
}
function makeClock(start = Date.parse('2026-11-14T10:00:00-08:00')) { return { now: start, seq: 0, live: new Set() }; }

function bootFile(file = path.join(__dirname, '../../app.js'), opts) { return bootSource(fs.readFileSync(file, 'utf8'), opts); }

/** Every CSV row -> exactly what the import would land (fixed id and dates), or its skip reason. */
function landClz(api, typeKey, csvText) {
  const parsed = api.parseClzCsv(csvText);
  if (parsed.error) return { error: parsed.error };
  const mapping = api.clzAutoMapping(typeKey, parsed.headers);
  const rows = parsed.rows.map((cells, i) => {
    const res = api.clzCandidate(typeKey, cells, mapping);
    const item = res.cand ? JSON.parse(JSON.stringify(api.normalizeItem({ ...res.cand, id: `row-${i + 2}`, dateAdded: '2026-11-14T00:00:00.000Z', dateUpdated: '2026-11-14T00:00:00.000Z', seed: false }))) : null;
    return res.skip ? { row: i + 2, skip: res.skip, item } : { row: i + 2, item };
  });
  return { headers: [...parsed.headers], mapping: JSON.parse(JSON.stringify(mapping)), rows };
}

function landGamesPaste(api, text, defs = { platform: '', status: 'want', format: 'digital' }) {
  const parsed = api.parseImportText(text);
  if (parsed.error) return { error: parsed.error };
  return parsed.rows.map((row) => row.error ? { line: row.line, error: row.error } : { line: row.line, item: JSON.parse(JSON.stringify(api.normalizeItem({ ...api.importCandidate(row, defs), id: `line-${row.line}`, dateAdded: '2026-11-14T00:00:00.000Z', dateUpdated: '2026-11-14T00:00:00.000Z', seed: false }))) });
}

module.exports = { bootSource, bootFile, landClz, landGamesPaste, makeClock };
