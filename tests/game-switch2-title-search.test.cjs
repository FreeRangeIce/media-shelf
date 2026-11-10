// Focused V2.3 checks: Switch 2 matching, mapExternalPlatform order, barcode compatibility,
// all-greyed-out message, results-list light-theme CSS, Use-button disabled/enabled styles.
// Native only — extracts production functions into a vm; mock fetch; no browser/network.
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
let passed = 0;
const check = async (n, fn) => { await fn(); passed++; console.log('PASS', n); };
const slice = (a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i); assert(i >= 0 && j > i, a); return src.slice(i, j); };

function loadMatchers() {
  const mapFn = slice('  function mapExternalPlatform(name) {', '\n  function titleFromBarcodeProduct');
  const matchFn = slice('  function gamePlatformMatches(platforms, selected) {', '\n  function resetGameLookup');
  const c = {};
  vm.createContext(c);
  vm.runInContext(mapFn + '\n' + matchFn + '\n;globalThis.mapExternalPlatform=mapExternalPlatform;globalThis.gamePlatformMatches=gamePlatformMatches;', c);
  return c;
}

const lookup = slice('  let gameBusy = false, gameSeq = 0', '  async function runLookup()');
const picker = slice('    const cancelGameOnEdit = e => {', '    els.btnLookup.addEventListener("click", () => runLookup());');
const flag = /const GAME_TITLE_SEARCH_TESTED = (true|false);/.exec(src)[1] === 'true';
const relayM = /const GAME_RELAY_URL = "([^"]+)"/.exec(src)[1];

function mk(fetchImpl, { barcodeHit } = {}) {
  const E = () => ({ value: '', hidden: true, disabled: false, innerHTML: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, focus() {}, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } });
  const map = new Map(); const $ = s => { if (!map.has(s)) map.set(s, E()); return map.get(s); };
  const els = { fieldType: E(), fieldBarcode: E(), fieldTitle: E(), fieldPlatform: E(), btnLookup: E(), modal: E(), form: E() };
  els.fieldType.value = 'game'; els.modal.hidden = false;
  const log = { status: [], commits: [], fetches: [] };
  const matchers = loadMatchers();
  const c = {
    els, $, $$: () => [], lookupBusy: false, GAME_TITLE_SEARCH_TESTED: flag, gameRelayUrl: () => relayM,
    URL, AbortController, Map, Number, Date, Math, String, Array, Boolean, setTimeout: () => 0, clearTimeout() {},
    escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    clearCoverChoices() {},
    mapExternalPlatform: matchers.mapExternalPlatform,
    gamePlatformMatches: matchers.gamePlatformMatches,
    setLookupStatus: (m, k) => log.status.push({ m, k }),
    commitLookup: (cand) => log.commits.push(cand),
    resolveGameBarcode: async () => barcodeHit || { title: 'Celeste', platform: '' },
    fetch: async (url, opts) => { log.fetches.push({ url, opts }); return fetchImpl(url, opts); },
  };
  vm.createContext(c);
  // Inject gamePlatformMatches into the lookup slice scope by defining it on the context
  // before running — the sliced lookup closes over gamePlatformMatches from app scope,
  // so redefine it on the context and prepend a binding the slice can see.
  const prelude = 'function gamePlatformMatches(platforms, selected){ return globalThis.gamePlatformMatches(platforms, selected); }\n';
  c.gamePlatformMatches = matchers.gamePlatformMatches;
  vm.runInContext(prelude + lookup + picker + ';globalThis.T={runGameLookup,resetGameLookup,get cands(){return gameCandidates}, get pick(){return gamePick}}', c);
  return { c, $, els, log, T: c.T, matchers };
}

const ok = body => async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
const MKW = { candidates: [{ igdbId: '12345', title: 'Mario Kart World', year: 2025, creator: 'Nintendo', platforms: ['Nintendo Switch 2'], coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg' }] };
const BOTH = { candidates: [{ igdbId: '1', title: 'Pokémon Scarlet', year: 2022, creator: 'Game Freak', platforms: ['Nintendo Switch', 'Nintendo Switch 2'], coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/cob.jpg' }] };
const SWITCH_ONLY = { candidates: [{ igdbId: '26226', title: 'Celeste', year: 2018, creator: 'Extremely OK Games', platforms: ['Nintendo Switch'], coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/cob9dh.jpg' }] };
const MIXED = { candidates: [
  { igdbId: '1', title: 'Mario Kart World', year: 2025, creator: 'Nintendo', platforms: ['Nintendo Switch 2'], coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/a.jpg' },
  { igdbId: '2', title: 'Celeste', year: 2018, creator: 'Extremely OK Games', platforms: ['Nintendo Switch'], coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/b.jpg' },
] };
const tgt = (sel, dataset) => ({ closest: s => (s === sel ? { dataset: dataset || { gamePick: '0' } } : null) });

(async () => {
  await check('V2.5 version + cache + title search stays on', () => {
    assert.match(src, /const APP_VERSION = "2.5";/);
    assert.match(sw, /const CACHE = "media-shelf-v2\.5"/);
    assert.match(src, /GAME_TITLE_SEARCH_TESTED = true/);
    assert.match(html, /option value="Switch 2"/);
    assert.match(src, /"Switch", "Switch 2"/);
  });

  await check('mapExternalPlatform: Switch 2 before Switch (substring bug fixed)', () => {
    const m = loadMatchers();
    assert.equal(m.mapExternalPlatform('Nintendo Switch 2'), 'Switch 2');
    assert.equal(m.mapExternalPlatform('nintendo switch 2'), 'Switch 2');
    assert.equal(m.mapExternalPlatform('Switch 2'), 'Switch 2');
    assert.equal(m.mapExternalPlatform('Nintendo Switch'), 'Switch');
    assert.equal(m.mapExternalPlatform('Switch'), 'Switch');
    assert.equal(m.mapExternalPlatform('nintendo switch'), 'Switch');
  });

  await check('gamePlatformMatches: Switch 2 accepts Switch + Switch 2; Switch stays strict', () => {
    const m = loadMatchers();
    assert.equal(m.gamePlatformMatches(['Nintendo Switch 2'], 'Switch 2'), true);
    assert.equal(m.gamePlatformMatches(['Nintendo Switch'], 'Switch 2'), true);
    assert.equal(m.gamePlatformMatches(['Nintendo Switch', 'Nintendo Switch 2'], 'Switch 2'), true);
    assert.equal(m.gamePlatformMatches(['Nintendo Switch'], 'Switch'), true);
    assert.equal(m.gamePlatformMatches(['Nintendo Switch 2'], 'Switch'), false, 'Switch is strict');
    assert.equal(m.gamePlatformMatches(['PlayStation 5'], 'Switch 2'), false);
    assert.equal(m.gamePlatformMatches(['Nintendo Switch 2'], ''), true, 'blank platform accepts all');
    assert.equal(m.gamePlatformMatches(['Nintendo Switch 2'], 'Other'), true);
  });

  await check('Mario Kart World (Switch 2 only): selectable with Switch 2, greyed with Switch', async () => {
    const t2 = mk(ok(MKW)); t2.els.fieldTitle.value = 'Mario Kart World'; t2.els.fieldPlatform.value = 'Switch 2';
    await t2.T.runGameLookup(true);
    assert.match(t2.$('#game-match-picker').innerHTML, /data-game-pick="0"(?![^>]*disabled)/);
    assert.doesNotMatch(t2.$('#game-match-picker').innerHTML, /Not listed for Switch 2/);
    assert.match(t2.log.status.at(-1).m, /Choose a match/);

    const t1 = mk(ok(MKW)); t1.els.fieldTitle.value = 'Mario Kart World'; t1.els.fieldPlatform.value = 'Switch';
    await t1.T.runGameLookup(true);
    assert.match(t1.$('#game-match-picker').innerHTML, /disabled/);
    assert.match(t1.$('#game-match-picker').innerHTML, /Not listed for Switch/);
    assert.match(t1.$('#game-match-picker').innerHTML, /game-match-platform-note/);
    assert.match(t1.log.status.at(-1).m, /None of these are listed for Switch/);
    assert.notEqual(t1.log.status.at(-1).k, 'error');
    assert.equal(t1.els.fieldTitle.value, 'Mario Kart World');
  });

  await check('Celeste (Switch only): selectable on Switch and Switch 2', async () => {
    for (const plat of ['Switch', 'Switch 2']) {
      const t = mk(ok(SWITCH_ONLY)); t.els.fieldTitle.value = 'Celeste'; t.els.fieldPlatform.value = plat;
      await t.T.runGameLookup(true);
      assert.doesNotMatch(t.$('#game-match-picker').innerHTML, /Not listed for/);
      assert.match(t.log.status.at(-1).m, /Choose a match/);
    }
  });

  await check('mixed list: Switch 2-only row greyed under Switch; Switch row stays selectable', async () => {
    const t = mk(ok(MIXED)); t.els.fieldTitle.value = 'kart'; t.els.fieldPlatform.value = 'Switch';
    await t.T.runGameLookup(true);
    const htmlPanel = t.$('#game-match-picker').innerHTML;
    assert.match(htmlPanel, /Mario Kart World[\s\S]*?Not listed for Switch/);
    assert.match(htmlPanel, /Celeste/);
    assert.doesNotMatch(htmlPanel, /game-match-platform-note/); // not ALL greyed
    assert.match(t.log.status.at(-1).m, /Choose a match/);
  });

  await check('Use this match starts disabled; enables only after a selectable tap; nothing auto-filled', async () => {
    const t = mk(ok(SWITCH_ONLY)); t.els.fieldTitle.value = 'Celeste'; t.els.fieldPlatform.value = 'Switch';
    await t.T.runGameLookup(true);
    // Mock $ does not parse innerHTML; the markup itself must mark Use disabled, then the click handler enables it.
    assert.match(t.$('#game-match-picker').innerHTML, /id="game-match-use" disabled/);
    t.$('#game-match-use').disabled = true; // mirror the rendered attribute for the handler
    assert.equal(t.log.commits.length, 0);
    assert.equal(t.els.fieldTitle.value, 'Celeste');
    const click = t.$('#game-match-picker').listeners.click;
    click({ target: tgt('#game-match-use') });
    assert.equal(t.log.commits.length, 0, 'Use without a pick does nothing');
    click({ target: tgt('[data-game-pick]') });
    assert.equal(t.$('#game-match-use').disabled, false);
    assert.equal(t.log.commits.length, 0);
    click({ target: tgt('#game-match-use') });
    assert.equal(t.log.commits.length, 1);
  });

  await check('disabled wrong-platform row cannot be picked', async () => {
    const t = mk(ok(MKW)); t.els.fieldTitle.value = 'Mario Kart World'; t.els.fieldPlatform.value = 'Switch';
    await t.T.runGameLookup(true);
    assert.match(t.$('#game-match-picker').innerHTML, /data-game-pick="0"[^>]*disabled/);
    t.$('#game-match-use').disabled = true;
    const click = t.$('#game-match-picker').listeners.click;
    click({ target: tgt('[data-game-pick]') });
    assert.equal(t.$('#game-match-use').disabled, true, 'handler rejects platform-mismatched pick');
    assert.equal(t.log.commits.length, 0);
  });

  await check('barcode compatible: Switch 2 accepts Switch barcode; Switch rejects Switch 2 barcode', async () => {
    const pass = mk(ok(SWITCH_ONLY), { barcodeHit: { title: 'Celeste', platform: 'Switch' } });
    pass.els.fieldBarcode.value = '045496590741'; pass.els.fieldPlatform.value = 'Switch 2';
    await pass.T.runGameLookup(false);
    assert.equal(pass.log.fetches.length, 1, 'Switch barcode allowed under Switch 2');
    assert.equal(pass.$('#game-match-picker').hidden, false);

    const reject = mk(ok(MKW), { barcodeHit: { title: 'Mario Kart World', platform: 'Switch 2' } });
    reject.els.fieldBarcode.value = '045496599999'; reject.els.fieldPlatform.value = 'Switch';
    await reject.T.runGameLookup(false);
    assert.equal(reject.log.fetches.length, 0, 'no IGDB call when platforms disagree');
    assert.match(reject.log.status.at(-1).m, /different platform/);
    assert.equal(reject.log.status.at(-1).k, 'error');

    const both = mk(ok(MKW), { barcodeHit: { title: 'Mario Kart World', platform: 'Switch 2' } });
    both.els.fieldBarcode.value = '045496599999'; both.els.fieldPlatform.value = 'Switch 2';
    await both.T.runGameLookup(false);
    assert.equal(both.log.fetches.length, 1, 'Switch 2 barcode allowed under Switch 2');
  });

  await check('results-list CSS: light rows, reason, picked border, Use disabled/enabled colors', () => {
    assert.match(css, /\.game-match\s*\{[^}]*background:\s*#fff/s);
    assert.match(css, /\.game-match\s*\{[^}]*border:\s*1px solid #e6dfd3/s);
    assert.match(css, /\.game-match\s*\{[^}]*border-radius:\s*8px/s);
    assert.match(css, /\.game-match-name\s*\{[^}]*font-size:\s*15px/s);
    assert.match(css, /\.game-match-name\s*\{[^}]*font-weight:\s*600/s);
    assert.match(css, /\.game-match-name\s*\{[^}]*color:\s*#1a1a1a/s);
    assert.match(css, /\.game-match-meta\s*\{[^}]*font-size:\s*13px/s);
    assert.match(css, /\.game-match-meta\s*\{[^}]*color:\s*#6b6158/s);
    assert.match(css, /-webkit-line-clamp:\s*2/);
    assert.match(css, /\.game-match-reason\s*\{[^}]*font-size:\s*13px/s);
    assert.match(css, /\.game-match-reason\s*\{[^}]*color:\s*#6b6158/s);
    assert.match(css, /\.game-match-platform-note\s*\{[^}]*font-size:\s*13px/s);
    assert.match(css, /\.game-match-platform-note\s*\{[^}]*color:\s*#6b6158/s);
    assert.match(css, /\.game-match:disabled\s*\{[^}]*opacity:\s*0\.55/s);
    assert.match(css, /\.game-match\[aria-pressed="true"\]\s*\{[^}]*border:\s*2px solid #8B5E3C/s);
    assert.match(css, /#game-match-use:disabled[\s\S]*?color:\s*#9a9088/s);
    assert.match(css, /#game-match-use:not\(:disabled\)[\s\S]*?background:\s*#8B5E3C/s);
    assert.doesNotMatch(css, /\.game-match:disabled\s*\{[^}]*background:\s*#1a1a1a/s);
  });

  await check('user-facing copy does not promise Switch games "work" on Switch 2', () => {
    assert.doesNotMatch(src, /works on Switch 2/i);
    // Compatibility comments may exist; the picker reason uses "Not listed for".
    assert.match(src, /Not listed for/);
  });

  await check('syncPlatformSelect keeps unknown platform values (Switch 2 already known; extras preserved)', () => {
    assert.match(src, /A saved string that isn't in this list is kept as an extra option/);
    assert.match(src, /const extra = current && !known\.has\(current\) \? current : ""/);
  });

  console.log(`${passed}/${passed} passed (Switch 2 + title-search results V2.3; mock fetch; no browser)`);
})().catch(e => { console.error(e); process.exitCode = 1; });
