// V2.8: content-sized grid cards (Asaph option B, Micah-approved): no Base game pill on cards,
// compact Expansion pill 7px under the title, no 3-line reservation, 13px bottom, chips stay 40px, sticky logo+title header.
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

check('APP_VERSION 2.11 and cache media-shelf-v2.11, no suffixes', () => {
  assert.match(app, /const APP_VERSION = "2\.11";/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.11";/);
});
check('item 1: grid card markup has no Base game pill; detail sheet keeps Base game', () => {
  const tile = tt.slice(tt.indexOf('function tileHtml'), tt.indexOf('function cardHtml'));
  assert.doesNotMatch(tile, /Base game/);
  assert.doesNotMatch(tile, /tt-wish-base-label/);
  assert.match(tt, /<h3 class="tt-detail-h">Base game<\/h3>/);
  assert.match(v28, /\.item-card \.tt-wish-base-label\s*\{\s*display:\s*none/);
});
check('item 2: compact pink Expansion pill 7px under title', () => {
  assert.match(tt, /<div class="item-badges">\$\{subtypeBadge\(x, expPillAttrs\(x\)\)\}<\/div>/);
  assert.match(v28, /\.item-card \.item-body \.item-badges,[^{]*\{\s*margin-top:\s*7px/);
  const pill = v28.match(/\.item-card \.item-badges \.badge-type\.tabletop\s*\{[^}]+\}/)[0];
  assert.match(pill, /height:\s*23px/);
  assert.match(pill, /font-size:\s*11px/);
  assert.match(pill, /border-radius:\s*4px/);
  assert.doesNotMatch(pill, /background|color:/); // inherits the same pink colors
});
check('item 3: titles wrap in full; no ellipsis, no line cap, no reserved height; 13px bottom', () => {
  const title = v28.match(/\.item-card \.item-title,\s*\n\.item-card\.tt-card \.item-title\s*\{[^}]+\}/);
  assert.ok(title, 'expected a V2.8 card title rule');
  assert.match(title[0], /min-height:\s*0/);
  assert.match(title[0], /display:\s*block/);
  assert.match(title[0], /-webkit-line-clamp:\s*unset/);
  assert.match(title[0], /line-clamp:\s*none/);
  assert.match(title[0], /overflow:\s*visible/);
  assert.match(title[0], /text-overflow:\s*unset/);
  assert.doesNotMatch(title[0], /ellipsis/);
  assert.match(v28, /\.item-card \.item-body\s*\{[^}]*padding-bottom:\s*13px/);
  assert.match(v28, /\.item-card \.item-body\s*\{[^}]*gap:\s*0/);
  assert.match(v28, /\.item-card \.item-body\s*\{[^}]*flex:\s*0 0 auto/);
});
check('item 4: grids align-items:start; cards height:auto, min-height:0', () => {
  assert.match(v28, /\.item-list,\s*\n\.tt-list\s*\{\s*align-items:\s*start/);
  assert.match(v28, /\.item-card,\s*\n\.item-card\.tt-card\s*\{[^}]*min-height:\s*0/);
  assert.doesNotMatch(v28, /min-height:\s*100%/);
  assert.doesNotMatch(v28, /\.item-list[\s\S]{0,80}align-items:\s*stretch/);
});
check('item 5 + unchanged: chips 40px, hub clearance 80px untouched by V2.8', () => {
  const rules = v28.replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, '');
  assert.doesNotMatch(rules, /\.chip|\.filters-row|pill-row|--frm-duo-hub-clearance/i);
  assert.match(css, /--frm-duo-hub-clearance:\s*80px/);
});
check('item 6: logo + title header is sticky at top with #1a1a1a and safe-area padding', () => {
  const header = v28.match(/\.frm-site-header,\s*\n\.site-header\.frm-site-header\s*\{[^}]+\}/);
  assert.ok(header, 'expected a V2.8 .frm-site-header sticky rule');
  assert.match(header[0], /position:\s*sticky\s*!important/);
  assert.match(header[0], /top:\s*0\s*!important/);
  assert.match(header[0], /z-index:\s*40/);
  assert.match(header[0], /background:\s*#1a1a1a\s*!important/);
  assert.match(header[0], /padding-top:\s*env\(safe-area-inset-top,\s*0px\)\s*!important/);
  // Historical static !important still exists; the V2.8 block is the winner.
  assert.match(css, /\.frm-site-header[\s\S]*position:\s*static\s*!important/);
  // pin-bar stays hidden; do not resurrect the old fixed pin row
  assert.match(v28, /\.frm-site-header > \.pin-bar[\s\S]*display:\s*none\s*!important/);
  // pills/filters are not pinned — they scroll away under the header
  assert.doesNotMatch(v28, /\.toolbar|\.frm-categories|\.filters-row|\.type-tabs/);
  // Reload banner above header (40) and nav (50); sheets remain 100
  assert.match(v28, /#update-banner,[\s\S]*z-index:\s*60/);
  assert.match(css, /\.modal\s*\{[\s\S]*?z-index:\s*100/);
  assert.match(css, /\.toast\s*\{[\s\S]*?z-index:\s*200/);
  assert.match(css, /--frm-duo-hub-clearance:\s*80px/);
});

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const T = require('../tabletop.js');

check('follow-up 1: toast is charcoal with white text, above the nav, z-index below nav', () => {
  const toast = v28.match(/\.toast\s*\{[^}]+\}/);
  assert.ok(toast);
  assert.match(toast[0], /background:\s*#1a1a1a/);
  assert.match(toast[0], /color:\s*#ffffff/);
  assert.match(toast[0], /bottom:\s*calc\(64px \+ env\(safe-area-inset-bottom, 0px\) \+ 34px\)/);
  assert.match(toast[0], /z-index:\s*45/);
  assert.match(v28, /body\.modal-open \.toast[\s\S]*z-index:\s*200/);
});

check('follow-up 2: expansions are flat grid tiles, sorted; detail keeps Base game; titles unclamped', () => {
  assert.match(tt, /function flattenShelfTiles/);
  assert.match(tt, /tiles\.map\(\(e\) => `<li class="tt-group">\$\{tileHtml\(e\)\}<\/li>`\)/);
  assert.doesNotMatch(tt, /tt-exp-list[\s\S]{0,80}tabletop-list|tabletop-list[\s\S]{0,200}tt-exp-list/);
  const base = T.normalize({ id: 'dv', title: 'Disney Villainous: The Worst Takes It All', subtype: 'board', status: 'owned', dateUpdated: '2020-01-01' });
  const e1 = T.normalize({ id: 'ev', title: 'Evil Comes Prepared', subtype: 'expansion', status: 'owned', parentId: 'dv', parentTitle: base.title, dateUpdated: '2021-01-01' });
  const e2 = T.normalize({ id: 'pw', title: 'Perfectly Wretched', subtype: 'expansion', status: 'owned', parentId: 'dv', parentTitle: base.title, dateUpdated: '2021-06-01' });
  const e3 = T.normalize({ id: 'wt', title: 'Wicked to the Core', subtype: 'expansion', status: 'owned', parentId: 'dv', parentTitle: base.title, dateUpdated: '2022-01-01' });
  const groups = T.filterGroupsForShelf(T.groupShelf([base, e1, e2, e3], 'title'), { wishlist: false, statusFilter: 'all', q: '' });
  const az = T.flattenShelfTiles(groups, 'title').map((e) => e.title);
  assert.deepEqual(az, [
    'Disney Villainous: The Worst Takes It All',
    'Evil Comes Prepared',
    'Perfectly Wretched',
    'Wicked to the Core',
  ]);
  const updated = T.flattenShelfTiles(groups, 'updated').map((e) => e.title);
  assert.equal(updated[0], 'Wicked to the Core');
  assert.equal(updated[3], 'Disney Villainous: The Worst Takes It All');
  // Nested expansion rows remain available on the detail sheet only
  assert.match(tt, /<h3 class="tt-detail-h">Base game<\/h3>/);
  assert.match(tt, /tt-exp-list-open/);
});

check('follow-up 3: scan sheet fills the visual viewport; camera box is flex leftover', () => {
  assert.match(v28, /#scan-modal \.scan-panel\.modal-panel-sm[\s\S]*display:\s*flex/);
  assert.match(v28, /#scan-modal \.scan-panel[\s\S]*overflow:\s*hidden/);
  assert.match(v28, /#scan-modal #qr-reader,[\s\S]*flex:\s*1 1 auto/);
  assert.match(v28, /#scan-modal #qr-reader,[\s\S]*min-height:\s*0/);
  assert.match(html, /id="scan-title">Scan barcode/);
  assert.match(html, /id="scan-cancel">Cancel/);
});

check('follow-up 4: Choose photo / Take photo replace No cover; downscale + photo source; backup uses item.coverUrl', () => {
  assert.match(html, /id="btn-choose-photo">Choose photo/);
  assert.match(html, /id="btn-take-photo">Take photo/);
  assert.match(html, /id="btn-remove-photo"/);
  assert.match(html, /<input type="file" id="cover-photo-file" accept="image\/\*"/);
  assert.match(html, /<input type="file" id="cover-photo-camera" accept="image\/\*" capture="environment"/);
  assert.match(app, /COVER_PHOTO_MAX_EDGE = 600/);
  assert.match(app, /COVER_PHOTO_QUALITY = 0\.8/);
  assert.match(app, /toDataURL\("image\/jpeg", COVER_PHOTO_QUALITY\)/);
  assert.match(app, /coverSource: \(els\.fieldCoverPhoto && els\.fieldCoverPhoto\.value\) \? "photo"/);
  assert.match(app, /That photo is too large/);
  assert.match(app, /That photo is still too large after shrinking/);
  assert.match(app, /isPhoto = String\(raw\.coverSource \|\| ""\) === "photo"/);
  assert.match(app, /function buildBackupPayload/);
  assert.match(app, /items: items\.map\(\(i\) => \(\{ \.\.\.i \}\)\)/);
});

check('follow-up 5: Add sheet (media and tabletop) resets scroll on open', () => {
  assert.match(app, /function resetSheetScroll/);
  assert.match(app, /resetSheetScroll\(els\.modal\)/);
  assert.match(tt, /if \(panel\) panel\.scrollTop = 0/);
});

check('follow-up 6: platform badges use official assets or text fallbacks; SW BGG host rules unchanged', () => {
  const sources = fs.readFileSync(path.join(root, 'assets/platforms/SOURCES.md'), 'utf8');
  assert.match(sources, /xbox\.svg/);
  assert.match(sources, /playstation\.svg/);
  assert.match(sources, /switch\.svg/);
  assert.match(sources, /nintendo\.co\.jp/);
  assert.match(sources, /Steam/);
  assert.match(sources, /NS2/);
  assert.match(sources, /GCN/);
  assert.match(app, /PLATFORM_BADGES/);
  assert.match(app, /function platformBadgeMarkup/);
  assert.match(v28, /\.platform-badge\s*\{[^}]*width:\s*24px/);
  assert.match(v28, /\.platform-badge\s*\{[^}]*height:\s*24px/);
  assert.match(v28, /right:\s*8px/);
  assert.match(v28, /bottom:\s*8px/);
  assert.match(v28, /background:\s*rgba\(0,\s*0,\s*0,\s*0\.55\)/);
  assert.match(sw, /\.\/assets\/platforms\/xbox\.svg/);
  assert.doesNotMatch(sw, /boardgamegeek|geekdo/);
  const fetchHandler = sw.slice(sw.indexOf('self.addEventListener("fetch"'));
  assert.doesNotMatch(fetchHandler, /NEVER_HANDLE_HOSTS[\s\S]*bgg|geekdo|boardgamegeek/i);
});

check('follow-up 7: Tabletop Add has the same Scan button, feeding the existing barcode flow', () => {
  assert.match(html, /id="tt-btn-scan"[^>]*>Scan/);
  assert.match(app, /openScanModal\("tabletop"\)/);
  assert.match(app, /scanDest === "tabletop"/);
  assert.match(app, /tt-barcode/);
  assert.match(app, /tt-upc-go/);
});

check('follow-up 8: default sort is A-Z; a saved media-shelf-sort choice is respected', () => {
  assert.match(html, /<option value="title" selected>Title A–Z<\/option>/);
  assert.match(app, /const SORT_STORAGE = "media-shelf-sort"/);
  assert.match(app, /let sortMode = readSavedSort\(\) \|\| "title"/);
  assert.match(app, /localStorage\.setItem\(SORT_STORAGE/);
  assert.match(app, /els\.sortSelect\.value = sortMode/);
});


check('follow-up 9: expansion pill samples dominant cover hue; stores result; falls back to pink', () => {
  assert.match(tt, /function dominantHueFromPixels/);
  assert.match(tt, /function pillColorsFromRgb/);
  assert.match(tt, /function sampleCoverForPill/);
  assert.match(tt, /crossOrigin = "anonymous"/);
  assert.match(tt, /Never fetch, proxy, or cache BGG/);
  assert.match(tt, /tainted canvas/);
  assert.doesNotMatch(sw, /boardgamegeek|geekdo|cf\.geekdo/);
  assert.match(tt, /pillSampling/);
  assert.match(tt, /queueExpPillSamples\(tiles\)/);
  assert.match(tt, /e\.expPill = pill/);
  assert.match(tt, /expPill/);
  assert.match(tt, /fallback: true/);
  assert.match(tt, /data-exp-pill/);
  // Size and spacing of the compact pill are unchanged (23px / 7px / 11px).
  const pill = v28.match(/\.item-card \.item-badges \.badge-type\.tabletop\s*\{[^}]+\}/)[0];
  assert.match(pill, /height:\s*23px/);
  assert.match(pill, /font-size:\s*11px/);
  const red = new Uint8ClampedArray(16);
  for (let i = 0; i < 16; i += 4) { red[i] = 200; red[i + 1] = 32; red[i + 2] = 48; red[i + 3] = 255; }
  const rgb = T.dominantHueFromPixels(red, 2, 2);
  assert.ok(rgb && rgb[0] > rgb[1] && rgb[0] > rgb[2]);
  const colors = T.pillColorsFromRgb(rgb);
  assert.ok(colors.fill && colors.text);
  assert.match(colors.text, /^#ffffff$|^#1a1a1a$/);
  const c = T.contrastRatioRgb(rgb, colors.text === '#ffffff' ? [255, 255, 255] : [26, 26, 26]);
  assert.ok(c >= 4.5, 'text contrast ' + c);
  // Near-black / grey / near-white pixels are ignored → no sample
  const grey = new Uint8ClampedArray([12, 12, 12, 255, 250, 250, 250, 255, 128, 128, 128, 255, 20, 20, 20, 255]);
  assert.equal(T.dominantHueFromPixels(grey, 2, 2), null);
  // V2.10: a dark but usable fill is kept and darkened until white text is 4.5:1,
  // instead of falling back to pink. Near-gray / near-black covers still have no sample.
  const dark = T.pillColorsFromRgb([8, 8, 20]);
  assert.ok(dark && dark.fill && dark.text === '#ffffff');
  const darkRgb = dark.fill.slice(1).match(/../g).map((h) => parseInt(h, 16));
  assert.ok(T.contrastRatioRgb(darkRgb, [255, 255, 255]) >= 4.5);
  const stored = T.sanitizeExpPill({ forCover: '/dev/x.svg', fill: '#146354', text: '#ffffff' });
  assert.deepEqual(stored, { forCover: '/dev/x.svg', fill: '#146354', text: '#ffffff' });
  assert.deepEqual(T.sanitizeExpPill({ forCover: '', fallback: true }), { forCover: '', fallback: true });
});

console.log(`${passed}/${passed} passed (v2.8 card sizing + sticky header + follow-ups)`);
