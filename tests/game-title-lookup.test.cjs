// Native test of the ACTUAL app.js game lookup code (gameJson, runGameLookup, picker click and
// edit-cancel handlers) extracted into a vm with doubles. Mock fetch only; no network/browser.
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), assert = require('node:assert/strict');
const src = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
let passed = 0; const check = async (n, fn) => { await fn(); passed++; console.log('PASS', n); };
const slice = (a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i); assert(i > 0 && j > i, a); return src.slice(i, j); };
const lookup = slice('  let gameBusy = false, gameSeq = 0', '  async function runLookup()');
const picker = slice('    const cancelGameOnEdit = e => {', '    els.btnLookup.addEventListener("click", () => runLookup());');
const vis = '{' + slice('    const gameTitleButton = $("#btn-game-title-lookup");', '\n    if (gameTitleButton) gameTitleButton.hidden') + src.slice(src.indexOf('\n    if (gameTitleButton) gameTitleButton.hidden'), src.indexOf('\n', src.indexOf('\n    if (gameTitleButton) gameTitleButton.hidden') + 1)) + '\n}';
const flag = /const GAME_TITLE_SEARCH_TESTED = (true|false);/.exec(src)[1] === 'true';
const relayM = /const GAME_RELAY_URL = "([^"]+)"/.exec(src)[1];
function mk(fetchImpl) {
  const E = () => ({ value: '', hidden: true, disabled: false, innerHTML: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, focus() {}, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } });
  const map = new Map(); const $ = s => { if (!map.has(s)) map.set(s, E()); return map.get(s); };
  const els = { fieldType: E(), fieldBarcode: E(), fieldTitle: E(), fieldPlatform: E(), btnLookup: E(), modal: E(), form: E() };
  els.fieldType.value = 'game'; els.modal.hidden = false;
  const log = { status: [], commits: [], fetches: [] };
  const c = { els, $, $$: () => [], lookupBusy: false, GAME_TITLE_SEARCH_TESTED: flag, gameRelayUrl: () => relayM, URL, AbortController, Map, Number, Date, Math, String, Array, setTimeout: () => 0, clearTimeout() {},
    escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), clearCoverChoices() {}, mapExternalPlatform: () => '',
    setLookupStatus: (m, k) => log.status.push({ m, k }), commitLookup: (cand, m) => log.commits.push(cand), resolveGameBarcode: async () => ({ title: 'Celeste', platform: '' }),
    fetch: async (url, opts) => { log.fetches.push({ url, opts }); return fetchImpl(url, opts); } };
  vm.createContext(c); vm.runInContext(lookup + picker + ';globalThis.T={runGameLookup,resetGameLookup,get cands(){return gameCandidates}}', c);
  const vctx = { $, els, GAME_TITLE_SEARCH_TESTED: flag, gameRelayUrl: () => relayM }; vm.createContext(vctx); vm.runInContext(vis, vctx);
  return { c, $, els, log, T: c.T, buttonHidden: $('#btn-game-title-lookup').hidden, vctx };
}
const ok = body => async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
const ONE = { candidates: [{ igdbId: '26226', title: 'Celeste', year: 2018, creator: 'Extremely OK Games', platforms: ['Nintendo Switch'], coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/cob9dh.jpg' }] };
const tgt = sel => ({ closest: s => (s === sel ? { dataset: { gamePick: '0' } } : null) });
(async () => {
  await check('flag on in this local candidate; Title button shown only for game + relay', () => {
    assert.equal(flag, true);
    for (const type of ['game', 'movie', 'book', 'music', 'comic']) { const t = mk(ok({})); t.els.fieldType.value = type; vm.runInContext(vis, t.vctx); assert.equal(t.$('#btn-game-title-lookup').hidden, type !== 'game'); }
    const t = mk(ok({})); t.vctx.gameRelayUrl = () => ''; vm.runInContext(vis, t.vctx); assert.equal(t.$('#btn-game-title-lookup').hidden, true);
  });
  await check('blank/unusable title: no request, typed values kept', async () => {
    for (const v of ['', ' ', '1234567890', 'https://x.y']) { const t = mk(ok(ONE)); t.els.fieldTitle.value = v; t.els.fieldBarcode.value = '045496590741'; await t.T.runGameLookup(true); assert.equal(t.log.fetches.length, 0); assert.equal(t.els.fieldTitle.value, v); assert.equal(t.els.fieldBarcode.value, '045496590741'); }
  });
  await check('title search: one GET to relay /game/search?title=, Accept json, no barcode sent', async () => {
    const t = mk(ok(ONE)); t.els.fieldTitle.value = 'Celeste'; t.els.fieldBarcode.value = '045496590741'; await t.T.runGameLookup(true);
    assert.equal(t.log.fetches.length, 1); assert.equal(t.log.fetches[0].url, `${relayM}/game/search?title=Celeste`); assert.equal(JSON.stringify(t.log.fetches[0].opts.headers), '{"Accept":"application/json"}'); assert.equal(t.log.fetches[0].opts.method, undefined);
    assert.doesNotMatch(t.log.fetches[0].url, /0454965/);
  });
  await check('single result still needs choose + Use; nothing filled before; Use fills via commitLookup', async () => {
    const t = mk(ok(ONE)); t.els.fieldTitle.value = 'celeste'; await t.T.runGameLookup(true);
    const panel = t.$('#game-match-picker'); assert.equal(panel.hidden, false); assert.match(panel.innerHTML, /Choose your game/); assert.equal(t.log.commits.length, 0); assert.equal(t.els.fieldTitle.value, 'celeste');
    const click = panel.listeners.click; assert(click);
    click({ target: tgt('#game-match-use') }); assert.equal(t.log.commits.length, 0, 'Use without a pick does nothing');
    click({ target: tgt('[data-game-pick]') }); assert.equal(t.log.commits.length, 0); assert.equal(t.$('#game-match-use').disabled, false);
    click({ target: tgt('#game-match-use') }); assert.equal(t.log.commits.length, 1); assert.equal(t.log.commits[0].igdbId, '26226'); assert.equal(panel.hidden, true);
  });
  await check('cancel keeps typed values; no commit', async () => {
    const t = mk(ok(ONE)); t.els.fieldTitle.value = 'Celeste'; await t.T.runGameLookup(true); const click = t.$('#game-match-picker').listeners.click;
    click({ target: tgt('[data-game-pick]') }); click({ target: tgt('#game-match-cancel') }); assert.equal(t.log.commits.length, 0); assert.equal(t.els.fieldTitle.value, 'Celeste'); assert.match(t.log.status.at(-1).m, /cancelled/);
  });
  await check('no result / 503 / 429 / network error: message, typed kept, no commit', async () => {
    const cases = [ok({ candidates: [] }), async () => ({ ok: false, status: 503, headers: { get: () => null } }), async () => ({ ok: false, status: 429, headers: { get: h => (h === 'Retry-After' ? '30' : null) } }), async () => { throw new Error('net'); }];
    for (const f of cases) { const t = mk(f); t.els.fieldTitle.value = 'Celeste'; await t.T.runGameLookup(true); assert.equal(t.log.commits.length, 0); assert.equal(t.els.fieldTitle.value, 'Celeste'); assert.equal(t.log.status.at(-1).k, 'error'); assert.match(t.log.status.at(-1).m, /kept/); }
  });
  await check('stale result after edit/close/type change is dropped', async () => {
    for (const mut of [t => t.T.resetGameLookup(), t => { t.els.modal.hidden = true; }, t => { t.els.fieldType.value = 'movie'; }]) {
      let release; const t = mk(() => new Promise(r => { release = r; })); t.els.fieldTitle.value = 'Celeste'; const p = t.T.runGameLookup(true); mut(t);
      release({ ok: true, status: 200, headers: { get: () => null }, json: async () => ONE }); await p; assert.equal(t.$('#game-match-picker').hidden, true); assert.equal(t.log.commits.length, 0);
    }
  });
  await check('editing a field while results show cancels the picker (existing guard)', async () => {
    const t = mk(ok(ONE)); t.els.fieldTitle.value = 'Celeste'; await t.T.runGameLookup(true); t.els.form.listeners.input({ target: { closest: () => null } });
    assert.equal(t.$('#game-match-picker').hidden, true); assert.equal(t.log.commits.length, 0);
  });
  await check('barcode flow stays independent: Lookup with barcode resolves title then same choose step', async () => {
    const t = mk(ok(ONE)); t.els.fieldBarcode.value = '045496590741'; t.els.fieldTitle.value = ''; await t.T.runGameLookup(false);
    assert.equal(t.log.fetches.length, 1); assert.match(t.log.fetches[0].url, /\/game\/search\?title=Celeste$/); assert.equal(t.$('#game-match-picker').hidden, false); assert.equal(t.log.commits.length, 0);
    const t2 = mk(ok(ONE)); t2.els.fieldTitle.value = 'Celeste'; t2.els.fieldBarcode.value = ''; await t2.T.runGameLookup(false); assert.equal(t2.log.fetches.length, 0, 'barcode Lookup with no barcode does not title-search');
  });
  console.log(`${passed}/${passed} passed (actual app.js lookup code in vm; mock fetch; no browser/network)`);
})().catch(e => { console.error(e); process.exitCode = 1; });
