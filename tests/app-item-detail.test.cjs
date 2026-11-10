// Read-only media item detail (production app.js functions in a vm with native DOM/storage doubles;
// not a visual/browser test). Card click/keyboard -> detail -> explicit Edit -> existing edit form.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const { boot } = require('./helpers/tt-dom-double.cjs');
let passed = 0; const check = (n, fn) => { fn(); passed++; console.log('PASS', n); };
let focused = null;
class El {
  constructor(sel) { this.sel = sel; this.value = ''; this.hidden = true; this.style = {}; this.dataset = {}; this.children = []; this.attrs = {}; this.listeners = {}; this.innerHTML = ''; this.textContent = '';
    this.classList = { set: new Set(), add: (c) => this.classList.set.add(c), remove: (c) => this.classList.set.delete(c), toggle() {}, contains: (c) => this.classList.set.has(c) }; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); } removeEventListener() {}
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; } removeAttribute(k) { delete this.attrs[k]; }
  querySelector(s) { if (s === '.tt-detail-cover img') { if (!/tt-detail-cover/.test(this.innerHTML)) return null; const img = new El('img'); img.closest = () => ({ remove: () => { this.innerHTML = this.innerHTML.replace(/<span class="tt-detail-cover">.*?<\/span>/, ''); } }); this.coverImg = img; return img; } return new El(s); }
  querySelectorAll() { return []; } appendChild() {} remove() {} insertBefore() {} append() {} focus() { focused = this; } closest() { return new El(); } getBoundingClientRect() { return { width: 400, height: 800, top: 0, bottom: 800 }; }
}
const els = new Map(); const el = (s) => { if (!els.has(s)) els.set(s, new El(s)); return els.get(s); };
const t = boot([], []); const store = t.store; const writes = [];
const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { writes.push(k); store.set(k, String(v)); }, removeItem: (k) => { writes.push(k); store.delete(k); } };
const body = new El('body');
const ctx = { MutationObserver: class { observe() {} }, document: { querySelector: el, querySelectorAll: () => [], getElementById: (id) => el('#' + id), createElement: () => new El(), addEventListener() {}, body, documentElement: new El(), visibilityState: 'visible', get activeElement() { return focused; } }, localStorage, sessionStorage: { getItem: () => null, setItem() {} }, navigator: {}, location: { hostname: 'freerangeice.github.io', origin: 'https://freerangeice.github.io', href: 'https://freerangeice.github.io/media-shelf/' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0, URL, URLSearchParams, AbortController, console, crypto: globalThis.crypto, performance, FRMTabletop: t.tt, fetch: () => { throw new Error('no network in tests'); } };
ctx.window = ctx; ctx.globalThis = ctx;
// release check uses querySelector(".modal:not([hidden])"): report the detail modal state
const realQS = ctx.document.querySelector; ctx.document.querySelector = (s) => s === '.modal:not([hidden])' ? (['#item-detail-modal', '#modal'].some((k) => !el(k).hidden) ? el('#item-detail-modal') : null) : realQS(s);
let src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const tail = '\n  init();\n})();'; assert(src.includes(tail));
src = src.replace(tail, `\n  render = () => {};\n  const realOpenModal = openModal; openModal = (item, ...a) => { globalThis.__opened.push(item); els.modal.hidden = false; lastFocus = document.activeElement; };\n  globalThis.__app = { normalizeItem, setItems: (v) => { items = v; }, onListClick, onListKeydown, closeDetail, editFromDetail, detailHtml, getEditingId: () => editingId, getLastFocus: () => lastFocus };\n})();`);
vm.createContext(ctx); vm.runInContext(src, ctx);
const appSrc = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
ctx.__opened = []; const A = ctx.__app;
const raw = [
  { id: 'b1', type: 'book', title: 'Dune <b>', creator: 'Frank Herbert', year: 1965, status: 'done', rating: 4, format: 'physical', coverUrl: 'https://img.example/b.jpg', coverSource: 'googlebooks', googleBooksUrl: 'https://books.google.com/books?id=x', tags: ['sf', '<x>'], notes: 'n"1', barcode: '9780441013593' },
  { id: 'g1', type: 'game', title: 'Celeste', creator: 'Maddy', year: 2018, status: 'owned', format: 'digital', platform: 'switch', playtimeMinutes: 90, progress: 'Ch 3' },
  { id: 'm1', type: 'movie', title: 'Alien', year: 1979, status: 'owned', format: 'physical', disc: 'blu-ray' },
  { id: 'u1', type: 'music', title: 'Blue', creator: 'Joni Mitchell', status: 'want', format: 'physical', coverUrl: 'https://img.example/u.jpg' },
  { id: 'c1', type: 'comic', series: 'Saga', issue: '1', writer: 'BKV', artist: 'Fiona Staples', publisher: 'Image', status: 'owned', format: 'physical', coverLabel: 'Cover A' },
];
const items = raw.map(A.normalizeItem); A.setItems(items);
const stored = JSON.stringify({ version: 1, items }); store.set('media-tracker-v1', stored);
const card = (id) => { const c = new El('card'); c.dataset.id = id; return c; };
const target = (c) => ({ closest: (s) => (s === '.item-card' ? c : null) });
const modal = el('#item-detail-modal'), bodyEl = el('#item-detail-body');
const html = {};
for (const it of items) {
  const c = card(it.id); focused = c; writes.length = 0;
  A.onListClick({ target: target(c) });
  html[it.id] = bodyEl.innerHTML; html[it.id + ':title'] = el('#item-detail-title').textContent;
  check(`${it.type}: click opens read-only detail (title, focus on heading, edit form untouched, no writes)`, () => {
    assert.equal(modal.hidden, false); assert.equal(modal.attrs['aria-hidden'], 'false'); assert(body.classList.contains('modal-open'));
    assert.equal(focused, el('#item-detail-title')); assert.equal(el('#modal').hidden, true); assert.equal(A.getEditingId(), null);
    assert.doesNotMatch(bodyEl.innerHTML, /<(input|select|textarea|button)\b/); assert.equal(writes.length, 0);
  });
  A.closeDetail();
  check(`${it.type}: close hides, returns focus to card, no writes`, () => { assert.equal(modal.hidden, true); assert.equal(focused, c); assert.equal(writes.length, 0); assert.equal(store.get('media-tracker-v1'), stored); });
}
check('keyboard Enter/Space open detail; other keys and links do not', () => {
  for (const key of ['Enter', ' ']) { const c = card('m1'); let pd = 0; A.onListKeydown({ key, target: target(c), preventDefault: () => pd++ }); assert.equal(modal.hidden, false); assert.equal(pd, 1); A.closeDetail(); }
  A.onListKeydown({ key: 'a', target: target(card('m1')), preventDefault() {} }); assert.equal(modal.hidden, true);
  A.onListKeydown({ key: 'Enter', target: { closest: (s) => (s === 'a, .btn-pick-cover' ? {} : card('m1')) }, preventDefault() {} }); assert.equal(modal.hidden, true);
  A.onListClick({ target: { closest: (s) => (s.startsWith('a.card-ref') ? {} : card('m1')) } }); assert.equal(modal.hidden, true);
});
check('book: saved cover, metadata, refs, Google Books credit; all escaped', () => {
  const h = html.b1; assert.match(h, /<span class="tt-detail-cover"><img src="https:\/\/img\.example\/b\.jpg" alt="" referrerpolicy="no-referrer" \/>/);
  assert.match(h, /Frank Herbert\u00a0· 1965/); assert.match(h, /Rating/); assert.match(h, /Barcode<\/span> 9780441013593/); assert.match(h, /sf, &lt;x&gt;/); assert.match(h, /n&quot;1/); assert.match(h, />ISFDB</); assert.match(h, /Cover from Google Books/);
  assert.doesNotMatch(h, /<x>|<b>/);
});
check('game: platform in badge, play time, progress, IGDB; no cover frame', () => { const h = html.g1; assert.match(h, /Play time<\/span> 90 min/); assert.match(h, /Progress<\/span> Ch 3/); assert.match(h, />IGDB</); assert.doesNotMatch(h, /tt-detail-cover/); });
check('movie: disc in badge, IMDb; empty rows omitted', () => { const h = html.m1; assert.match(h, /Blu-ray/i); assert.match(h, />IMDb</); assert.doesNotMatch(h, /Rating|Barcode|Tags|Progress|Play time|ISFDB|IGDB/); });
check('music: cover; no book/movie/game refs', () => { const h = html.u1; assert.match(h, /tt-detail-cover/); assert.doesNotMatch(h, /card-ref/); });
check('comic: writer/artist/publisher, cover name; title is series #issue', () => { const h = html.c1; assert.match(h, /BKV, Fiona Staples\u00a0· Image/); assert.match(h, /Cover<\/span> Cover A/); assert.equal(html['c1:title'], 'Saga #1'); assert.equal(html['b1:title'], 'Dune <b>'); });
check('broken cover removes the frame (no empty/broken frame)', () => {
  const c = card('u1'); A.onListClick({ target: target(c) }); const img = bodyEl.coverImg; assert(img); img.listeners.error[0](); assert.doesNotMatch(bodyEl.innerHTML, /tt-detail-cover/); assert.match(bodyEl.innerHTML, /tt-detail-badges/); A.closeDetail();
});
const appSrc0 = 1;
check('explicit Edit calls the existing openModal(item) edit route for the same item (openModal itself recorded, not run: DOM-heavy), Delete stays there, focus returns to card', () => {
  const c = card('b1'); focused = c; A.onListClick({ target: target(c) }); writes.length = 0;
  A.editFromDetail();
  assert.equal(modal.hidden, true); assert.equal(el('#modal').hidden, false);
  assert.equal(ctx.__opened.length, 1); assert.equal(ctx.__opened[0], items[0]); // the existing openModal(item) edit route, same object/id
  assert.match(appSrc, /els\.btnDelete\.hidden = !item;/); assert.match(appSrc, /els\.fieldId\.value = item \? item\.id : "";/);
  assert.equal(A.getLastFocus(), c); assert.equal(writes.length, 0);
});
const idx = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
check('wiring: list uses the tested handlers; Escape and focus trap cover the detail; dialog markup', () => {
  assert.match(appSrc, /els\.list\.addEventListener\("click", onListClick\);/); assert.match(appSrc, /els\.list\.addEventListener\("keydown", onListKeydown\);/);
  assert.match(appSrc, /if \(!\$\("#item-detail-modal"\)\.hidden\) closeDetail\(\);/); assert.match(appSrc, /trapFocus\(e, \$\("\.modal-panel", \$\("#item-detail-modal"\)\)\)/);
  assert.match(idx, /id="item-detail-modal" class="modal" hidden aria-hidden="true"/); assert.match(idx, /role="dialog" aria-modal="true" aria-labelledby="item-detail-title"/);
  assert.match(idx, /id="tt-detail-modal"/); assert.match(appSrc, /GAME_TITLE_SEARCH_TESTED = (true|false)/);
});
console.log(`${passed}/${passed} passed (production app.js detail functions; native DOM doubles; no visual/browser claims)`);
