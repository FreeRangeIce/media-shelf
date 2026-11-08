// Detail view shows the saved cover (production tabletop.js openDetail via its real keyboard handler;
// native DOM doubles; not a visual/browser test).
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot } = require('./helpers/tt-dom-double.cjs');
let passed = 0; const check = (n, fn) => { fn(); passed++; console.log('PASS', n); };
const base = { subtype: 'board', status: 'owned', title: 'Game', dateAdded: '2026-01-01T00:00:00.000Z' };
const open = (t, id) => t.F('tabletop-list').trigger('keydown', { key: 'Enter', target: { matches: () => true, dataset: { ttOpen: id } } });
{
  const t = boot([{ ...base, id: 'c', coverUrl: 'https://cf.geekdo-images.com/x.jpg', year: '2020', bggId: '13' }], []); open(t, 'c');
  const html = t.F('tt-detail-body').innerHTML;
  check('saved cover is rendered in the detail view, same URL as the card', () => assert.match(html, /<span class="tt-detail-cover"><img src="https:\/\/cf\.geekdo-images\.com\/x\.jpg" alt="" referrerpolicy="no-referrer" \/><\/span>/));
  check('cover sits beside badges/meta; expansions heading, BGG id still present after it', () => { const i = html.indexOf('tt-detail-cover'), b = html.indexOf('tt-detail-badges'), x = html.indexOf('Expansions'), g = html.indexOf('BGG id 13'); assert(i > 0 && b > i && x > b && g > x); });
  check('detail modal opened with Edit/Delete ids set', () => { assert.equal(t.F('tt-detail-modal').hidden, false); assert.equal(t.F('tt-detail-edit').dataset.id, 'c'); });
}
{
  const t = boot([{ ...base, id: 'n' }], []); open(t, 'n');
  check('no cover: no cover frame', () => assert.doesNotMatch(t.F('tt-detail-body').innerHTML, /tt-detail-cover/));
}
{
  const t = boot([{ ...base, id: 'q', coverUrl: 'https://x/"><script>1</script>' }], []); open(t, 'q');
  check('cover URL is escaped', () => assert.doesNotMatch(t.F('tt-detail-body').innerHTML, /<script>/));
}
const css = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
check('CSS: contain, max-height 160px, stacks when narrow', () => { assert.match(css, /\.tt-detail-cover img \{[^}]*max-height: 160px;[^}]*object-fit: contain;/s); assert.match(css, /@media \(max-width: 359px\) \{\s*\.tt-detail-top \{ flex-direction: column; \}/); });
console.log(`${passed}/${passed} passed (production openDetail with native DOM doubles; CSS text checks; no visual/browser claims)`);
