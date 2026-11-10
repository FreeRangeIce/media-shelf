// V2.7: heading focus on every Add/Edit/type-change open, 80px hub clearance,
// no programmatic focus ring, keyboard-up Add sheet stays scrollable.
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

const v27 = css.slice(css.indexOf('========== V2.7'));
assert.ok(v27.length > 200, 'V2.7 CSS block missing');

check('APP_VERSION is 2.7; sw cache is media-shelf-v2.7', () => {
  assert.match(app, /const APP_VERSION = "2\.7"/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.7"/);
  assert.doesNotMatch(app, /const APP_VERSION = "2\.7-/);
  assert.doesNotMatch(sw, /media-shelf-v2\.7-/);
});

check('item 1: headings are tabindex=-1; open paths focus the heading, never a field', () => {
  for (const id of ['modal-title', 'tt-form-title', 'item-detail-title', 'tt-detail-title', 'settings-title']) {
    assert.match(html, new RegExp(`id="${id}" tabindex="-1"`));
  }
  assert.match(app, /focusProgrammatically\(\s*els\.modalTitle\s*\)/);
  assert.match(app, /focusProgrammatically\(\s*\$\("#item-detail-title"\)\s*\)/);
  assert.match(app, /focusProgrammatically\(\s*\$\("#settings-title"\)\s*\)/);
  assert.doesNotMatch(app, /if \(focusTitle\) els\.fieldTitle\.focus\(\)/);
  assert.doesNotMatch(app, /\$\("#item-detail-close"\)\.focus\(\)/);
  // Default Settings open no longer focuses a key field or the backup button.
  assert.doesNotMatch(app, /els\.fieldOmdbKey\) els\.fieldOmdbKey\.focus\(\)/);
  assert.match(ttSrc, /focusProgrammatically\(\s*F\("tt-form-title"\)\s*\)/);
  assert.match(ttSrc, /focusProgrammatically\(\s*F\("tt-detail-title"\)\s*\)/);
  assert.doesNotMatch(ttSrc, /if \(focusField\) F\("tt-title"\)\.focus\(\)/);
  assert.doesNotMatch(ttSrc, /F\("tt-detail-close"\)\.focus\(\)/);
});

check('item 1 runtime: Add from Tabletop, All/type-change, and Edit do not focus a field', () => {
  const seed = [T.normalize({ id: 'az', title: 'Azul', subtype: 'board', status: 'owned', year: '2017' })];
  const t = boot(seed, []);
  const hits = { title: 0, heading: 0, year: 0, other: [] };
  const track = (id, bucket) => {
    const el = t.F(id);
    const orig = el.focus.bind(el);
    el.focus = function (...a) {
      hits[bucket] = (hits[bucket] || 0) + 1;
      hits.other.push(id);
      return orig(...a);
    };
  };
  track('tt-title', 'title');
  track('tt-form-title', 'heading');
  track('tt-year', 'year');
  track('tt-barcode', 'year');
  track('tt-status', 'year');
  track('tt-players', 'year');
  track('tt-playTime', 'year');

  t.tt.openAdd();
  assert.equal(hits.title, 0, 'Tabletop-pill/direct Add must not focus Title');
  assert.ok(hits.heading >= 1, 'direct Add focuses the heading');
  assert.equal(t.F('tt-form-title').attrs['data-programmatic-focus'], '');
  assert.equal(t.F('tt-form-title').attrs.tabindex, '-1');

  hits.title = hits.heading = hits.year = 0; hits.other = [];
  t.tt.openAddFrom({ title: 'Carried' }, null);
  assert.equal(hits.title, 0, 'type-change / All-pill swap must not focus a field');
  assert.ok(hits.heading >= 1, 'type-change focuses the heading');

  hits.title = hits.heading = hits.year = 0; hits.other = [];
  t.edit('az');
  assert.equal(hits.title, 0, 'Edit must not focus Title');
  assert.ok(hits.heading >= 1, 'Edit focuses the heading');
  const focusedField = hits.other.filter((id) => id !== 'tt-form-title' && id !== 'tt-detail-title');
  assert.deepEqual(focusedField, [], focusedField);
});

check('item 2: hub clearance is 80px under the same 559px rule', () => {
  assert.match(css, /--frm-duo-hub-clearance:\s*80px/);
  assert.doesNotMatch(css, /--frm-duo-hub-clearance:\s*60px/);
  const folded = css.slice(css.indexOf('V2.2-b2: folded Duo'));
  const block = folded.slice(folded.indexOf('@media (max-width: 559px)'), folded.indexOf('V2.2-b3:'));
  assert.match(block, /\.modal-header \.btn-icon[\s\S]*?margin-right:\s*calc\(var\(--frm-duo-hub-clearance\) - 24px\)/);
  assert.match(block, /#modal > \.modal-panel/);
  assert.match(block, /#tt-form-modal > \.modal-panel/);
  assert.match(block, /#item-detail-modal > \.modal-panel/);
  assert.match(block, /#settings-modal > \.modal-panel/);
});

check('item 3: programmatic focus has no ring; keydown clears the flag', () => {
  assert.match(v27, /\[data-programmatic-focus\]:focus/);
  assert.match(v27, /\[data-programmatic-focus\]:focus-visible/);
  assert.match(v27, /outline:\s*none\s*!important/);
  assert.match(v27, /box-shadow:\s*none\s*!important/);
  assert.match(app, /setAttribute\("data-programmatic-focus"/);
  assert.match(app, /removeAttribute\("data-programmatic-focus"\)/);
  assert.match(app, /addEventListener\("keydown", clear, true\)/);
  assert.match(ttSrc, /setAttribute\("data-programmatic-focus"/);
  assert.match(ttSrc, /addEventListener\("keydown", clear, true\)/);
});

check('item 4: short visual viewport keeps the Add field list scrollable', () => {
  assert.match(v27, /body\.modal-open #tt-form-modal[\s\S]*?height:\s*var\(--add-sheet-height/);
  assert.match(v27, /body\.frm-short-vv\.modal-open #modal/);
  assert.match(v27, /body\.frm-short-vv\.modal-open #tt-form-modal/);
  assert.match(v27, /body\.frm-short-vv\.modal-open #modal > \.modal-panel[\s\S]*?overflow:\s*auto/);
  assert.match(v27, /body\.frm-short-vv #modal \.item-form \.form-actions[\s\S]*?position:\s*static\s*!important/);
  assert.match(v27, /body\.frm-short-vv #tt-form-modal \.item-form \.form-actions[\s\S]*?position:\s*static\s*!important/);
  assert.match(app, /classList\.toggle\("frm-short-vv", Boolean\(layoutH && h < layoutH - 80\)\)/);
  assert.match(app, /closest\("#modal > \.modal-panel, #tt-form-modal > \.modal-panel"\)/);
  assert.match(app, /scrollIntoView\(\{ block: "nearest", behavior: reduce \? "auto" : "smooth" \}\)/);
  assert.match(app, /prefers-reduced-motion: reduce/);
});

// V2.6 Tabletop sheet-fit rules must stay (not regress).
check('V2.6 Tabletop two-column fit and type-change hook remain', () => {
  assert.match(css, /\.tt-two\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width: 399px\)[\s\S]*?\.tt-two > \.tt-stack-under-400/);
  assert.doesNotMatch(css, /@media \(max-width: 400px\)/);
});

console.log(`${passed}/${passed} passed (v2.7 review fixes)`);
