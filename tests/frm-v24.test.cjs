// V2.4: folded Duo clearance, Wishlist+All includes Tabletop wants, lookup card contrast,
// in-card Base game tag, title typography/clamps, profile rows, cover boxes, footer.
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

const tidyColon = (s) => String(s).replace(/\s+:\s+/g, ': ').replace(/:/g, '\u2060:');

check('APP_VERSION is 2.4; sw cache is media-shelf-v2.4', () => {
  assert.match(app, /const APP_VERSION = "2\.4"/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.4"/);
});

check('item 1+10: hub clearance media query is max-width 559px; X inset is 24px + 60px; unfolded rules stay outside it', () => {
  assert.match(css, /--frm-duo-hub-clearance:\s*60px/);
  assert.match(css, /@media \(max-width: 559px\)/);
  assert.doesNotMatch(css, /@media \(max-width: 400px\)/);
  const folded = css.slice(css.indexOf('V2.2-b2: folded Duo'));
  const block = folded.slice(folded.indexOf('@media (max-width: 559px)'), folded.indexOf('V2.2-b3:'));
  assert.match(block, /\.modal-header \.btn-icon[\s\S]*?margin-right:\s*calc\(var\(--frm-duo-hub-clearance\) - 24px\)/);
  assert.match(block, /#settings-modal #backup-card \.api-key-card-head[\s\S]*?calc\(var\(--frm-duo-hub-clearance\) - 24px\)/);
  assert.match(block, /#item-detail-modal > \.modal-panel/);
  assert.match(block, /#settings-modal > \.modal-panel[\s\S]*?margin-left:\s*0/);
  assert.match(block, /\.type-tabs\.frm-categories[\s\S]*?padding-right:\s*calc\(var\(--frm-duo-hub-clearance\) - var\(--space-3\)\)/);
  const before = css.slice(0, css.indexOf('V2.2-b2: folded Duo'));
  assert.doesNotMatch(before, /\.modal-header \.btn-icon\s*\{[^}]*margin-right:\s*calc\(var\(--frm-duo-hub-clearance\)/s);
  // Unfolded (600px+) must not be gated by a min-width that reapplies the clearance.
  assert.doesNotMatch(css, /@media \(min-width: 560px\)[\s\S]{0,400}--frm-duo-hub-clearance/);
  assert.doesNotMatch(css, /@media \(min-width: 600px\)[\s\S]{0,400}--frm-duo-hub-clearance/);
});

check('item 5: pill-row right padding lives only in the folded 559px query', () => {
  const before = css.slice(0, css.indexOf('@media (max-width: 559px)'));
  assert.doesNotMatch(before, /\.type-tabs\.frm-categories\s*\{[^}]*padding-right:\s*var\(--frm-duo-hub-clearance\)/s);
});

check('item 2 root cause: Wishlist + All now shows the Tabletop store; category pills still isolate', () => {
  assert.match(app, /function wishAllCombined/);
  assert.match(app, /shelfMode === "wishlist" && filterType === "all"/);
  assert.match(app, /TT\.show\(ttActive\(\) \|\| wishAllCombined\(\)\)/);
  assert.match(app, /tabletop-list/);
  assert.match(app, /ttList && ttList\.children\.length > 0/);
  assert.match(ttSrc, /host\.combined && host\.combined\(\)/);
  assert.match(app, /combined: \(\) => wishAllCombined\(\)/);
  // Tabletop tab still uses ttActive === filterType tabletop
  assert.match(app, /filterType === "tabletop"/);
  // Library does not flip on the combined Wishlist+All path
  assert.doesNotMatch(app, /shelfMode !== "wishlist" && filterType === "all"[\s\S]{0,80}wishAllCombined|wishAllCombined[\s\S]{0,40}library/);
});

check('item 2: Wishlist+All, Wishlist+each category, Library+All filter behavior', () => {
  const media = [
    { type: 'book', status: 'want', title: 'Atomic Habits' },
    { type: 'comic', status: 'want', title: 'Saga' },
    { type: 'book', status: 'owned', title: 'Dune' },
    { type: 'game', status: 'done', title: 'Zelda' },
  ];
  const isWant = (s) => s === 'want';
  const filterMedia = (items, { shelfMode, filterType = 'all' }) => {
    let list = items.slice();
    if (filterType !== 'all') list = list.filter((i) => i.type === filterType);
    if (shelfMode === 'wishlist') list = list.filter((i) => isWant(i.status));
    else list = list.filter((i) => !isWant(i.status));
    return list.map((i) => i.title);
  };
  const base = T.normalize({ id: 'wingspan', title: 'Wingspan', subtype: 'board', status: 'owned', bggId: '266192' });
  const exp = T.normalize({ id: 'euro', title: 'Wingspan: European Expansion', subtype: 'expansion', status: 'want', parentId: 'wingspan', parentBggId: '266192' });
  const hellas = T.normalize({ id: 'hellas', title: 'Lords of Hellas', subtype: 'board', status: 'want' });
  const groups = T.groupShelf([base, exp, hellas]);
  const wishTt = T.filterGroupsForShelf(groups, { wishlist: true });
  const libTt = T.filterGroupsForShelf(groups, { wishlist: false });

  // Wishlist + All: media wants + tabletop wants (this is what All must list)
  assert.deepEqual(filterMedia(media, { shelfMode: 'wishlist', filterType: 'all' }).sort(), ['Atomic Habits', 'Saga']);
  assert.equal(wishTt.length, 2); // Hellas + Wingspan-owned-base with want exp
  const wishTitles = wishTt.flatMap((g) => (g.wishOwnedBase ? g.expansions : [g.entry]).map((e) => e.title)).sort();
  assert.deepEqual(wishTitles, ['Lords of Hellas', 'Wingspan: European Expansion']);

  // Wishlist + each media category: only that type's wants; tabletop hidden (not combined)
  assert.deepEqual(filterMedia(media, { shelfMode: 'wishlist', filterType: 'book' }), ['Atomic Habits']);
  assert.deepEqual(filterMedia(media, { shelfMode: 'wishlist', filterType: 'comic' }), ['Saga']);
  assert.deepEqual(filterMedia(media, { shelfMode: 'wishlist', filterType: 'game' }), []);
  assert.deepEqual(filterMedia(media, { shelfMode: 'wishlist', filterType: 'movie' }), []);
  assert.deepEqual(filterMedia(media, { shelfMode: 'wishlist', filterType: 'music' }), []);

  // Library + All: media everything except Want; tabletop owned (not wants)
  assert.deepEqual(filterMedia(media, { shelfMode: 'library', filterType: 'all' }).sort(), ['Dune', 'Zelda']);
  assert.equal(libTt.length, 1);
  assert.equal(libTt[0].entry.title, 'Wingspan');
  assert.equal(libTt[0].expansions.length, 0);
});

check('item 2 behavioral: Wishlist+All renders tabletop wants (including a Want expansion under an Owned base)', () => {
  const seed = [
    T.normalize({ id: 'hellas', title: 'Lords of Hellas', subtype: 'board', status: 'want' }),
    T.normalize({ id: 'wingspan', title: 'Wingspan', subtype: 'board', status: 'owned', bggId: '266192' }),
    T.normalize({ id: 'euro', title: 'Wingspan: European Expansion', subtype: 'expansion', status: 'want', parentId: 'wingspan', parentBggId: '266192', parentTitle: 'Wingspan' }),
    T.normalize({ id: 'orphan', title: 'Orphan Expansion', subtype: 'expansion', status: 'want' }),
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
  assert.match(markup, /Lords of Hellas/);
  assert.match(markup, /Wingspan: European Expansion|Wingspan:\u2060European Expansion|Wingspan\u2060: European Expansion/);
  assert.match(markup, /Orphan Expansion/);
  assert.match(markup, /tt-wish-base-label/);
  assert.match(markup, /Base game:/);
  assert.match(markup, /Wingspan/);
  // Label is inside the card, not a sibling above the article
  assert.match(markup, /<article class="item-card tt-card"[\s\S]*tt-wish-base-label[\s\S]*<\/article>/);
  assert.doesNotMatch(markup, /<li[^>]*>\s*<p class="tt-wish-base-label">/);
  // Orphan expansion is tagged, with no Base game line of its own
  const orphanIdx = markup.indexOf('Orphan Expansion');
  assert.ok(orphanIdx >= 0);
  const orphanCard = markup.slice(markup.lastIndexOf('<article', orphanIdx), markup.indexOf('</article>', orphanIdx) + 10);
  assert.match(orphanCard, />Expansion</);
  assert.doesNotMatch(orphanCard, /Base game:/);
  assert.equal(t.F('tabletop-empty').hidden, true);
  assert.equal(t.F('tabletop-view').hidden, false);
});

check('item 3: BGG/UPC result cards on the cream sheet are light and readable; IGDB .game-match already was', () => {
  assert.match(css, /\.modal-panel \.tt-upc-cand[\s\S]*?background:\s*#ffffff/);
  assert.match(css, /\.modal-panel \.tt-upc-cand[\s\S]*?border:\s*1px solid #d9d0c3/);
  assert.match(css, /\.modal-panel \.tt-upc-cand-name[\s\S]*?color:\s*#2b2420/);
  assert.match(css, /\.modal-panel \.tt-upc-cand-name[\s\S]*?font-size:\s*15px/);
  assert.match(css, /\.modal-panel \.tt-upc-cand-name[\s\S]*?font-weight:\s*600/);
  assert.match(css, /\.modal-panel \.tt-upc-cand-year[\s\S]*?color:\s*#6b6158/);
  assert.match(css, /\.modal-panel \.tt-bgg-choice\[aria-pressed="true"\][\s\S]*?#8B5E3C/);
  assert.match(css, /\.game-match\s*\{[\s\S]*?background:\s*#fff/);
  assert.match(css, /\.game-match-name[\s\S]*?color:\s*#1a1a1a/);
});

check('item 4+8+9: in-card Base game tag under Expansion; 2-line clamp; orphans keep the tag', () => {
  assert.match(ttSrc, /function tileHtml/);
  assert.match(ttSrc, /subtype === "expansion"/);
  assert.match(ttSrc, /tt-wish-base-label/);
  assert.match(ttSrc, /parentTitle/);
  assert.match(css, /\.item-card \.tt-wish-base-label[\s\S]*?-webkit-line-clamp:\s*2/);
  assert.match(css, /\.item-card \.tt-wish-base-label[\s\S]*?border-radius:\s*4px/);
  assert.match(css, /\.item-card \.tt-wish-base-label[\s\S]*?font-weight:\s*var\(--fw-semibold\)/);
  assert.match(css, /\.item-list,\s*\.tt-list\s*\{\s*align-items:\s*stretch/);
});

check('item 6: display-only colon tidy — " : " becomes ": ", NBSP keeps the colon off a new line; storage untouched', () => {
  const out = tidyColon('Gloomhaven : Forgotten Circles');
  assert.equal(out, 'Gloomhaven\u2060: Forgotten Circles');
  assert.equal(out.includes(' : '), false);
  assert.ok(out.includes('\u2060:'));
  assert.equal(out.replace(/\u2060/g, ''), 'Gloomhaven: Forgotten Circles');
  assert.equal(tidyColon('Plain title'), 'Plain title');
  assert.equal(tidyColon('A:B'), 'A\u2060:B');
  assert.match(app, /function tidyColon/);
  assert.match(ttSrc, /const tidyColon/);
  assert.doesNotMatch(ttSrc, /title:\s*tidyColon/); // must not write the tidied string into stored fields
});

check('item 7: card and row titles clamp to 3 lines; detail titles are not clamped', () => {
  assert.match(css, /\.item-card \.item-title[\s\S]*?-webkit-line-clamp:\s*3/);
  assert.match(css, /\.tt-exp-row \.tt-exp-title[\s\S]*?-webkit-line-clamp:\s*3/);
  assert.match(css, /#item-detail-title[\s\S]*?-webkit-line-clamp:\s*unset/);
  assert.match(css, /#tt-detail-title[\s\S]*?line-clamp:\s*none/);
});

check('item 11: Cancel lookup stays in the lookup panel, outline and smaller; sheet Cancel/Save use 24px inset', () => {
  assert.match(app, /id="game-match-cancel">Cancel lookup</);
  assert.match(app, /class="lookup-actions"/);
  assert.match(ttSrc, /lookup-cancel/);
  assert.match(ttSrc, /Cancel lookup/);
  assert.match(css, /\.lookup-cancel[\s\S]*?min-height:\s*36px/);
  assert.match(css, /\.lookup-cancel[\s\S]*?border:\s*1px solid #8a7d70/);
  assert.match(css, /#modal \.item-form \.form-actions[\s\S]*?padding-right:\s*24px/);
});

check('item 12: Profile rows share icon, label and chevron edges, 24px inset, min 52px', () => {
  assert.match(html, /frm-profile-icon/);
  assert.match(html, /frm-profile-chevron/);
  assert.match(html, /frm-profile-row-text/);
  assert.match(css, /\.frm-profile\s*\{[\s\S]*?margin-left:\s*calc\(24px - var\(--space-5\)\)/);
  assert.match(css, /\.frm-profile\s*\{[\s\S]*?margin-right:\s*calc\(24px - var\(--space-5\)\)/);
  assert.match(css, /\.frm-profile-row\s*\{[\s\S]*?min-height:\s*88px/);
  assert.match(css, /\.frm-profile-row\s*\{[\s\S]*?flex-direction:\s*row/);
});

check('item 13: fixed cover boxes, 1:1 default (2:3 books/comics), contain, black letterbox, card body white, 14px top radius', () => {
  assert.match(css, /\.item-card \.item-cover-col[\s\S]*?aspect-ratio:\s*1 \/ 1/);
  assert.match(css, /\.item-card \.item-cover-col\[data-type="book"\][\s\S]*?aspect-ratio:\s*2 \/ 3/);
  assert.match(css, /\.item-card \.item-cover-col\[data-type="comic"\][\s\S]*?aspect-ratio:\s*2 \/ 3/);
  assert.match(css, /\.item-card \.item-cover[\s\S]*?object-fit:\s*contain/);
  assert.match(css, /\.item-card \.item-cover-col[\s\S]*?background:\s*#000000/);
  assert.match(css, /\.item-card \.item-cover-col[\s\S]*?border-radius:\s*14px 14px 0 0/);
  // No-cover tile keeps the light-grey fill so the type label stays readable on black boxes
  assert.match(css, /\.item-cover-placeholder:not\(\[hidden\]\)[\s\S]*?background:\s*#e8e8e8/);
  assert.match(css, /\.item-card\s*\{[^}]*background:\s*#ffffff/s);
});

console.log(`${passed}/${passed} passed (v2.4 review fixes)`);
