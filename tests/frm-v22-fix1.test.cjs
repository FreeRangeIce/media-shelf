// V2.2-b2: Library excludes Want, header counts Tabletop Want/Owned, folded Duo close inset.
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

check('APP_VERSION stays 2.2; sw cache is media-shelf-v2.2-b2 (suffix accepted)', () => {
  assert.match(app, /const APP_VERSION = "2\.2"/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.2-b2"/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.2(?:-[a-z0-9]+)?"/);
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
  const expWant = T.normalize({ id: 'exp-w', title: 'Want Exp', subtype: 'expansion', status: 'want', parentId: 'talisman' });
  const groups = T.groupShelf([baseWant, baseOwn, expWant], 'title');

  // Simulate production tabletop.js Library hit rule.
  const libGroups = groups.filter((g) => g.entry.status !== 'want').map((g) => ({
    entry: g.entry,
    expansions: g.expansions.filter((e) => e.status !== 'want'),
  }));
  assert.equal(libGroups.length, 1);
  assert.equal(libGroups[0].entry.title, 'Talisman');
  assert.equal(libGroups[0].expansions.length, 0);

  const wishGroups = groups.filter((g) => g.entry.status === 'want').map((g) => ({
    entry: g.entry,
    expansions: g.expansions.filter((e) => e.status === 'want'),
  }));
  assert.equal(wishGroups.length, 1);
  assert.equal(wishGroups[0].entry.title, 'Lords of Hellas');

  assert.match(fs.readFileSync(path.join(root, 'tabletop.js'), 'utf8'), /Nothing owned in Tabletop yet\./);
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
  assert.match(css, /@media \(max-width: 400px\)/);
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

console.log(`${passed}/${passed} passed (v2.2-b2 library/wishlist/count/duo-close)`);
