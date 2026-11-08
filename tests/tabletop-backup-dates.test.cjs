// Restore freshness with undated/invalid-dated backup entries. Production tabletop.js functions
// (parseBackupBlock, mergeRestore, FRMTabletop.restore/backupBlock with native storage doubles). Synthetic data.
const assert = require('node:assert/strict');
const { boot } = require('./helpers/tt-dom-double.cjs');
const core = require('../tabletop.js');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('PASS', name); };
const CUR = { id: 'g1', title: 'Game', subtype: 'board', status: 'owned', bggId: '100', coverUrl: 'https://cf.geekdo-images.com/current.jpg', year: '2001', bggSrc: { coverUrl: '100', year: '' }, dateAdded: '2026-01-01T00:00:00.000Z', dateUpdated: '2026-11-08T18:00:00.000Z' };
const inc = (extra) => ({ id: 'g1', title: 'Game', subtype: 'board', bggId: '100', coverUrl: 'https://cf.geekdo-images.com/backup.jpg', bggSrc: { coverUrl: '?' }, ...extra });
const restoreMerge = (entries) => { const t = boot([CUR], []); const parsed = core.parseBackupBlock({ tabletop: { v: 1, entries } }); t.tt.restore(parsed, 'merge'); return t.saved(); };
const cases = [
  ['both dates missing', {}],
  ['dateUpdated invalid, no dateAdded', { dateUpdated: 'not a date' }],
  ['empty strings', { dateUpdated: '', dateAdded: '' }],
  ['known older', { dateUpdated: '2026-11-01T00:00:00.000Z' }],
  ['equal', { dateUpdated: CUR.dateUpdated }],
];
for (const [name, extra] of cases) {
  const s = restoreMerge([inc(extra)]);
  check(`merge restore, ${name}: dated current entry and its bggSrc kept`, () => { assert.equal(s.length, 1); assert.equal(s[0].coverUrl, CUR.coverUrl); assert.deepEqual(s[0].bggSrc, CUR.bggSrc); assert.equal(s[0].dateUpdated, CUR.dateUpdated); });
}
{
  const s = restoreMerge([inc({ dateUpdated: '2026-11-09T00:00:00.000Z' })]);
  check('merge restore, known newer: backup entry and its tags win', () => { assert.equal(s[0].coverUrl, 'https://cf.geekdo-images.com/backup.jpg'); assert.deepEqual(s[0].bggSrc, { coverUrl: '?' }); });
}
{
  const s = restoreMerge([inc({ dateAdded: '2026-11-09T00:00:00.000Z' })]);
  check('merge restore, only dateAdded newer: counts as dated (existing fallback), wins', () => assert.equal(s[0].coverUrl, 'https://cf.geekdo-images.com/backup.jpg'));
}
{
  const before = Date.now();
  const s = restoreMerge([{ id: 'n1', title: 'Brand new', subtype: 'board', bggId: '777', year: '1990', bggSrc: { year: '777' } }]);
  const n = s.find(e => e.id === 'n1');
  check('undated NEW entry is still added and dated at restore time', () => { assert(n); assert(Date.parse(n.dateAdded) >= before - 1000); assert(Date.parse(n.dateUpdated) >= before - 1000); assert.equal(n.bggSrc.year, '777'); });
  check('dated current entry untouched alongside', () => assert.equal(s.find(e => e.id === 'g1').coverUrl, CUR.coverUrl));
}
{
  const s = restoreMerge([{ id: 'n2', title: 'Dated new', subtype: 'board', dateAdded: '2025-05-05T00:00:00.000Z', dateUpdated: '2025-06-06T00:00:00.000Z' }]);
  const n = s.find(e => e.id === 'n2');
  check('dated new entry keeps its own dates', () => { assert.equal(n.dateAdded, '2025-05-05T00:00:00.000Z'); assert.equal(n.dateUpdated, '2025-06-06T00:00:00.000Z'); });
}
{
  const s = restoreMerge([{ ...inc({}), id: 'other-device-id' }]);
  check('undated entry matching by BGG id (different local id) does not supersede', () => { assert.equal(s.length, 1); assert.equal(s[0].coverUrl, CUR.coverUrl); });
}
{
  const t = boot([], []); const parsed = core.parseBackupBlock({ tabletop: { entries: [inc({})] } }); t.tt.restore(parsed, 'replace');
  check('replace mode still restores undated entries, dated at restore', () => { const e = t.saved()[0]; assert.equal(e.coverUrl, 'https://cf.geekdo-images.com/backup.jpg'); assert(Number.isFinite(Date.parse(e.dateUpdated))); });
}
{
  const t = boot([CUR], []); const block = JSON.parse(JSON.stringify(t.tt.backupBlock()));
  const parsed = core.parseBackupBlock({ tabletop: block });
  check('ordinary dated backup round trip keeps dates and tags', () => { assert.equal(parsed[0].dateUpdated, CUR.dateUpdated); assert.deepEqual(parsed[0].bggSrc, CUR.bggSrc); });
}
check('pure mergeRestore with raw undated incoming never supersedes', () => {
  const r = core.mergeRestore([core.normalize(CUR)], [inc({})]); assert.equal(r.updated, 0); assert.equal(r.list[0].coverUrl, CUR.coverUrl);
});
console.log(`${passed}/${passed} passed (production tabletop.js functions with native storage doubles; synthetic data; no browser/provider claims)`);
