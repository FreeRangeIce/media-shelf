// Fresh-profile seed gate (native): empty storage must seed without throw; non-empty must not
// re-seed. Reproduces the rev4 "save is not defined" crash path. No browser/Playwright.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { boot } = require('./helpers/tt-dom-double.cjs');

let passed = 0;
const check = async (n, fn) => { await fn(); passed++; console.log('PASS', n); };
const errors = [];
const seedJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/seed.json'), 'utf8'));
const sample = {
  id: 'seed-tt-1',
  title: 'Sample Board Game',
  subtype: 'board',
  status: 'owned',
  year: '2024',
  designer: 'Sample Designer',
  players: '2–4',
  playTime: '45 min',
  coverUrl: './assets/sample-tabletop-cover.svg',
  notes: 'Made-up sample for layout review. Not a real product.',
  seed: true,
};

(async () => {
  await check('TT.seedSampleIfEmpty on empty shelf commits via commit() (no save ReferenceError)', () => {
    const t = boot([], []);
    const before = errors.length;
    const ok = t.tt.seedSampleIfEmpty(sample);
    assert.equal(ok, true);
    assert.equal(errors.length, before);
    const rows = t.saved();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Sample Board Game');
    assert.equal(rows[0].seed, true);
    assert.equal(rows[0].coverUrl, './assets/sample-tabletop-cover.svg');
    assert.equal(rows[0].bggId, '');
  });

  await check('non-empty tabletop shelf is not given a sample', () => {
    const t = boot([{ id: 'real-1', title: 'User Game', subtype: 'board', status: 'owned', dateAdded: '2026-01-01T00:00:00.000Z', dateUpdated: '2026-01-01T00:00:00.000Z' }], []);
    assert.equal(t.tt.seedSampleIfEmpty(sample), false);
    assert.equal(t.saved().length, 1);
    assert.equal(t.saved()[0].title, 'User Game');
  });

  await check('clearSeeds removes only seeded rows', () => {
    const t = boot([], []);
    assert.equal(t.tt.seedSampleIfEmpty(sample), true);
    assert.equal(t.tt.clearSeeds(), true);
    assert.equal(t.saved().length, 0);
  });

  await check('fresh app seedIfEmpty seeds media + tabletop sample; no throw/console.error', async () => {
    const t = boot([], []);
    const store = t.store;
    const cons = { ...console, error: (...a) => errors.push(a), warn: () => {} };
    const seedFile = JSON.stringify(seedJson);
    class El {
      constructor() {
        this.value = ''; this.hidden = true; this.style = {}; this.dataset = {}; this.children = [];
        this.innerHTML = ''; this.textContent = ''; this.attrs = {}; this.listeners = {};
        this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
        this.options = [];
      }
      addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
      removeEventListener() {}
      setAttribute(k, v) { this.attrs[k] = String(v); }
      getAttribute(k) { return this.attrs[k] ?? null; }
      removeAttribute(k) { delete this.attrs[k]; }
      querySelector() { return new El(); }
      querySelectorAll() { return []; }
      appendChild() {}
      focus() {}
      closest() { return new El(); }
      getBoundingClientRect() { return { width: 400, height: 800, top: 0, bottom: 800 }; }
      remove() {}
    }
    const els = new Map();
    const el = (s) => { if (!els.has(s)) els.set(s, new El()); return els.get(s); };
    const localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    const ctx = {
      MutationObserver: class { observe() {} },
      document: {
        querySelector: el, querySelectorAll: () => [], getElementById: (id) => el('#' + id),
        createElement: () => new El(), addEventListener() {}, body: new El(), documentElement: new El(),
        visibilityState: 'visible',
      },
      localStorage, sessionStorage: { getItem: () => null, setItem() {} },
      navigator: {}, location: { hostname: 'freerangeice.github.io', origin: 'https://freerangeice.github.io', href: 'https://freerangeice.github.io/media-shelf/' },
      addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
      setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
      requestAnimationFrame: () => 0, URL, URLSearchParams, AbortController, console: cons,
      crypto: globalThis.crypto, performance, FRMTabletop: t.tt,
      fetch: async (url) => {
        if (String(url).includes('seed.json')) {
          return { ok: true, status: 200, json: async () => JSON.parse(seedFile) };
        }
        throw new Error('unexpected fetch ' + url);
      },
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    let src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    const tail = '\n  init();\n})();';
    assert(src.includes(tail));
    src = src.replace(tail, `\n  render = () => {};\n  globalThis.__app = { seedIfEmpty, getItems: () => items, normalizeItem };\n})();`);
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    const before = errors.length;
    await ctx.__app.seedIfEmpty();
    assert.equal(errors.length, before, 'no console.error during seedIfEmpty');
    const media = ctx.__app.getItems();
    assert.ok(media.length >= 9, 'media samples seeded');
    assert.ok(media.every((i) => i.seed === true));
    const byType = Object.fromEntries(['book', 'game', 'movie'].map((ty) => [ty, media.filter((i) => i.type === ty).length]));
    assert.ok(byType.book >= 1 && byType.game >= 1 && byType.movie >= 1);
    assert.equal(t.tt.hasSeed(), true);
    const ttRows = t.tt.entries();
    assert.equal(ttRows.length, 1);
    assert.equal(ttRows[0].title, 'Sample Board Game');
    assert.match(ttRows[0].coverUrl, /sample-tabletop-cover\.svg$/);
    // Open Tabletop detail for the sample (production openDetail).
    t.tt.show(true);
    t.tt.render();
    t.F('tabletop-list').trigger('keydown', {
      key: 'Enter',
      target: { matches: () => true, dataset: { ttOpen: ttRows[0].id } },
    });
    assert.equal(t.F('tt-detail-modal').hidden, false);
    assert.match(t.F('tt-detail-body').innerHTML, /Sample Designer|2024|Owned|board/i);
    assert.equal(t.F('tt-detail-title').textContent, 'Sample Board Game');
  });

  await check('existing media store is not re-seeded with samples', async () => {
    const t = boot([{ id: 'keep', title: 'Keep Me', subtype: 'board', status: 'owned', dateAdded: '2026-01-01T00:00:00.000Z', dateUpdated: '2026-01-01T00:00:00.000Z' }], []);
    // Pre-existing media store with one real item and seeded flag already set.
    const real = { id: 'u1', type: 'book', title: 'User Book', creator: 'A', status: 'owned', format: 'physical', dateAdded: '2026-01-01T00:00:00.000Z', dateUpdated: '2026-01-01T00:00:00.000Z', seed: false };
    t.store.set('media-tracker-v1', JSON.stringify({ version: 1, items: [real] }));
    t.store.set('media-shelf-seeded', '2026-01-01T00:00:00.000Z');
    class El { constructor() { this.value = ''; this.hidden = true; this.style = {}; this.dataset = {}; this.innerHTML = ''; this.textContent = ''; this.attrs = {}; this.listeners = {}; this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; this.options = []; } addEventListener() {} setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; } removeAttribute(k) { delete this.attrs[k]; } querySelector() { return new El(); } querySelectorAll() { return []; } appendChild() {} focus() {} closest() { return new El(); } getBoundingClientRect() { return { width: 0, height: 0, top: 0, bottom: 0 }; } remove() {} }
    const els = new Map(); const el = (s) => { if (!els.has(s)) els.set(s, new El()); return els.get(s); };
    const localStorage = { getItem: (k) => (t.store.has(k) ? t.store.get(k) : null), setItem: (k, v) => t.store.set(k, String(v)), removeItem: (k) => t.store.delete(k) };
    const ctx = { MutationObserver: class { observe() {} }, document: { querySelector: el, querySelectorAll: () => [], getElementById: (id) => el('#' + id), createElement: () => new El(), addEventListener() {}, body: new El(), documentElement: new El(), visibilityState: 'visible' }, localStorage, sessionStorage: { getItem: () => null, setItem() {} }, navigator: {}, location: { hostname: 'freerangeice.github.io', origin: 'https://freerangeice.github.io', href: 'https://freerangeice.github.io/media-shelf/' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0, URL, URLSearchParams, AbortController, console, crypto: globalThis.crypto, performance, FRMTabletop: t.tt, fetch: async () => { throw new Error('seed.json must not be fetched when a store exists'); } };
    ctx.window = ctx; ctx.globalThis = ctx;
    let src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
    src = src.replace('\n  init();\n})();', `\n  render = () => {};\n  globalThis.__app = { seedIfEmpty, getItems: () => items };\n})();`);
    vm.createContext(ctx); vm.runInContext(src, ctx);
    await ctx.__app.seedIfEmpty();
    assert.equal(ctx.__app.getItems().length, 1);
    assert.equal(ctx.__app.getItems()[0].title, 'User Book');
    assert.equal(t.tt.entries().length, 1);
    assert.equal(t.tt.entries()[0].title, 'Keep Me');
  });

  // Source-level: helpers must use commit, never save(
  const ttSrc = fs.readFileSync(path.join(__dirname, '../tabletop.js'), 'utf8');
  await check('seed helpers call commit, not save', () => {
    assert.match(ttSrc, /seedSampleIfEmpty[\s\S]*commit\(\(\) => \[row\]\)/);
    assert.doesNotMatch(ttSrc, /save\(entries\)/);
  });

  console.log(`${passed}/${passed} passed (fresh-profile seed gate; native DOM doubles; no browser)`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
