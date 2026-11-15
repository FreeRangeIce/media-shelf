// V2.8: content-sized grid cards (Asaph option B, Micah-approved): no Base game pill on cards,
// compact Expansion pill 7px under the title, no 3-line reservation, 13px bottom, chips stay 40px.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const tt = fs.readFileSync(path.join(root, 'tabletop.js'), 'utf8');
const v28 = css.slice(css.indexOf('========== V2.8'));
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS ' + name); }
assert.ok(v28.length > 200, 'V2.8 CSS block missing');

check('APP_VERSION 2.8 and cache media-shelf-v2.8, no suffixes', () => {
  assert.match(app, /const APP_VERSION = "2\.8";/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.8";/);
});
check('item 1: grid card markup has no Base game pill; detail sheet keeps Base game', () => {
  const tile = tt.slice(tt.indexOf('function tileHtml'), tt.indexOf('function cardHtml'));
  assert.doesNotMatch(tile, /Base game/);
  assert.doesNotMatch(tile, /tt-wish-base-label/);
  assert.match(tt, /<h3 class="tt-detail-h">Base game<\/h3>/);
  assert.match(v28, /\.item-card \.tt-wish-base-label\s*\{\s*display:\s*none/);
});
check('item 2: compact pink Expansion pill 7px under title', () => {
  assert.match(tt, /<div class="item-badges">\$\{subtypeBadge\(x\)\}<\/div>/);
  assert.match(v28, /\.item-card \.item-body \.item-badges,[^{]*\{\s*margin-top:\s*7px/);
  const pill = v28.match(/\.item-card \.item-badges \.badge-type\.tabletop\s*\{[^}]+\}/)[0];
  assert.match(pill, /height:\s*23px/);
  assert.match(pill, /font-size:\s*11px/);
  assert.match(pill, /border-radius:\s*4px/);
  assert.doesNotMatch(pill, /background|color:/); // inherits the same pink colors
});
check('item 3: no 3-line title reservation, 13px bottom padding, clamp kept', () => {
  assert.match(v28, /\.item-card \.item-title,\s*\n\.item-card\.tt-card \.item-title\s*\{\s*min-height:\s*0/);
  assert.match(v28, /\.item-card \.item-body\s*\{[^}]*padding-bottom:\s*13px/);
  assert.match(v28, /\.item-card \.item-body\s*\{[^}]*gap:\s*0/);
  assert.match(v28, /\.item-card \.item-body\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(css, /-webkit-line-clamp:\s*3/);
});
check('item 4: grids align-items:start; cards height:auto, min-height:0', () => {
  assert.match(v28, /\.item-list,\s*\n\.tt-list\s*\{\s*align-items:\s*start/);
  assert.match(v28, /\.item-card,\s*\n\.item-card\.tt-card\s*\{[^}]*min-height:\s*0/);
  assert.doesNotMatch(v28, /min-height:\s*100%/);
  assert.doesNotMatch(v28, /stretch/);
});
check('item 5 + unchanged: chips 40px, hub clearance 80px untouched by V2.8', () => {
  assert.doesNotMatch(v28, /chip|filter|pill-row|--frm-duo-hub-clearance|position:\s*static|focus/i);
  assert.match(css, /--frm-duo-hub-clearance:\s*80px/);
});
console.log(`${passed}/${passed} passed (v2.8 card sizing)`);
