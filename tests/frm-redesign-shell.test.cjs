// Native redesign shell: category rows, bottom-nav active state, logo/header presence.
// Reads production index.html / styles.css / app.js text; no browser.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
let passed = 0; const check = (n, fn) => { fn(); passed++; console.log('PASS', n); };

check('approved logo asset present and referenced (900×443 proportions via CSS aspect-ratio)', () => {
  assert.ok(fs.existsSync(path.join(root, 'assets/frm-logo.png')));
  assert.match(html, /src="\.\/assets\/frm-logo\.png"/);
  assert.match(css, /aspect-ratio:\s*900\s*\/\s*443/);
  assert.match(css, /\.frm-logo[\s\S]*object-fit:\s*contain/);
});
check('header in normal document flow; util row then logo then name', () => {
  assert.match(html, /class="site-header frm-site-header"/);
  assert.match(html, /class="frm-util-row"/);
  assert.match(html, /id="btn-settings"/);
  assert.match(html, /id="btn-backup"/);
  assert.match(html, /class="brand frm-brand"/);
  assert.match(html, /<h1 class="frm-title">FreeRangeMedia<\/h1>/);
  assert.match(css, /\.frm-site-header[\s\S]*position:\s*static/);
  assert.match(css, /\.frm-brand[\s\S]*gap:\s*8px/);
  assert.match(css, /\.stats[\s\S]*margin:\s*16px/);
});
check('two non-scrolling category rows with existing filter types', () => {
  const rows = [...html.matchAll(/class="type-tabs-row"/g)];
  assert.equal(rows.length, 2);
  assert.match(html, /data-type="all"[\s\S]*data-type="book"[\s\S]*data-type="game"/);
  assert.match(html, /data-type="movie"[\s\S]*data-type="music"[\s\S]*data-type="comic"[\s\S]*data-type="tabletop"/);
  assert.match(app, /\$\$\("\.type-tabs \.chip"\)\.forEach/);
});
check('uniform pills: first/last-of-type phone segmented overrides defeated; active #8B5E3C', () => {
  assert.match(css, /\.type-tabs\.frm-categories \.chip:first-of-type[\s\S]*border-radius:\s*999px\s*!important/);
  assert.match(css, /\.type-tabs\.frm-categories \.chip:last-of-type[\s\S]*border-radius:\s*999px\s*!important/);
  assert.match(html, /data-type="all"[^>]*aria-current="true"/);
  assert.match(app, /b\.setAttribute\("aria-current", "true"\)/);
  assert.match(css, /#8B5E3C\s*!important/);
});
check('2:3 cover frame; placeholder fills frame (not a tiny dark box)', () => {
  assert.match(css, /\.item-cover-col[\s\S]*aspect-ratio:\s*2\s*\/\s*3/);
  assert.match(css, /\.item-cover-placeholder[\s\S]*width:\s*100%\s*!important[\s\S]*height:\s*100%\s*!important/);
  assert.match(css, /\.item-cover-placeholder[\s\S]*background:\s*#e8e8e8/);
  assert.match(css, /\.item-cover[\s\S]*object-fit:\s*contain/);
});
check('slim cards: title/meta/status only; detail keeps format, notes, rating, refs, credits', () => {
  assert.match(app, /Slim redesign card/);
  assert.doesNotMatch(app.slice(app.indexOf('Slim redesign card'), app.indexOf('Slim redesign card')+900), /badge-format|card-ref|card-credit|item-notes|stars/);
  assert.match(app, /function detailHtml[\s\S]*badge-format[\s\S]*Rating[\s\S]*Progress[\s\S]*Tags[\s\S]*ISFDB[\s\S]*IGDB[\s\S]*Cover from Google Books/);
  assert.match(app, /frm-stats-line/);
});
check('bottom nav Library/Search/Add/Wishlist/Profile; Library active', () => {
  assert.match(html, /class="frm-bottom-nav"/);
  for (const k of ['library', 'search', 'add', 'wishlist', 'profile']) assert.match(html, new RegExp(`data-nav="${k}"`));
  assert.match(html, /data-nav="library"[^>]*aria-current="page"/);
  assert.match(app, /data-nav/);
  assert.match(app, /els\.search/);
  assert.match(app, /\$\("#btn-add"\)/);
});
check('Wishlist and Profile are honest placeholders (not invented features)', () => {
  assert.match(html, /aria-label="Wishlist \(not set up yet\)"/);
  assert.match(html, /aria-label="Profile \(not set up yet\)"/);
  assert.match(app, /Wishlist is not set up yet/);
  assert.match(app, /Profile is not set up yet/);
  assert.match(html, /id="frm-placeholder"/);
});
check('covers use contain (uncropped); no external-link arrows; flat #1a1a1a; accent #8B5E3C', () => {
  assert.match(css, /object-fit:\s*contain;\s*\/\* complete cover/);
  assert.match(css, /a\.card-ref::after\s*\{\s*content:\s*none/);
  assert.match(css, /--bg:\s*#1a1a1a/);
  assert.match(css, /--accent:\s*#8B5E3C/);
  assert.match(html, /theme-color" content="#1a1a1a"/);
});
check('accessibility: 44px targets, focus, reduced motion; existing IDs preserved', () => {
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  for (const id of ['item-list', 'btn-add', 'btn-settings', 'search', 'status-filter', 'tt-detail-modal', 'item-detail-modal']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /GAME_TITLE_SEARCH_TESTED = true/);
  assert.match(app, /const APP_VERSION = 51/);
});
console.log(`${passed}/${passed} passed (redesign shell: categories, nav, logo; production file text; no browser)`);
