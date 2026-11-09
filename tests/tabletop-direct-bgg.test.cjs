// Native tests of the production direct-ID controller; all provider data is synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../tabletop.js');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('PASS', name); };
const example = { bggId: '382229', bggType: 'boardgame', name: 'Synthetic BGG test game', year: '2024', designer: 'Example designer', players: '2–4', playTime: '30', image: 'https://cf.geekdo-images.com/example__original.jpg?x=1&y=2' };
const response = (things = [example], status = 200, retry = null) => ({ ok: status === 200, status, headers: { get: () => retry }, json: async () => ({ things }) });
function harness(initial = {}) {
  const fields = { title: '', bggId: '382229', bggType: '', year: '', designer: '', players: '', playTime: '', coverUrl: '', subtype: 'board', ...initial };
  const requests = [], states = [], applied = [], confirmations = [], timers = new Map();
  let opened = true, timerId = 0;
  const api = core.createBggIdLookup({ relay: 'https://relay.example', current: () => ({ ...fields }), isOpen: () => opened,
    fetcher: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
    onState: s => states.push(s), confirm: done => confirmations.push(done), apply: record => { applied.push(record); Object.assign(fields, record); },
    timers: { setTimeout: (fn, ms) => { assert.equal(ms, 20000); timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) }
  });
  return { api, fields, requests, states, applied, confirmations, timers, close: () => { opened = false; api.reset(); }, get state() { return states.at(-1); }, async load(value = example) { const p = api.lookup(fields.bggId); requests.at(-1).resolve(response([value])); await p; } };
}
(async () => {
  for (const id of ['', '0', '-1', '1.2', 'abc', '382229,13', '1234567890', 'https://boardgamegeek.com/boardgame/13']) {
    const f = harness(); await f.api.lookup(id);
    check(`invalid id ${JSON.stringify(id)} never calls relay`, () => { assert.equal(f.requests.length, 0); assert.equal(f.state.status, 'error'); });
  }
  check('positive ids accepted, whitespace trimmed only', () => { assert(core.validBggId(' 382229 ')); assert(core.validBggId('999999999')); assert(!core.validBggId('0382229')); });
  {
    const f = harness(); await f.load();
    check('empty title is no prerequisite; GET uses only ID, not title or barcode', () => { assert.equal(f.requests[0].url, 'https://relay.example/thing?ids=382229'); assert.equal(f.requests[0].options.credentials, 'omit'); assert.equal(f.requests[0].options.redirect, 'error'); assert.equal(f.requests[0].options.method, undefined); });
    check('single match does not autofill', () => { assert.equal(f.state.status, 'choice'); assert.equal(f.state.selected, false); assert.equal(f.fields.title, ''); assert.equal(f.applied.length, 0); });
    f.api.use(); check('Use without a selection does nothing', () => assert.equal(f.applied.length, 0));
    f.api.select(); check('selection alone does not fill', () => { assert.equal(f.state.selected, true); assert.equal(f.applied.length, 0); });
    f.api.use(); check('explicit Use atomically adopts ID/title/cover/details', () => { assert.equal(f.applied.length, 1); for (const key of ['bggId', 'title', 'coverUrl', 'designer', 'year', 'players', 'playTime', 'bggType']) assert(f.applied[0][key]); assert.equal(f.fields.coverUrl, example.image); });
    f.api.use(); check('repeat Use cannot apply twice', () => { assert.equal(f.applied.length, 1); assert.equal(f.timers.size, 0); });
  }
  {
    const f = harness({ title: 'Hand entry', coverUrl: 'https://manual.example/cover.jpg', designer: 'Manual designer' }); await f.load(); f.api.select(); f.api.use();
    check('conflicting fields wait for explicit overwrite', () => { assert.equal(f.confirmations.length, 1); assert.equal(f.fields.title, 'Hand entry'); assert.equal(f.applied.length, 0); });
    f.confirmations[0](); check('overwrite applies fields together once', () => { assert.equal(f.applied.length, 1); assert.equal(f.fields.title, example.name); assert.equal(f.fields.coverUrl, example.image); });
    f.confirmations[0](); check('stale overwrite callback cannot reapply', () => assert.equal(f.applied.length, 1));
  }
  for (const action of ['reset', 'close', 'id', 'field']) {
    const f = harness({ title: 'Manual' }); await f.load(); f.api.select(); f.api.use();
    if (action === 'reset') f.api.reset(); if (action === 'close') f.close(); if (action === 'id') f.fields.bggId = '13'; if (action === 'field') f.fields.title = 'New typing';
    f.confirmations[0](); check(`${action} invalidates deferred overwrite`, () => assert.equal(f.applied.length, 0));
  }
  {
    const f = harness(); const first = f.api.lookup('382229'); const signal = f.requests[0].options.signal;
    await f.api.lookup('382229'); check('double click makes only one in-flight request', () => assert.equal(f.requests.length, 1));
    f.fields.bggId = '13'; const second = f.api.lookup('13');
    check('new lookup aborts previous request', () => assert(signal.aborted));
    f.requests[1].resolve(response([{ ...example, bggId: '13', name: 'Second synthetic game' }])); await second;
    f.requests[0].resolve(response()); await first;
    check('out-of-order response cannot replace newest result', () => { assert.equal(f.state.candidate.bggId, '13'); assert.equal(f.applied.length, 0); });
  }
  {
    const f = harness(); const p = f.api.lookup('382229'); f.close(); f.requests[0].resolve(response()); await p;
    check('close aborts and late response cannot populate reopened form', () => { assert(f.requests[0].options.signal.aborted); assert.equal(f.state.status, 'idle'); assert.equal(f.applied.length, 0); });
  }
  for (const things of [[], [{ ...example, bggId: '13' }], [{ ...example, name: '' }], [{ ...example, bggType: 'unknown' }], [example, example]]) {
    const f = harness({ title: 'Manual' }); const p = f.api.lookup('382229'); f.requests[0].resolve(response(things)); await p; f.api.select(); f.api.use();
    check('missing/mismatched/malformed/ambiguous result preserves manual fields', () => { assert.equal(f.state.status, 'none'); assert.equal(f.fields.title, 'Manual'); assert.equal(f.applied.length, 0); });
  }
  for (const code of [429, 503, 500]) {
    const f = harness({ title: 'Manual' }); const p = f.api.lookup('382229'); f.requests[0].resolve(response([], code, '25')); await p;
    check(`${code} preserves fields and exposes retry guidance`, () => { assert.equal(f.state.status, 'error'); assert.equal(f.fields.title, 'Manual'); if (code !== 500) assert.match(f.state.message, /25 seconds/); });
  }
  {
    const f = harness(); const p = f.api.lookup('382229'); const request = f.requests[0]; f.timers.values().next().value(); request.reject(new Error('Aborted')); await p;
    check('timeout aborts and leaves typed form intact', () => { assert.equal(f.state.status, 'error'); assert.match(f.state.message, /timed out/); assert.equal(f.applied.length, 0); assert.equal(f.timers.size, 0); });
  }
  {
    const f = harness(); const p = f.api.lookup('382229'); f.requests[0].reject(new Error('Offline')); await p;
    check('offline failure is recoverable without mutation', () => { assert.match(f.state.message, /Couldn’t/); assert.equal(f.applied.length, 0); });
  }
  {
    const f = harness({ coverUrl: 'https://manual.example/c.jpg', year: '1999', designer: 'Manual' }); await f.load({ ...example, image: '', thumbnail: '', year: '0', designer: '' }); f.api.select(); f.api.use();
    check('absent provider fields never erase manual cover/year/designer', () => { assert.equal(f.fields.coverUrl, 'https://manual.example/c.jpg'); assert.equal(f.fields.year, '1999'); assert.equal(f.fields.designer, 'Manual'); });
  }
  check('unsafe image schemes and embedded credentials are rejected', () => { for (const url of ['javascript:alert(1)', 'data:image/png;base64,x', 'https://u:p@images.example/x', '//images.example/x']) assert.equal(core.bggImageUrl(url), ''); assert.equal(core.bggImageUrl(example.image), example.image); });
  check('API expansion metadata does not infer parent or overwrite chosen subtype', () => { const r = core.bggIdRecord({ ...example, bggType: 'boardgameexpansion' }, '382229'); assert.equal(r.bggType, 'boardgameexpansion'); assert(!('parentId' in r)); assert(!('subtype' in r)); });
  {
    const listeners = {}, writes = [], swSource = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
    const origin = 'https://freerangeice.github.io';
    const ctx = { URL, self: { location: { origin }, addEventListener: (name, fn) => { listeners[name] = fn; } }, caches: { match: async () => null, open: async () => ({ put: async request => writes.push(request.url) }) }, fetch: async () => ({ ok: true, clone: () => ({}) }) };
    vm.createContext(ctx); vm.runInContext(swSource, ctx);
    for (const url of [example.image, 'https://other-cover.example/cover.jpg']) {
      let pending;
      listeners.fetch({ request: { method: 'GET', url }, respondWith: value => { pending = value; } });
      await pending; await new Promise(resolve => setImmediate(resolve));
    }
    check('actual service-worker handler writes no BGG or other external cover bytes', () => assert.deepEqual(writes, []));
    let pending; listeners.fetch({ request: { method: 'GET', url: origin + '/media-shelf/styles.css' }, respondWith: value => { pending = value; } });
    await pending; await new Promise(resolve => setImmediate(resolve));
    check('cache exclusion test control: same-origin app file is cached', () => assert.equal(writes.length, 1));
    check('candidate version and cache are both V2.2; game title search switch on (local candidate)', () => { const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'); assert.match(app, /const APP_VERSION = "2.2";/); assert.match(swSource, /media-shelf-v2\.2/); assert.match(app, /GAME_TITLE_SEARCH_TESTED = true/); });
  }
  // Execute the actual DOM setup with small native element doubles (not a browser/device test).
  {
    const source = fs.readFileSync(path.join(__dirname, '../tabletop.js'), 'utf8');
    const start = source.indexOf('  let bggIdLookup = null,'), end = source.indexOf('  /**\n   * "Look up on BoardGameGeek"', start);
    const elements = new Map(); let resets = 0, syncs = 0, open = true;
    class Element {
      constructor(id) { this.id = id; this.value = ''; this.hidden = false; this.listeners = {}; this.attrs = {}; this.innerHTML = ''; }
      setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { delete this.attrs[k]; }
      addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); }
      after() {} closest() { return { after: () => {} }; } focus() {} querySelector() { return new Element('result-control'); }
      trigger(k, target = this) { for (const fn of this.listeners[k] || []) fn({ target }); }
    }
    const F = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
    for (const k of ['title', 'bggId', 'bggType', 'year', 'designer', 'players', 'playTime', 'coverUrl', 'subtype']) F(`tt-${k}`);
    F('tt-bggId').value = '382229'; F('tt-subtype').value = 'board';
    // The initial setup uses missing-button as its idempotence gate.
    const lookupF = id => id === 'tt-bgg-go' && !elements.has('tt-bgg-panel') ? null : F(id);
    const ctx = { F: lookupF, document: { createElement: () => { F('tt-bgg-panel'); return new Element('row'); } }, barcodeLookupConfig: () => ({ relay: 'https://relay.example' }), createBggIdLookup: core.createBggIdLookup, fetch: async () => response(), resetBarcodeLookup: () => { resets++; }, syncExpansionRows: () => { syncs++; }, esc: value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'), bggLogo: () => '<a>BGG credit</a>', str: v => (v == null ? '' : String(v).trim()), BGG_ID_BOUND: ['year', 'designer', 'players', 'playTime', 'coverUrl'], console };
    vm.createContext(ctx); vm.runInContext(source.slice(start, end), ctx); ctx.setupBggIdLookup();
    F('tt-bgg-go').trigger('click'); await new Promise(resolve => setImmediate(resolve));
    check('DOM button is bound and renders a result without autofilling', () => { assert.match(F('tt-bgg-panel').innerHTML, /Use this match/); assert.match(F('tt-bgg-panel').innerHTML, / disabled/); assert.equal(F('tt-title').value, ''); });
    const click = dataset => F('tt-bgg-panel').trigger('click', { closest: () => ({ dataset }) });
    click({ bggPick: '1' }); click({ bggUse: '1' });
    check('DOM explicit selection fills title/cover/type; resets barcode consent', () => { assert.equal(F('tt-title').value, example.name); assert.equal(F('tt-coverUrl').value, example.image); assert.equal(F('tt-bggType').value, 'boardgame'); assert.equal(resets, 2); assert.equal(syncs, 1); });
    F('tt-title').value = 'Manual edit'; F('tt-bgg-go').trigger('click'); await new Promise(resolve => setImmediate(resolve)); click({ bggPick: '1' }); click({ bggUse: '1' });
    check('DOM shows overwrite step while retaining manual edits', () => { assert.match(F('tt-bgg-panel').innerHTML, /Overwrite filled details/); assert.equal(F('tt-title').value, 'Manual edit'); });
    click({ bggBack: '1' }); check('DOM Cancel overwrite returns to selected result unchanged', () => { assert.match(F('tt-bgg-panel').innerHTML, /Use this match/); assert.equal(F('tt-title').value, 'Manual edit'); });
    click({ bggUse: '1' }); F('tt-form').trigger('input', F('tt-title')); click({ bggOverwrite: '1' });
    check('DOM field edits invalidate pending overwrite and result', () => { assert.equal(F('tt-title').value, 'Manual edit'); assert.equal(F('tt-bgg-panel').hidden, true); });
    F('tt-form').trigger('input', F('tt-bggId'));
    check('manual ID change clears stale provider type metadata', () => assert.equal(F('tt-bggType').value, ''));
  }
  console.log(`${passed}/${passed} passed (synthetic native/controller and DOM-double tests; no provider/device claims)`);
})().catch(err => { console.error(err); process.exitCode = 1; });
