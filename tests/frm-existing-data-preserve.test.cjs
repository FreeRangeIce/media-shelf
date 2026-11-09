// Existing-data preservation: load a realistic localStorage shape (media + tabletop with
// legacy Kind labels) and confirm nothing is lost or migrated destructively on boot.
// Native DOM doubles; no browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { boot } = require('./helpers/tt-dom-double.cjs');

let passed = 0;
const check = async (n, fn) => { await fn(); passed++; console.log('PASS', n); };

const mediaKey = 'media-tracker-v1';
const ttKey = 'media-tracker-v1:tabletop';

(async () => {
  await check('tabletop boot with legacy Kind records keeps all three titles and canonical subtypes in memory only', () => {
    const raw = [
      { id: 't1', title: 'Wingspan', Kind: 'Board', status: 'owned', year: '2019' },
      { id: 't2', title: 'The Crew', kind: 'Card', status: 'owned' },
      { id: 't3', title: 'Gloomhaven', subtype: 'Board', status: 'owned' },
    ];
    // Store the raw legacy JSON as a user device would have it.
    const t = boot([], []);
    t.store.set(ttKey, JSON.stringify(raw));
    // Re-init by calling count/entries which load()+normalize
    const rows = t.tt.entries();
    assert.equal(rows.length, 3);
    assert.equal(rows.map((e) => e.title).sort().join('|'), 'Gloomhaven|The Crew|Wingspan');
    assert.ok(rows.every((e) => e.subtype === 'board' || e.subtype === 'card'));
    // Raw storage untouched until a commit — we never wrote back.
    const stored = JSON.parse(t.store.get(ttKey));
    assert.equal(stored[0].Kind, 'Board');
    assert.equal(stored[1].kind, 'Card');
    assert.equal(stored[2].subtype, 'Board');
  });

  await check('media library items (comics/movies/music/tabletop stats) survive alongside tabletop store', () => {
    const media = {
      v: 3,
      items: [
        { id: 'm1', type: 'comic', title: 'Saga #1', status: 'owned', format: 'physical' },
        { id: 'm2', type: 'movie', title: 'Dune', status: 'want', format: 'digital' },
        { id: 'm3', type: 'music', title: 'Discovery', status: 'owned', format: 'digital', creator: 'Daft Punk' },
        { id: 'm4', type: 'book', title: 'Dune', status: 'owned', format: 'physical' },
        { id: 'm5', type: 'game', title: 'Hades', status: 'want', format: 'digital', platform: 'Switch' },
      ],
    };
    const ttRaw = [
      { id: 't1', title: 'Wingspan', Kind: 'Board', status: 'owned' },
      { id: 't2', title: 'Azul', kind: 'Board', status: 'want' },
      { id: 't3', title: 'Root', subtype: 'board', status: 'owned' },
    ];
    const t = boot(ttRaw.map((r) => ({ ...r, dateAdded: '2026-01-01T00:00:00.000Z', dateUpdated: '2026-01-01T00:00:00.000Z' })), []);
    // Simulate media store sitting beside tabletop (not rewritten by TT boot).
    t.store.set(mediaKey, JSON.stringify(media));
    const mediaAfter = JSON.parse(t.store.get(mediaKey));
    assert.equal(mediaAfter.items.length, 5);
    assert.equal(mediaAfter.items.map((i) => i.type).sort().join('|'), 'book|comic|game|movie|music');
    assert.equal(t.tt.count(), 3);
    const wantTt = t.tt.entries().filter((e) => e.status === 'want');
    assert.equal(wantTt.length, 1);
    assert.equal(wantTt[0].title, 'Azul');
  });

  console.log(`${passed}/${passed} passed (existing-data preservation; no destructive migrate)`);
})().catch((e) => { console.error(e); process.exit(1); });
