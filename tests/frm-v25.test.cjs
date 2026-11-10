// V2.5: dark no-cover / failed-image tiles, and the Wishlist+All row-gap
// between the media list and the Tabletop list.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ttSrc = fs.readFileSync(path.join(root, 'tabletop.js'), 'utf8');

let passed = 0;
const check = (n, fn) => { fn(); passed++; console.log('PASS', n); };

check('APP_VERSION is 2.6; sw cache is media-shelf-v2.6', () => {
  assert.match(app, /const APP_VERSION = "2\.6"/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.6"/);
});

check('item A: no-cover / failed-image placeholder is #0d0d0d with #b5aa9c label', () => {
  const v25 = css.slice(css.lastIndexOf('.item-cover-placeholder:not([hidden])'));
  const block = v25.slice(0, v25.indexOf('}', v25.indexOf('background:')) + 1);
  assert.match(block, /background:\s*#0d0d0d\s*!important/);
  assert.match(block, /color:\s*#b5aa9c\s*!important/);
  assert.match(block, /width:\s*100%\s*!important/);
  assert.match(block, /height:\s*100%\s*!important/);
  // Winning (last) placeholder color is not the old light-grey tile.
  assert.doesNotMatch(block, /#e8e8e8|#9a9a9a/);
});

check('item A: every visible .item-cover-placeholder rule uses the dark tile colors', () => {
  const re = /\.item-cover-placeholder:not\(\[hidden\]\)[^{]*\{[^}]+\}/g;
  const blocks = css.match(re) || [];
  assert.ok(blocks.length >= 3, `expected several placeholder rules, got ${blocks.length}`);
  for (const b of blocks) {
    if (/background\s*:/.test(b)) {
      assert.match(b, /background:\s*#0d0d0d/);
      assert.match(b, /color:\s*#b5aa9c/);
      assert.doesNotMatch(b, /#e8e8e8|#9a9a9a/);
    }
  }
});

check('item A: per-category cover ratios and type size are unchanged', () => {
  assert.match(css, /\.item-card \.item-cover-col[\s\S]*?aspect-ratio:\s*1 \/ 1/);
  assert.match(css, /\.item-card \.item-cover-col\[data-type="book"\][\s\S]*?aspect-ratio:\s*2 \/ 3/);
  assert.match(css, /\.item-card \.item-cover-col\[data-type="comic"\][\s\S]*?aspect-ratio:\s*2 \/ 3/);
  assert.match(css, /\.item-cover-placeholder:not\(\[hidden\]\)[\s\S]*font-size:\s*0\.62rem/);
  // Photographed covers still letterbox on #000, not the no-cover fill.
  assert.match(css, /\.item-card \.item-cover-col[\s\S]*?background:\s*#000000/);
});

check('item A: media failed-image path still unhides the sibling placeholder (no layout change)', () => {
  assert.match(app, /onerror="this\.style\.display='none';var p=this\.nextElementSibling;if\(p\)p\.hidden=false;"/);
  assert.match(app, /<div class="item-cover-placeholder \$\{type\}" hidden aria-hidden="true">\$\{label\}<\/div>/);
  assert.match(app, /<div class="item-cover-placeholder \$\{type\}" aria-hidden="true">\$\{label\}<\/div>/);
});

check('item A: tabletop store cards share the placeholder class; missing covers get the new tile', () => {
  assert.match(ttSrc, /item-cover-placeholder tabletop/);
  // Pre-existing: a tabletop card with a cover URL has no onerror sibling; left alone.
  assert.doesNotMatch(ttSrc, /item-cover-placeholder tabletop" hidden/);
});

check('item A: Add-sheet / detail no-cover spots keep their own classes and colors', () => {
  assert.match(css, /\.game-match-no-cover\s*\{[^}]*background:\s*#fff/);
  assert.match(css, /\.cover-preview-placeholder\s*\{/);
  assert.doesNotMatch(css, /\.game-match-no-cover\s*\{[^}]*#0d0d0d/);
  assert.doesNotMatch(css, /\.cover-preview-placeholder\s*\{[^}]*#0d0d0d/);
  assert.doesNotMatch(css, /\.tt-detail-cover[^{]*\{[^}]*#0d0d0d/);
  assert.doesNotMatch(css, /\.comic-no-cover\s*\{[^}]*#0d0d0d/);
});

check('item B: #item-list is immediately followed by #tabletop-view', () => {
  assert.match(html, /<ul id="item-list" class="item-list"[^>]*>\s*<\/ul>\s*<!-- Tabletop tab[\s\S]*?<section id="tabletop-view"/);
});

check('item B: lone lists still get the 76px nav-clearance padding-bottom', () => {
  assert.match(css, /\.item-list,\s*\.tt-list,\s*#main\s*\{[\s\S]*?padding-bottom:\s*calc\(64px \+ env\(safe-area-inset-bottom, 0px\) \+ 12px\)\s*!important/);
});

check('item B: when tabletop-view follows a visible #item-list, padding-bottom equals the grid row-gap', () => {
  const start = css.indexOf('V2.5 (Oholiab');
  assert.ok(start >= 0, 'missing V2.5 block');
  const block = css.slice(start);
  assert.match(block, /#item-list:not\(\[hidden\]\):has\(\+ #tabletop-view:not\(\[hidden\]\)\)\s*\{\s*padding-bottom:\s*12px\s*!important;/);
  assert.match(block, /@media \(min-width: 560px\)\s*\{\s*#item-list:not\(\[hidden\]\):has\(\+ #tabletop-view:not\(\[hidden\]\)\)\s*\{\s*padding-bottom:\s*14px\s*!important;/);
  assert.match(block, /@media \(min-width: 900px\)\s*\{\s*#item-list:not\(\[hidden\]\):has\(\+ #tabletop-view:not\(\[hidden\]\)\)\s*\{\s*padding-bottom:\s*16px\s*!important;/);
  // Grid row-gap values the padding is matched to.
  assert.match(css, /\.item-list,\s*\.tt-list\s*\{[\s\S]*?gap:\s*12px/);
  assert.match(css, /@media \(min-width: 560px\)\s*\{[\s\S]*?\.item-list,[\s\S]*?\.tt-list\s*\{[\s\S]*?gap:\s*14px/);
  assert.match(css, /@media \(min-width: 900px\)\s*\{[\s\S]*?\.item-list,[\s\S]*?\.tt-list\s*\{[\s\S]*?gap:\s*16px/);
});

console.log(`${passed}/${passed} passed (v2.5 no-cover tile + Wishlist All gap)`);
