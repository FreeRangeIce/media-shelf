// Shared native DOM/localStorage doubles that boot the PRODUCTION tabletop.js (not a browser).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../tabletop.js'), 'utf8');
const tick = () => new Promise(r => setImmediate(r));
function boot(seed, things, upcCandidate) {
  const els = new Map(), store = new Map(), fetches = [], created = [];
  class El {
    constructor(id) { this.id = id; this.value = ''; this.hidden = id === 'tt-form-modal' || id === 'tt-detail-modal'; this.listeners = {}; this.attrs = {}; this.innerHTML = ''; this.textContent = ''; this.dataset = {}; this.style = {}; this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; this.options = []; this.children = []; }
    setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { delete this.attrs[k]; } getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); } removeEventListener() {}
    after() {} before() {} append() {} appendChild(c) { return c; } replaceWith() {} remove() {} insertAdjacentHTML() {}
    closest() { return new El('closest'); } focus() {} blur() {} scrollIntoView() {} matches() { return false; }
    querySelector() { return new El('q'); } querySelectorAll() { return []; } contains() { return false; }
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; }
    trigger(k, ev = {}) { for (const fn of this.listeners[k] || []) fn({ target: this, currentTarget: this, preventDefault() {}, ...ev }); }
  }
  const F = id => { if (!els.has(id)) els.set(id, new El(id)); return els.get(id); };
  // Elements built from HTML strings exist only once their markup has been assigned.
  const built = new Set();
  const byId = id => (/^tt-(bgg-go|bgg-panel|upc-|lookup)/.test(id) && !built.has(id)) ? null : F(id);
  const mk = t => { const e = new El(t); created.push(e); let h = ''; Object.defineProperty(e, 'innerHTML', { get: () => h, set: v => { h = v; for (const m of String(v).matchAll(/id="([^"]+)"/g)) built.add(m[1]); } }); return e; };
  const document = { getElementById: byId, querySelector: s => s.startsWith('#') ? F(s.slice(1)) : new El('q'), querySelectorAll: () => [], createElement: mk, addEventListener() {}, body: new El('body'), activeElement: null, documentElement: new El('html') };
  store.set('media-tracker-v1:tabletop', JSON.stringify(seed));
  let getHook = null;
  const localStorage = { getItem: k => { if (getHook) getHook(k); return store.has(k) ? store.get(k) : null; }, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const fetch = async (url, opts = {}) => { fetches.push({ url, method: opts.method || 'GET' }); return { ok: true, status: 200, headers: { get: () => null }, json: async () => (String(url).includes('/barcode?') ? { status: 'choose', candidates: [upcCandidate] } : { things }) }; };
  const win = { document, localStorage, fetch, location: { hostname: 'freerangeice.github.io', origin: 'https://freerangeice.github.io' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), setTimeout, clearTimeout, requestAnimationFrame: fn => setTimeout(fn, 0), AbortController, URL, console, crypto: globalThis.crypto };
  win.window = win; win.globalThis = win;
  vm.createContext(win); vm.runInContext(source, win);
  const toasts = [];
  win.FRMTabletop.init({ toast: t => toasts.push(t), renderStats() {} });
  const panelClick = dataset => F('tt-bgg-panel').trigger('click', { target: { closest: () => ({ dataset }) } });
  return { setGetHook: fn => { getHook = fn; }, F, store, fetches, toasts, tt: win.FRMTabletop, panelClick, upcClick: dataset => created.find(e => e.id === 'tt-upc').trigger('click', { target: { closest: () => ({ dataset }) } }),
    edit: id => { F('tt-detail-edit').dataset.id = id; F('tt-detail-edit').trigger('click'); },
    saved: () => JSON.parse(store.get('media-tracker-v1:tabletop')) };
}
module.exports = { boot, tick };
