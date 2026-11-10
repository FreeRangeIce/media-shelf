// V2.6: Base game tag inner-span clamp, Tabletop Add sheet viewport fit,
// no autofocus on Type change.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./helpers/tt-dom-double.cjs');
const T = require('../tabletop.js');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ttSrc = fs.readFileSync(path.join(root, 'tabletop.js'), 'utf8');

let passed = 0;
const check = (n, fn) => { fn(); passed++; console.log('PASS', n); };

const v26 = css.slice(css.indexOf('========== V2.6'));
assert.ok(v26.length > 200, 'V2.6 CSS block missing');

check('APP_VERSION is 2.6; sw cache is media-shelf-v2.6', () => {
  assert.match(app, /const APP_VERSION = "2\.6"/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.6"/);
  assert.doesNotMatch(app, /const APP_VERSION = "2\.6-/);
  assert.doesNotMatch(sw, /media-shelf-v2\.6-/);
});

check('item 1: Base game tag markup wraps the text in an inner span', () => {
  assert.match(ttSrc, /<span class="tt-wish-base-label-text">Base game: \$\{esc\(tidyColon\(base\)\)\}<\/span>/);
  const seed = [
    T.normalize({ id: 'base', title: 'Disney Villainous: The Worst Takes It All', subtype: 'board', status: 'owned' }),
    T.normalize({ id: 'exp', title: 'Disney Villainous: Filled with Fright', subtype: 'expansion', status: 'want', parentId: 'base', parentTitle: 'Disney Villainous: The Worst Takes It All' }),
  ];
  const t = boot(seed, []);
  t.tt.init({
    toast() {},
    renderStats() {},
    wishlist: () => true,
    combined: () => true,
    search: () => '',
    status: () => 'all',
    sort: () => 'title',
  });
  t.F('tabletop-view').hidden = false;
  t.tt.show(true);
  const markup = t.F('tabletop-list').innerHTML;
  assert.match(markup, /tt-wish-base-label/);
  assert.match(markup, /tt-wish-base-label-text/);
  assert.match(markup, /Base game:/);
  assert.match(markup, /<p class="tt-wish-base-label"[^>]*>\s*<span class="tt-wish-base-label-text">/);
  // Clamp lives on the inner span, not as a 2-line clamp of the padded tag box in the winning V2.6 rules.
  const tagBlock = css.slice(css.lastIndexOf('.item-card .tt-wish-base-label {'));
  // The last in-card tag rule (before the text-span rule) must not use line-clamp.
  const lastTag = [...css.matchAll(/\.item-card \.tt-wish-base-label\s*\{[^}]+\}/g)].pop();
  assert.ok(lastTag, 'expected a .item-card .tt-wish-base-label rule');
  assert.doesNotMatch(lastTag[0], /-webkit-line-clamp/);
  assert.match(css, /\.tt-wish-base-label-text[\s\S]*?display:\s*-webkit-box/);
  assert.match(css, /\.tt-wish-base-label-text[\s\S]*?-webkit-line-clamp:\s*2/);
  assert.match(css, /\.tt-wish-base-label-text[\s\S]*?-webkit-box-orient:\s*vertical/);
  assert.match(css, /\.tt-wish-base-label-text[\s\S]*?overflow:\s*hidden/);
  // Tag box keeps its padding.
  assert.match(css, /\.item-card \.tt-wish-base-label[\s\S]*?padding:\s*var\(--space-1\) var\(--space-2\)/);
});

check('item 1: card body has no fixed height or overflow hidden; grid stays stretch', () => {
  assert.match(v26, /\.item-card \.item-body[\s\S]*?overflow:\s*visible/);
  assert.match(v26, /\.item-card \.item-body[\s\S]*?height:\s*auto/);
  assert.match(v26, /\.item-card,\s*\n\.item-card\.tt-card\s*\{[\s\S]*?overflow:\s*visible/);
  assert.match(v26, /\.item-card,\s*\n\.item-card\.tt-card\s*\{[\s\S]*?height:\s*auto/);
  assert.match(v26, /\.item-card,\s*\n\.item-card\.tt-card\s*\{[\s\S]*?min-height:\s*100%/);
  // Keep V2.4 equal-height rows; stretch plus min-height:100% / height:auto fills the row
  // without shrinking below content (which was the clip with min-height:0 + overflow:hidden).
  assert.match(v26, /\.item-list,\s*\n\.tt-list\s*\{[\s\S]*?align-items:\s*stretch/);
});

check('item 2: tabletop two-column rows use minmax(0, 1fr); inputs can shrink', () => {
  assert.match(v26, /\.tt-two\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(v26, /#tt-form input[\s\S]*?min-width:\s*0/);
  assert.match(v26, /#tt-form input[\s\S]*?width:\s*100%/);
  assert.match(v26, /#tt-form input[\s\S]*?box-sizing:\s*border-box/);
  assert.match(v26, /#tt-form \.tt-bgg-id-lookup[\s\S]*?min-width:\s*0/);
  assert.match(v26, /#tt-form \.tt-lookup-row[\s\S]*?min-width:\s*0/);
  assert.match(v26, /#tt-form \.tt-upc-cand[\s\S]*?min-width:\s*0/);
  assert.match(v26, /#tt-form \.tt-bgg-id-lookup > \*[\s\S]*?min-width:\s*0/);
  assert.match(v26, /#tt-form-modal[\s\S]*?max-width:\s*100vw/);
  assert.match(v26, /#tt-form-modal > \.modal-panel[\s\S]*?min-width:\s*0/);
});

check('item 2: under 400px, only the Play time pair stacks; labels are not shrunk', () => {
  assert.match(html, /form-row tt-stack-under-400[\s\S]*?tt-players/);
  assert.match(html, /form-row tt-stack-under-400[\s\S]*?tt-playTime/);
  assert.match(v26, /@media \(max-width: 399px\)[\s\S]*?\.tt-two > \.tt-stack-under-400[\s\S]*?grid-column:\s*1 \//);
  // Must not reintroduce a 400px query (hub clearance stays 559px).
  assert.doesNotMatch(css, /@media \(max-width: 400px\)/);
  // No blanket stack of every .tt-two pair under 359px anymore.
  assert.doesNotMatch(css, /@media \(max-width: 359px\)\s*\{\s*\.tt-two\s*\{[^}]*grid-template-columns:\s*1fr/);
});

check('item 2: Add tabletop title ellipsizes; X stays flex-none for hub clearance', () => {
  assert.match(v26, /#tt-form-title[\s\S]*?min-width:\s*0/);
  assert.match(v26, /#tt-form-title[\s\S]*?text-overflow:\s*ellipsis/);
  assert.match(v26, /#tt-form-title[\s\S]*?white-space:\s*nowrap/);
  assert.match(v26, /#tt-form-modal \.modal-header \.btn-icon[\s\S]*?flex:\s*0 0 auto/);
  // Detail titles still unclamp; Add titles are no longer in that unclamp group.
  const unclamp = css.slice(css.indexOf('#item-detail-title'), css.indexOf('Items 4 + 8'));
  assert.match(unclamp, /#tt-detail-title/);
  assert.doesNotMatch(unclamp, /\.modal-header h2/);
  assert.doesNotMatch(unclamp, /#tt-form-title/);
  assert.match(css, /--frm-duo-hub-clearance:\s*60px/);
});

check('item 3: Type-change swap does not autofocus a field; direct Add still does', () => {
  assert.match(ttSrc, /openForm\(null, \{ title \}, \{ focusField: false \}\)/);
  assert.match(ttSrc, /const focusField = !opts \|\| opts\.focusField !== false/);
  assert.match(ttSrc, /if \(focusField\) F\("tt-title"\)\.focus\(\)/);
  // Direct Add / empty-add / edit still call openForm without disabling focus.
  assert.match(ttSrc, /openAdd: \(\) => openForm\(null\)/);
  assert.match(ttSrc, /F\("tt-empty-add"\)\.addEventListener\("click", \(\) => openForm\(null\)\)/);
  // Type change goes through swapToTabletop → openAddFrom.
  assert.match(app, /if \(els\.fieldType\.value === "tabletop"\) return swapToTabletop\(\)/);
  assert.match(app, /TT\.openAddFrom\(carry, back\)/);
});

console.log(`${passed}/${passed} passed (v2.6 review fixes)`);
