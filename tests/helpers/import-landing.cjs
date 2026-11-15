// What every fixture lands as under a given app.js source. Used to build the V2.10 baseline
// (tests/fixtures/import-baseline-v2.10.json, from `git show bae67d0:app.js`) and by the
// regression test against the working tree.
const fs = require('node:fs');
const path = require('node:path');
const { bootSource, landClz, landGamesPaste } = require('./import-harness.cjs');
const FIX = path.join(__dirname, '../fixtures');
const CLZ = [
  ['comics', 'clz-comics-micah.csv'], ['comics', 'clz-comics-fixture.csv'], ['games', 'clz-games.csv'],
  ['books', 'clz-books.csv'], ['movies', 'clz-movies.csv'], ['music', 'clz-music.csv'],
];
function landingFor(src) {
  const { api } = bootSource(src);
  const out = { clz: {}, gamesPaste: null };
  for (const [type, file] of CLZ) out.clz[file] = { type, ...landClz(api, type, fs.readFileSync(path.join(FIX, file), 'utf8')) };
  out.gamesPaste = landGamesPaste(api, fs.readFileSync(path.join(FIX, 'games-paste.csv'), 'utf8'));
  return JSON.parse(JSON.stringify(out)); // plain objects, not the vm's
}
module.exports = { landingFor, CLZ };
if (require.main === module) {
  const src = fs.readFileSync(process.argv[2], 'utf8');
  fs.writeFileSync(process.argv[3], JSON.stringify(landingFor(src)) + '\n');
  console.log('wrote', process.argv[3]);
}
