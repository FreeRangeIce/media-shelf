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
check('title-only cards: cover + title; clamp 2 lines; focus ring; detail keeps fields', () => {
  const slice = app.slice(app.indexOf('Title-only redesign card'), app.indexOf('Title-only redesign card') + 700);
  assert.match(slice, /item-title/);
  assert.doesNotMatch(slice, /item-meta|badge-status|badge-format|btn-pick-cover|card-ref|item-notes/);
  assert.match(app, /function detailHtml[\s\S]*badge-status[\s\S]*badge-format[\s\S]*Rating[\s\S]*Progress[\s\S]*Tags[\s\S]*ISFDB[\s\S]*IGDB[\s\S]*Cover from Google Books/);
  assert.match(app, /fieldCover|field-cover/); // cover still settable in the edit form
  assert.match(css, /-webkit-line-clamp:\s*2/);
  assert.match(css, /\.item-card:focus-visible/);
  assert.match(css, /\.item-card \.item-body[\s\S]*padding:\s*8px/);
  assert.match(app, /frm-stats-line/);
});
check('Tabletop cards are title-only and open detail (not the edit form)', () => {
  const tt = fs.readFileSync(path.join(root, 'tabletop.js'), 'utf8');
  const card = tt.slice(tt.indexOf('Title-only card'), tt.indexOf('Title-only card') + 450);
  assert.match(card, /data-tt-open/);
  assert.doesNotMatch(card, /item-meta|item-badges|tt-kicker|tt-exp-count/);
  assert.match(tt, /data-tt-open[\s\S]*openDetail\(/);
  assert.match(tt, /tt-detail-edit[\s\S]*openForm/); // Edit is explicit from the detail sheet
  const i = tt.indexOf('function openDetail');
  const j = tt.indexOf('\n  function ', i + 10);
  const det = tt.slice(i, j > i ? j : i + 3000);
  assert.match(det, /subtypeBadge/);
  assert.match(det, /statusBadge/);
  assert.match(det, /metaLine|tt-detail-badges/);
  assert.match(det, /tt-detail-edit|tt-detail-close/);
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

check('rev4: header static at narrow widths (brand/pin not fixed)', () => {
  assert.match(css, /@media \(max-width: 559px\)[\s\S]*\.frm-site-header[\s\S]*position:\s*static\s*!important/);
  assert.match(css, /\.frm-site-header \.brand[\s\S]*position:\s*static\s*!important/);
  assert.match(css, /\.frm-logo[\s\S]*max-width:\s*200px/);
});
check('rev4: grid 2/3/4 columns with ~200px card cap', () => {
  assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 200px\)\)/);
  assert.match(css, /@media \(min-width: 560px\)[\s\S]*repeat\(3, minmax\(0, 200px\)\)/);
  assert.match(css, /@media \(min-width: 900px\)[\s\S]*repeat\(4, minmax\(0, 200px\)\)/);
});
check('rev4: placeholder [hidden] stays hidden; type label only when visible', () => {
  assert.match(css, /\.item-cover-placeholder\[hidden\][\s\S]*display:\s*none\s*!important/);
  assert.match(css, /\.item-cover-placeholder:not\(\[hidden\]\)[\s\S]*font-size:\s*0\.62rem/);
});
check('rev4: Add sheet action bar uses paper surface; fade band removed', () => {
  assert.match(css, /#modal \.item-form \.form-actions[\s\S]*background:\s*#fffdf8\s*!important/);
  assert.match(css, /#modal \.item-form \.form-actions::before[\s\S]*display:\s*none\s*!important/);
});
check('rev4: Sample Board Game seed with local SVG cover, no BGG id', () => {
  assert.match(app, /Sample Board Game/);
  assert.match(app, /sample-tabletop-cover\.svg/);
  assert.doesNotMatch(app.slice(app.indexOf('seed-tt-1'), app.indexOf('seed-tt-1')+500), /bggId/);
  assert.ok(fs.existsSync(path.join(root, 'assets/sample-tabletop-cover.svg')));
  const tt = fs.readFileSync(path.join(root, 'tabletop.js'), 'utf8');
  assert.match(tt, /seedSampleIfEmpty/);
  assert.match(tt, /clearSeeds:/);
});

console.log(`${passed}/${passed} passed (redesign shell: categories, nav, logo; production file text; no browser)`);
