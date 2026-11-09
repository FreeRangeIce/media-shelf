// Tabletop Kind/legacy mapping + old-format backup restore (Nathan): filter mapping only,
// no destructive migrate of stored values. Native; no browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { boot } = require('./helpers/tt-dom-double.cjs');
const T = require('../tabletop.js');

let passed = 0;
const check = (n, fn) => { fn(); passed++; console.log('PASS', n); };

check('mapTabletopKind accepts Board/Card/Dice/Miniatures/RPG/Expansion labels + aliases', () => {
  assert.equal(T.mapTabletopKind({ subtype: 'Board' }), 'board');
  assert.equal(T.mapTabletopKind({ subtype: 'CARD' }), 'card');
  assert.equal(T.mapTabletopKind({ kind: 'Dice' }), 'dice');
  assert.equal(T.mapTabletopKind({ Kind: 'Miniatures' }), 'miniatures');
  assert.equal(T.mapTabletopKind({ subtype: 'RPG' }), 'rpg');
  assert.equal(T.mapTabletopKind({ subtype: 'Expansion' }), 'expansion');
  assert.equal(T.mapTabletopKind({ kind: 'board game' }), 'board');
  assert.equal(T.mapTabletopKind({ subtype: 'mini' }), 'miniatures');
  assert.equal(T.mapTabletopKind({ subtype: 'board' }), 'board');
});

check('normalize maps legacy Kind without requiring subtype field', () => {
  const e = T.normalize({ title: 'Legacy Root', kind: 'Board', status: 'owned' });
  assert.equal(e.subtype, 'board');
  assert.equal(e.title, 'Legacy Root');
  const e2 = T.normalize({ title: 'Cards Against', Kind: 'Card', status: 'want' });
  assert.equal(e2.subtype, 'card');
  assert.equal(e2.status, 'want');
});

check('old-format backup with 3 tabletop Kind shapes restores and lists under Tabletop', () => {
  // Realistic pre-canonical records: Kind labels, mixed casing, one legacy kind field.
  const oldBackup = {
    v: 1,
    items: [],
    tabletop: {
      v: 1,
      entries: [
        { id: 'old-1', title: 'Wingspan', Kind: 'Board', status: 'owned', year: '2019' },
        { id: 'old-2', title: 'The Crew', kind: 'Card', status: 'owned', year: '2019' },
        { id: 'old-3', title: 'Gloomhaven', subtype: 'Board', status: 'owned', year: '2017', designer: 'Childres' },
      ],
    },
  };
  const parsed = T.parseBackupBlock(oldBackup);
  assert.ok(parsed);
  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed.map((e) => e.subtype).sort(), ['board', 'board', 'card']);
  // Restore into empty shelf (replace): nothing else changes; all three show as tabletop entries.
  const t = boot([], []);
  const res = t.tt.restore(parsed, 'replace');
  assert.ok(res);
  const rows = t.saved();
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((e) => e.subtype === 'board' || e.subtype === 'card').length, 3);
  assert.equal(new Set(rows.map((e) => e.title)).size, 3);
  // Stored shelf after restore is the normalized in-memory form (canonical subtypes) —
  // we did not rewrite the backup file itself.
  assert.equal(oldBackup.tabletop.entries[0].Kind, 'Board');
  assert.equal(oldBackup.tabletop.entries[1].kind, 'Card');
});

check('existing owned shelf is preserved: restore merge does not drop local tabletop', () => {
  const existing = [
    { id: 'keep-me', title: 'Keep Me', subtype: 'board', status: 'owned', dateAdded: '2026-01-01T00:00:00.000Z', dateUpdated: '2026-01-01T00:00:00.000Z' },
  ];
  const t = boot(existing, []);
  const incoming = T.parseBackupBlock({
    tabletop: { v: 1, entries: [
      { id: 'new-1', title: 'Azul', kind: 'Board', status: 'owned' },
      { id: 'new-2', title: 'Keep Me', kind: 'Board', status: 'owned' }, // same title hand-match path possible
    ] },
  });
  const before = t.saved().map((e) => ({ id: e.id, title: e.title, subtype: e.subtype }));
  const res = t.tt.restore(incoming, 'merge', { onHandMatch: () => T.HAND_MATCH.SKIP });
  assert.ok(res);
  const after = t.saved();
  assert.ok(after.some((e) => e.id === 'keep-me' && e.title === 'Keep Me'));
  assert.equal(before.find((e) => e.id === 'keep-me').subtype, 'board');
  assert.ok(after.length >= 2);
});

check('Wishlist Want filter: Owned expansion under Want base — expansion out, base in', () => {
  const base = T.normalize({ id: 'b1', title: 'Base Want', subtype: 'board', status: 'want', bggId: '100' });
  const exp = T.normalize({ id: 'e1', title: 'Owned Exp', subtype: 'expansion', status: 'owned', parentBggId: '100', parentId: 'b1' });
  const groups = T.groupShelf([base, exp], 'title');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].entry.id, 'b1');
  assert.equal(groups[0].expansions.length, 1);
  const wish = T.filterGroupsForShelf(groups, { wishlist: true });
  assert.equal(wish.length, 1);
  assert.equal(wish[0].entry.title, 'Base Want');
  assert.equal(wish[0].expansions.length, 0);
  assert.equal(wish[0].wishOwnedBase, undefined);
});

console.log(`${passed}/${passed} passed (tabletop Kind map + old backup + wishlist expansion rule)`);
