// Boots the REAL app.js (media storage, commitItems, saveStore + comic shadow, mergeItems, recovery,
// importJson, restore callbacks) with the REAL tabletop.js, on native storage doubles. Only page UI
// plumbing (toast, confirm sheet, render, cover queue) is replaced, after app.js defines it. No network.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { boot } = require('./tt-dom-double.cjs');
const MEDIA = 'media-tracker-v1', SHADOW = MEDIA + ':comics', TABLE = MEDIA + ':tabletop';
function bootApp() {
  const t = boot([], []), store = t.store, toasts = [], ops = [];
  let policy = null;
  const rawSet = store.set.bind(store), rawDel = store.delete.bind(store);
  // One storage map for media AND tabletop keys, with one fault policy and one operation log.
  store.set = (k, v) => { ops.push(['set', k]); if (policy) policy(k, 'set'); return rawSet(k, v); };
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => { ops.push(['remove', k]); if (policy) policy(k, 'remove'); rawDel(k); } };
  class El { constructor() { this.value = ''; this.hidden = true; this.style = {}; this.dataset = {}; this.children = []; this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; } addEventListener() {} removeEventListener() {} setAttribute() {} removeAttribute() {} querySelector() { return new El(); } querySelectorAll() { return []; } appendChild() {} focus() {} closest() { return new El(); } getBoundingClientRect() { return { width: 400, height: 800, top: 0, bottom: 800 }; } }
  const els = new Map(); const el = s => { if (!els.has(s)) els.set(s, new El()); return els.get(s); };
  class FileReader { readAsText(f) { this.result = f.content; this.onload(); } }
  const ctx = { MutationObserver: class { observe() {} }, document: { querySelector: el, querySelectorAll: () => [], getElementById: el, createElement: () => new El(), addEventListener() {}, body: new El(), documentElement: new El(), visibilityState: 'visible' }, localStorage, sessionStorage: { getItem: () => null, setItem() {} }, navigator: {}, location: { hostname: 'freerangeice.github.io', origin: 'https://freerangeice.github.io', href: 'https://freerangeice.github.io/media-shelf/' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, URL, URLSearchParams, AbortController, FileReader, console, crypto: globalThis.crypto, performance, FRMTabletop: t.tt, fetch: () => { throw new Error('no network in tests'); }, __toasts: toasts };
  ctx.window = ctx; ctx.globalThis = ctx;
  let src = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
  const tail = '\n  init();\n})();'; assert(src.includes(tail), 'app.js init tail');
  src = src.replace(tail, `\n  showToast = (m) => globalThis.__toasts.push(m);\n  openConfirm = (title, desc, ok, label, opts) => { globalThis.__pending = { ok, opts }; };\n  closeConfirm = () => {}; render = () => {}; restoreCoverQueue = () => {};\n  globalThis.__app = { normalizeItem, importJson, syncFromStorage, applyComicRepair, commitItems, commitClz, setClz: (v) => { clz = v; }, getItems: () => items, setItems: (v) => { items = v; }, setSynced: (v) => { lastSyncedRaw = v; } };\n})();`);
  vm.createContext(ctx); vm.runInContext(src, ctx);
  const api = ctx.__app;
  return {
    api, t, store, toasts, ops, el, rawSet, MEDIA, SHADOW, TABLE, setPolicy: p => { policy = p; },
    seed(items, tt = []) { const rows = items.map(api.normalizeItem); const raw = JSON.stringify({ version: 1, items: rows }); rawSet(MEDIA, raw); rawSet(TABLE, JSON.stringify(tt)); rawDel(SHADOW); api.setItems(rows); api.setSynced(raw); ops.length = 0; toasts.length = 0; },
    async restore(mode, backup) { ctx.__pending = null; api.importJson({ size: JSON.stringify(backup).length, content: JSON.stringify(backup) }); assert(ctx.__pending, 'restore confirm opened'); if (mode === 'replace') await ctx.__pending.ok(); else await ctx.__pending.opts.onAlt(); },
    mediaIds: () => JSON.parse(store.get(MEDIA)).items.map(i => i.id).sort(),
    ttIds: () => JSON.parse(store.get(TABLE)).map(e => e.id).sort(),
    posts: () => t.fetches.filter(f => f.method === 'POST').length,
  };
}
module.exports = { bootApp };
