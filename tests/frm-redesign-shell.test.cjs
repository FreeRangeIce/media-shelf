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
check('header: logo symbol centered above separate FreeRangeMedia text', () => {
  assert.match(html, /class="brand frm-brand"/);
  assert.match(html, /<h1 class="frm-title">FreeRangeMedia<\/h1>/);
  assert.match(css, /\.frm-brand[\s\S]*flex-direction:\s*column[\s\S]*align-items:\s*center/);
});
check('two non-scrolling category rows with existing filter types', () => {
  const rows = [...html.matchAll(/class="type-tabs-row"/g)];
  assert.equal(rows.length, 2);
  assert.match(html, /data-type="all"[\s\S]*data-type="book"[\s\S]*data-type="game"/);
  assert.match(html, /data-type="movie"[\s\S]*data-type="music"[\s\S]*data-type="comic"[\s\S]*data-type="tabletop"/);
  assert.match(css, /\.type-tabs\.frm-categories[\s\S]*overflow:\s*visible/);
  assert.match(app, /\$\$\("\.type-tabs \.chip"\)\.forEach/);
});
check('active category uses sparse #8B5E3C and aria-current', () => {
  assert.match(html, /data-type="all"[^>]*aria-current="true"/);
  assert.match(app, /b\.setAttribute\("aria-current", "true"\)/);
  assert.match(css, /\.frm-categories \.chip\.active[\s\S]*#8B5E3C/);
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
