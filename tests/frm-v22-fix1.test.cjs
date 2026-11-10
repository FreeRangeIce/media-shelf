// V2.3: Library excludes Want, header counts Tabletop Want/Owned, folded Duo close inset.
// Native source + light sims. No browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { boot } = require('./helpers/tt-dom-double.cjs');
const T = require('../tabletop.js');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let passed = 0;
const check = (n, fn) => { fn(); passed++; console.log('PASS', n); };

const sameCounts = (a, b) => {
  assert.equal(Number(a.owned), b.owned);
  assert.equal(Number(a.want), b.want);
};

/* ---------- helpers extracted from production intent ---------- */
function isWantStatus(status) { return status === 'want'; }
function isLibraryStatus(status) { return !isWantStatus(status); }

function filterMedia(items, { shelfMode, filterType = 'all', filterStatus = 'all' }) {
  let list = items.slice();
  if (filterType !== 'all') list = list.filter((i) => i.type === filterType);
  if (shelfMode === 'wishlist') {
    list = list.filter((i) => isWantStatus(i.status));
  } else {
    list = list.filter((i) => isLibraryStatus(i.status));
    if (filterStatus !== 'all' && filterStatus !== 'want') {
      list = list.filter((i) => i.status === filterStatus);
    }
  }
  return list;
}

const CATEGORIES = ['book', 'game', 'movie', 'music', 'comic'];

check('APP_VERSION is 2.6; sw cache is media-shelf-v2.6', () => {
  assert.match(app, /const APP_VERSION = "2\.6"/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.6"/);
});

check('shared isWantStatus / isLibraryStatus helpers exist and Library excludes Want in filteredItems', () => {
  assert.match(app, /function isWantStatus/);
  assert.match(app, /function isLibraryStatus/);
  const slice = app.slice(app.indexOf('function filteredItems'), app.indexOf('function filteredItems') + 1400);
  assert.match(slice, /isLibraryStatus\(i\.status\)/);
  assert.match(slice, /isWantStatus\(i\.status\)/);
});

check('Library excludes Want across all 5 media categories; Wishlist shows only Want', () => {
  const sample = [];
  for (const type of CATEGORIES) {
    sample.push({ id: `${type}-own`, type, title: `${type} owned`, status: 'owned' });
    sample.push({ id: `${type}-want`, type, title: `${type} want`, status: 'want' });
    sample.push({ id: `${type}-prog`, type, title: `${type} prog`, status: 'in_progress' });
    sample.push({ id: `${type}-done`, type, title: `${type} done`, status: 'done' });
    sample.push({ id: `${type}-drop`, type, title: `${type} drop`, status: 'dropped' });
  }
  for (const type of CATEGORIES) {
    const lib = filterMedia(sample, { shelfMode: 'library', filterType: type });
    assert.equal(lib.some((i) => i.status === 'want'), false, `${type} library has Want`);
    assert.ok(lib.some((i) => i.status === 'owned'));
    assert.ok(lib.some((i) => i.status === 'in_progress'));
    assert.ok(lib.some((i) => i.status === 'done'));
    assert.ok(lib.some((i) => i.status === 'dropped'));
    const wish = filterMedia(sample, { shelfMode: 'wishlist', filterType: type });
    assert.ok(wish.every((i) => i.status === 'want'));
    assert.equal(wish.length, 1);
  }
  const allLib = filterMedia(sample, { shelfMode: 'library', filterType: 'all' });
  assert.equal(allLib.filter((i) => i.status === 'want').length, 0);
  assert.equal(allLib.length, CATEGORIES.length * 4);
});

check('Library keeps unknown/missing status (treated as non-Want); does not hide user data', () => {
  const sample = [
    { id: '1', type: 'book', title: 'No status', status: undefined },
    { id: '2', type: 'book', title: 'Blank', status: '' },
    { id: '3', type: 'book', title: 'Want', status: 'want' },
  ];
  const lib = filterMedia(sample, { shelfMode: 'library', filterType: 'book' });
  assert.deepEqual(lib.map((i) => i.id).sort(), ['1', '2']);
});

check('Status dropdown Want option is disabled/hidden in Library via syncStatusFilterOptions', () => {
  assert.match(app, /function syncStatusFilterOptions/);
  assert.match(app, /wantOpt\.disabled = !inWishlist/);
  assert.match(app, /wantOpt\.hidden = !inWishlist/);
  assert.match(app, /filterStatus === "want"/);
  assert.match(html, /option value="want"/);
});

check('duplicate detection still scans full items (not filteredItems)', () => {
  const findSlice = app.slice(app.indexOf('function findDuplicate'), app.indexOf('function findDuplicate') + 500);
  assert.match(findSlice, /const pool = items\.filter/);
  assert.doesNotMatch(findSlice, /filteredItems/);
});

check('quiet Library empty copy + 13px #6b6158 class', () => {
  assert.match(app, /Nothing owned in \$\{label\} yet\./);
  assert.match(app, /frm-empty-owned/);
  assert.match(css, /\.empty-state\.frm-empty-owned \.empty-title[\s\S]*?font-size:\s*13px/);
  assert.match(css, /\.empty-state\.frm-empty-owned \.empty-title[\s\S]*?color:\s*#6b6158/);
  assert.match(T.toString ? 'x' : 'x', /x/); // keep require warm
});

check('Tabletop Library excludes Want; Wishlist Want-only; empty owned line', () => {
  const baseWant = T.normalize({ id: 'hellas', title: 'Lords of Hellas', subtype: 'board', status: 'want' });
  const baseOwn = T.normalize({ id: 'talisman', title: 'Talisman', subtype: 'board', status: 'owned' });
  const groups = T.groupShelf([baseWant, baseOwn], 'title');
  const lib = T.filterGroupsForShelf(groups, { wishlist: false });
  assert.equal(lib.length, 1);
  assert.equal(lib[0].entry.title, 'Talisman');
  const wish = T.filterGroupsForShelf(groups, { wishlist: true });
  assert.equal(wish.length, 1);
  assert.equal(wish[0].entry.title, 'Lords of Hellas');
  assert.match(fs.readFileSync(path.join(root, 'tabletop.js'), 'utf8'), /Nothing owned in Tabletop yet\./);
});

check('four combos: Want/Owned base × Want/Owned expansion in Library and Wishlist', () => {
  const mk = (id, title, subtype, status, extra = {}) =>
    T.normalize({ id, title, subtype, status, ...extra });

  // 1) Want base + Owned expansion
  {
    const base = mk('b1', 'Want Base', 'board', 'want', { bggId: '1' });
    const exp = mk('e1', 'Owned Exp', 'expansion', 'owned', { parentBggId: '1', parentId: 'b1' });
    const g = T.groupShelf([base, exp], 'title');
    const lib = T.filterGroupsForShelf(g, { wishlist: false });
    // Library: Want base out; Owned expansion surfaces alone
    assert.equal(lib.length, 1);
    assert.equal(lib[0].entry.title, 'Owned Exp');
    assert.equal(lib[0].entry.subtype, 'expansion');
    assert.equal(lib[0].expansions.length, 0);
    const wish = T.filterGroupsForShelf(g, { wishlist: true });
    assert.equal(wish.length, 1);
    assert.equal(wish[0].entry.title, 'Want Base');
    assert.equal(wish[0].expansions.length, 0); // Owned exp out of Wishlist
    assert.equal(wish[0].wishOwnedBase, undefined);
  }

  // 2) Owned base + Want expansion
  {
    const base = mk('b2', 'Owned Base', 'board', 'owned', { bggId: '2' });
    const exp = mk('e2', 'Want Exp', 'expansion', 'want', { parentBggId: '2', parentId: 'b2' });
    const g = T.groupShelf([base, exp], 'title');
    const lib = T.filterGroupsForShelf(g, { wishlist: false });
    assert.equal(lib.length, 1);
    assert.equal(lib[0].entry.title, 'Owned Base');
    assert.equal(lib[0].expansions.length, 0); // Want exp out of Library
    const wish = T.filterGroupsForShelf(g, { wishlist: true });
    assert.equal(wish.length, 1);
    assert.equal(wish[0].entry.title, 'Owned Base');
    assert.equal(wish[0].wishOwnedBase, true);
    assert.equal(wish[0].expansions.length, 1);
    assert.equal(wish[0].expansions[0].title, 'Want Exp');
  }

  // 3) Want base + Want expansion
  {
    const base = mk('b3', 'Want Base 2', 'board', 'want', { bggId: '3' });
    const exp = mk('e3', 'Want Exp 2', 'expansion', 'want', { parentBggId: '3', parentId: 'b3' });
    const g = T.groupShelf([base, exp], 'title');
    const lib = T.filterGroupsForShelf(g, { wishlist: false });
    assert.equal(lib.length, 0);
    const wish = T.filterGroupsForShelf(g, { wishlist: true });
    assert.equal(wish.length, 1);
    assert.equal(wish[0].entry.title, 'Want Base 2');
    assert.equal(wish[0].expansions.length, 1);
    assert.equal(wish[0].wishOwnedBase, undefined);
  }

  // 4) Owned base + Owned expansion
  {
    const base = mk('b4', 'Owned Base 2', 'board', 'owned', { bggId: '4' });
    const exp = mk('e4', 'Owned Exp 2', 'expansion', 'owned', { parentBggId: '4', parentId: 'b4' });
    const g = T.groupShelf([base, exp], 'title');
    const lib = T.filterGroupsForShelf(g, { wishlist: false });
    assert.equal(lib.length, 1);
    assert.equal(lib[0].entry.title, 'Owned Base 2');
    assert.equal(lib[0].expansions.length, 1);
    const wish = T.filterGroupsForShelf(g, { wishlist: true });
    assert.equal(wish.length, 0);
  }
});

check('Wishlist Owned-base Want-expansion markup: Base game label + Expansion subtype badge', () => {
  const src = fs.readFileSync(path.join(root, 'tabletop.js'), 'utf8');
  assert.match(src, /wishOwnedBase/);
  assert.match(src, /Base game: \$\{esc\(tidyColon\(base\)\)\}/);
  assert.match(src, /tt-wish-base-label/);
  assert.match(src, /subtypeBadge\(x\)/);
  assert.match(css, /\.tt-wish-base-label[\s\S]*?font-size:\s*13px/);
  assert.match(css, /\.tt-wish-base-label[\s\S]*?color:\s*#6b6158/);
  // Tag reuses existing badge-type tabletop → "Expansion" via SUBTYPE_LABELS
  assert.match(src, /subtypeBadge = \(e\) => `<span class="badge badge-type tabletop">\$\{SUBTYPE_LABELS\[e\.subtype\]\}<\/span>`/);
  assert.equal(T.SUBTYPE_LABELS.expansion, 'Expansion');
});

check('countByStatus counts Want expansions as separate Want items', () => {
  const rows = [
    T.normalize({ id: 'b', title: 'Base', subtype: 'board', status: 'owned', bggId: '9' }),
    T.normalize({ id: 'e', title: 'Exp Want', subtype: 'expansion', status: 'want', parentBggId: '9', parentId: 'b' }),
  ];
  assert.deepEqual(T.countByStatus(rows), { owned: 1, want: 1 });
});

check('countByStatus includes Tabletop Want (Lords of Hellas case) and updates with shelf', () => {
  assert.equal(typeof T.countByStatus, 'function');
  const empty = T.countByStatus([]);
  assert.deepEqual(empty, { owned: 0, want: 0 });

  const oneWant = T.countByStatus([
    T.normalize({ id: 'hellas', title: 'Lords of Hellas', subtype: 'board', status: 'want' }),
  ]);
  assert.deepEqual(oneWant, { owned: 0, want: 1 });

  const mixed = T.countByStatus([
    T.normalize({ id: 'hellas', title: 'Lords of Hellas', subtype: 'board', status: 'want' }),
    T.normalize({ id: 'talisman', title: 'Talisman', subtype: 'board', status: 'owned' }),
    T.normalize({ id: 'azul', title: 'Azul', subtype: 'board', status: 'owned' }),
  ]);
  assert.deepEqual(mixed, { owned: 2, want: 1 });

  // Live FRMTabletop store path: add / status change / remove.
  const t = boot([], []);
  sameCounts(t.tt.countByStatus(), { owned: 0, want: 0 });
  // seed via restore replace
  const res = t.tt.restore([
    { id: 'hellas', title: 'Lords of Hellas', subtype: 'board', status: 'want' },
    { id: 'talisman', title: 'Talisman', subtype: 'board', status: 'owned' },
  ], 'replace');
  assert.ok(res);
  sameCounts(t.tt.countByStatus(), { owned: 1, want: 1 });

  // Simulate header fold: media 0 want + tt 1 want => "1 want"
  const mediaWant = 0;
  const headerWant = mediaWant + t.tt.countByStatus().want;
  assert.equal(headerWant, 1);

  // status change want -> owned
  const rows = t.saved();
  const hellas = rows.find((e) => e.title === 'Lords of Hellas');
  assert.ok(hellas);
  const updated = rows.map((e) => (e.id === hellas.id ? { ...e, status: 'owned' } : e));
  t.store.set('media-tracker-v1:tabletop', JSON.stringify(updated));
  sameCounts(t.tt.countByStatus(), { owned: 2, want: 0 });

  // renderStats wires TT.countByStatus into byStatus.want
  assert.match(app, /TT\.countByStatus/);
  assert.match(app, /byStatus\.want \+= ttCounts\.want/);
  assert.match(app, /byStatus\.owned \+= ttCounts\.owned/);
});

check('folded Duo close: single clearance var, 44px target, header-row inset, title ellipsis; unfolded untouched', () => {
  assert.match(css, /--frm-duo-hub-clearance:\s*60px/);
  assert.match(css, /@media \(max-width: 559px\)/);
  const folded = css.slice(css.indexOf('--frm-duo-hub-clearance'));
  assert.match(folded, /\.modal-header \.btn-icon[\s\S]*?width:\s*44px/);
  assert.match(folded, /\.modal-header \.btn-icon[\s\S]*?height:\s*44px/);
  assert.match(folded, /\.modal-header \.btn-icon[\s\S]*?margin-right:\s*calc\(var\(--frm-duo-hub-clearance\)/);
  assert.match(folded, /\.modal-header h2[\s\S]*?text-overflow:\s*ellipsis/);
  assert.match(folded, /#settings-modal #backup-card \.api-key-card-head[\s\S]*?--frm-duo-hub-clearance/);
  // Not applied globally outside the folded media query for the margin-right calc on btn-icon
  const before = css.slice(0, css.indexOf('V2.2-b2: folded Duo'));
  assert.doesNotMatch(before, /\.modal-header \.btn-icon\s*\{[^}]*margin-right:\s*calc\(var\(--frm-duo-hub-clearance\)/s);
});

check('Wishlist empty states preserved (no regression of existing copy)', () => {
  assert.match(app, /No wants yet/);
  assert.match(fs.readFileSync(path.join(root, 'tabletop.js'), 'utf8'), /No tabletop wants yet/);
});


check('V2.2-b4 CSS: wish-base label #b5aa9c on dark / #6b6158 on cream; exp-row wrap', () => {
  assert.match(css, /\.tt-wish-base-label\s*\{[^}]*color:\s*#b5aa9c/s);
  assert.match(css, /\.modal-panel \.tt-wish-base-label[\s\S]*?color:\s*#6b6158/);
  assert.match(css, /\.tt-wish-base-label\s*\{[^}]*font-size:\s*13px/s);
  assert.match(css, /\.tt-wish-base-label\s*\{[^}]*margin:\s*0 0 8px/s);
  assert.match(css, /\.tt-exp-row\s*\{\s*flex-wrap:\s*wrap\s*;\s*\}/);
  assert.match(css, /\.tt-exp-row \.tt-exp-title\s*\{\s*flex:\s*1 1 100%\s*;\s*\}/);
  // Indent / left rule unchanged
  assert.match(css, /\.tt-exp-list\s*\{[^}]*margin:\s*var\(--space-1\) 0 0 16px/s);
  assert.match(css, /\.tt-exp-list\s*\{[^}]*border-left:\s*2px solid/s);
});

console.log(`${passed}/${passed} passed (v2.3 library/wishlist/count/duo-close/expansions)`);
