// Saved-entry regressions through the PRODUCTION tabletop.js UI code (openForm/readForm/saveForm/
// mergeUpdate/commit) with native DOM and localStorage doubles. Synthetic data; not a browser/device test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('PASS', name); };
const source = fs.readFileSync(path.join(__dirname, '../tabletop.js'), 'utf8');
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
  const localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const fetch = async (url, opts = {}) => { fetches.push({ url, method: opts.method || 'GET' }); return { ok: true, status: 200, headers: { get: () => null }, json: async () => (String(url).includes('/barcode?') ? { status: 'choose', candidates: [upcCandidate] } : { things }) }; };
  const win = { document, localStorage, fetch, location: { hostname: 'freerangeice.github.io', origin: 'https://freerangeice.github.io' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), setTimeout, clearTimeout, requestAnimationFrame: fn => setTimeout(fn, 0), AbortController, URL, console, crypto: globalThis.crypto };
  win.window = win; win.globalThis = win;
  vm.createContext(win); vm.runInContext(source, win);
  const toasts = [];
  win.FRMTabletop.init({ toast: t => toasts.push(t), renderStats() {} });
  const panelClick = dataset => F('tt-bgg-panel').trigger('click', { target: { closest: () => ({ dataset }) } });
  return { F, store, fetches, toasts, tt: win.FRMTabletop, panelClick, upcClick: dataset => created.find(e => e.id === 'tt-upc').trigger('click', { target: { closest: () => ({ dataset }) } }),
    edit: id => { F('tt-detail-edit').dataset.id = id; F('tt-detail-edit').trigger('click'); },
    saved: () => JSON.parse(store.get('media-tracker-v1:tabletop')) };
}
const A = { id: 'g1', title: 'Old Game A', subtype: 'board', status: 'owned', bggId: '100', bggType: 'boardgame', year: '2001', designer: 'Designer A', players: '2–4', playTime: '60', coverUrl: 'https://cf.geekdo-images.com/a.jpg', notes: 'my notes', dateAdded: '2026-01-01T00:00:00.000Z' };
const B = { bggId: '200', bggType: 'boardgame', name: 'New Game B', year: '0', designer: '', players: '', playTime: '0', image: '', thumbnail: '' };

(async () => {
  {
    const t = boot([A], [B]);
    t.edit('g1');
    check('edit opens saved entry A', () => { assert.equal(t.F('tt-form-modal').hidden, false); assert.equal(t.F('tt-coverUrl').value, A.coverUrl); });
    t.F('tt-bggId').value = '200'; t.F('tt-form').trigger('input', { target: t.F('tt-bggId') });
    check('typing new ID B does not clear old details yet', () => { assert.equal(t.F('tt-coverUrl').value, A.coverUrl); assert.equal(t.F('tt-designer').value, 'Designer A'); });
    t.F('tt-bgg-go').trigger('click'); await tick(); await tick();
    check('lookup is a GET of /thing for B only; no GameUPC POST', () => { assert.equal(t.fetches.length, 1); assert.match(t.fetches[0].url, /\/thing\?ids=200$/); assert.equal(t.fetches[0].method, 'GET'); });
    t.panelClick({ bggPick: '1' }); t.panelClick({ bggUse: '1' });
    check('overwrite warning names the details that will be cleared', () => { assert.match(t.F('tt-bgg-panel').innerHTML, /Overwrite filled details/); assert.match(t.F('tt-bgg-panel').innerHTML, /This BGG result has no year, designer, players, play time, cover\. Those fields will be cleared to avoid mixing details from different games\./); assert.match(t.F('tt-bgg-panel').innerHTML, /cover/); assert.equal(t.F('tt-coverUrl').value, A.coverUrl); });
    t.panelClick({ bggBack: '1' });
    check('Cancel on overwrite clears nothing', () => { assert.equal(t.F('tt-coverUrl').value, A.coverUrl); assert.equal(t.F('tt-title').value, 'Old Game A'); assert.equal(t.F('tt-year').value, '2001'); });
    t.panelClick({ bggUse: '1' }); t.panelClick({ bggOverwrite: '1' });
    check('accepted Overwrite fills B and clears A-bound cover/details', () => { assert.equal(t.F('tt-title').value, 'New Game B'); assert.equal(t.F('tt-coverUrl').value, ''); assert.equal(t.F('tt-year').value, ''); assert.equal(t.F('tt-designer').value, ''); assert.equal(t.F('tt-playTime').value, ''); assert.equal(t.F('tt-notes').value, 'my notes'); });
    t.F('tt-form').trigger('submit');
    const s = t.saved().find(e => e.id === 'g1');
    check('Save stores B without A cover; notes kept', () => { assert.equal(s.bggId, '200'); assert.equal(s.coverUrl, ''); assert.equal(s.designer, ''); assert.equal(s.notes, 'my notes'); assert.equal(s.bggIsExpansion, false); assert.equal(t.saved().length, 1); });
    t.edit('g1');
    check('reopen shows no old-game cover', () => { assert.equal(t.F('tt-coverUrl').value, ''); assert.equal(t.F('tt-bggId').value, '200'); assert.equal(t.F('tt-title').value, 'New Game B'); });
    check('no GameUPC POST during whole flow', () => assert(t.fetches.every(f => f.method === 'GET')));
  }
  {
    const t = boot([A], [{ ...B, bggId: '100', name: 'Old Game A' }]);
    t.edit('g1'); t.F('tt-bgg-go').trigger('click'); await tick(); await tick(); t.panelClick({ bggPick: '1' }); t.panelClick({ bggUse: '1' });
    if (/Overwrite/.test(t.F('tt-bgg-panel').innerHTML)) t.panelClick({ bggOverwrite: '1' });
    t.F('tt-form').trigger('submit');
    check('same-ID result without image keeps existing cover (intentional retention)', () => assert.equal(t.saved()[0].coverUrl, A.coverUrl));
  }
  {
    const t = boot([], [B]);
    t.F('tt-empty-add').trigger('click'); t.F('tt-title').value = 'Hand typed'; t.F('tt-coverUrl').value = 'https://manual.example/c.jpg'; t.F('tt-bggId').value = '200';
    t.F('tt-bgg-go').trigger('click'); await tick(); await tick(); t.panelClick({ bggPick: '1' }); t.panelClick({ bggUse: '1' }); t.panelClick({ bggOverwrite: '1' });
    check('new manual entry with no prior BGG identity keeps manual cover', () => assert.equal(t.F('tt-coverUrl').value, 'https://manual.example/c.jpg'));
  }
  {
    const X = { ...A, id: 'x1', title: 'Shared', bggId: '300', bggType: 'boardgameexpansion', bggIsExpansion: true };
    const t = boot([X], [{ ...B, bggId: '300', name: 'Shared', bggType: 'boardgame' }]);
    t.F('tt-empty-add').trigger('click'); t.F('tt-bggId').value = '300';
    t.F('tt-bgg-go').trigger('click'); await tick(); await tick(); t.panelClick({ bggPick: '1' }); t.panelClick({ bggUse: '1' });
    t.F('tt-form').trigger('submit');
    check('duplicate prompt shown for same BGG id', () => assert.equal(t.F('tt-dup').hidden, false));
    t.F('tt-dup-update').trigger('click');
    const s = t.saved();
    check('duplicate Update with authoritative boardgame type replaces true flag with false', () => { assert.equal(s.length, 1); assert.equal(s[0].bggIsExpansion, false); assert.equal(s[0].bggType, 'boardgame'); });
  }
  {
    const X = { ...A, id: 'x1', title: 'Shared', bggId: '', bggType: '', bggIsExpansion: true };
    const t = boot([X], []);
    t.F('tt-empty-add').trigger('click'); t.F('tt-title').value = 'Shared'; t.F('tt-form').trigger('submit'); t.F('tt-dup-update').trigger('click');
    check('duplicate Update without type metadata keeps known true flag', () => assert.equal(t.saved()[0].bggIsExpansion, true));
  }
  // Mixed providers: saved A -> confirmed GameUPC pick B (fills only title/id/year) -> direct BGG X.
  const upcB = { bggId: '200', name: 'GameUPC Game B', year: '2025' };
  const upc = async t => { t.F('tt-barcode').value = '200000000001'; t.F('tt-upc-go').trigger('click'); await tick(); await tick(); t.upcClick({ upcPick: '0' }); t.upcClick({ upcConfirm: '1' }); assert.equal(t.F('tt-year').value, '2025'); };
  const direct = async (t, id, accept = true) => { t.F('tt-bggId').value = id; t.F('tt-form').trigger('input', { target: t.F('tt-bggId') }); t.F('tt-bgg-go').trigger('click'); await tick(); await tick(); t.panelClick({ bggPick: '1' }); t.panelClick({ bggUse: '1' }); const w = t.F('tt-bgg-panel').innerHTML; if (accept && /Overwrite filled/.test(w)) t.panelClick({ bggOverwrite: '1' }); return w; };
  {
    const t = boot([A], [{ ...B, bggId: '100', name: 'Old Game A' }], upcB); t.edit('g1'); await upc(t);
    const w = await direct(t, '100');
    check('A -> UPC B -> direct A (no year): warning names year only, no origin claim', () => { assert.match(w, /This BGG result has no year\. Those fields will be cleared to avoid mixing details from different games\./); assert.doesNotMatch(w, /previous BGG id/); });
    t.F('tt-form').trigger('submit'); const s = t.saved()[0];
    check('A -> UPC B -> direct A: B year does not survive save; A cover/details stay', () => { assert.equal(s.bggId, '100'); assert.equal(s.year, ''); assert.equal(s.coverUrl, A.coverUrl); assert.equal(s.designer, 'Designer A'); });
    t.edit('g1'); check('reopen A shows no B year', () => assert.equal(t.F('tt-year').value, ''));
  }
  {
    const t = boot([A], [B], upcB); t.edit('g1'); await upc(t);
    const w = await direct(t, '200');
    check('mixed chain lookups are GETs only (barcode + /thing)', () => assert(t.fetches.every(f => f.method === 'GET')));
    check('A -> UPC B -> direct B (no image): warning names A-bound fields, not B year', () => { assert.match(w, /has no designer, players, play time, cover\./); assert.doesNotMatch(w, /no year/); });
    t.F('tt-form').trigger('submit'); const s = t.saved()[0];
    check('A -> UPC B -> direct B: old A cover cleared, B year kept', () => { assert.equal(s.coverUrl, ''); assert.equal(s.designer, ''); assert.equal(s.year, '2025'); assert.equal(s.bggIsExpansion, false); });
    t.edit('g1'); check('reopen B shows no A cover', () => assert.equal(t.F('tt-coverUrl').value, ''));
  }
  {
    const t = boot([A], [{ ...B, bggId: '300', name: 'C' }], upcB); t.edit('g1'); await upc(t); await direct(t, '300'); t.F('tt-form').trigger('submit'); const s = t.saved()[0];
    check('A -> UPC B -> direct C: neither A cover nor B year survives', () => { assert.equal(s.coverUrl, ''); assert.equal(s.year, ''); });
  }
  {
    const t = boot([A], [B], upcB); t.edit('g1'); await upc(t); await direct(t, '200', false); t.panelClick({ bggBack: '1' });
    check('mixed chain: Cancel overwrite clears nothing', () => { assert.equal(t.F('tt-coverUrl').value, A.coverUrl); assert.equal(t.F('tt-year').value, '2025'); assert.equal(t.F('tt-designer').value, 'Designer A'); });
  }
  {
    const t = boot([A], [B]); t.edit('g1'); t.F('tt-year').value = '2030'; t.F('tt-form').trigger('input', { target: t.F('tt-year') });
    const w = await direct(t, '200');
    check('hand-edited year is kept and named as kept; A-bound fields cleared', () => { assert.match(w, /Kept as you typed: year\./); assert.doesNotMatch(w, /has no year/); assert.equal(t.F('tt-year').value, '2030'); assert.equal(t.F('tt-coverUrl').value, ''); });
  }
  const core = require('../tabletop.js');
  const old = core.normalize({ id: 'o', title: 'T', bggId: '5', bggType: 'boardgameexpansion', bggIsExpansion: true });
  check('pure merge: boardgame type -> false', () => assert.equal(core.mergeUpdate(old, { bggType: 'boardgame', bggIsExpansion: false }).bggIsExpansion, false));
  check('pure merge: expansion type -> true', () => assert.equal(core.mergeUpdate({ ...old, bggIsExpansion: false }, { bggType: 'boardgameexpansion' }).bggIsExpansion, true));
  check('pure merge: missing type + false keeps true (backup metadata gap)', () => assert.equal(core.mergeUpdate(old, { bggIsExpansion: false }).bggIsExpansion, true));
  check('pure merge: missing type + true sets true', () => assert.equal(core.mergeUpdate({ ...old, bggIsExpansion: false }, { bggIsExpansion: true }).bggIsExpansion, true));
  check('pure patch: identity change clears missing ID-bound fields; same ID keeps', () => { const r = { title: 'B', bggId: '2', bggType: 'boardgame', year: '', designer: '', players: '', playTime: '', coverUrl: '' }; assert.equal(core.bggIdPatch(r, '1').patch.coverUrl, ''); assert(!('coverUrl' in core.bggIdPatch(r, '2').patch)); assert(!('coverUrl' in core.bggIdPatch(r, '').patch)); });
  console.log(`${passed}/${passed} passed (production tabletop.js with native DOM/storage doubles; no browser/device/provider claims)`);
})().catch(err => { console.error(err); process.exitCode = 1; });
