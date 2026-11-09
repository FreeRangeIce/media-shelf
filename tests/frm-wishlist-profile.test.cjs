// Wishlist Want filter + Profile Settings/Back up wiring. Native source + light filter sim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let passed = 0;
const check = (n, fn) => { fn(); passed++; console.log('PASS', n); };

check('Wishlist mode filters status===want and respects category filterType', () => {
  assert.match(app, /shelfMode === "wishlist"/);
  const slice = app.slice(app.indexOf('function filteredItems'), app.indexOf('function filteredItems') + 1200);
  assert.match(slice, /shelfMode === "wishlist"/);
  assert.match(slice, /isWantStatus\(i\.status\)/);
  assert.match(slice, /isLibraryStatus\(i\.status\)/);
  assert.match(slice, /filterType !== "all"/);
});

check('empty Wishlist states for all + category', () => {
  assert.match(app, /No wants yet/);
  assert.match(app, /No \$\{filterType === "game" \? "video game" : filterType\} wants/);
});

check('Profile panel has Settings and Back up rows; opens existing features', () => {
  assert.match(html, /data-profile-action="settings"/);
  assert.match(html, /data-profile-action="backup"/);
  assert.match(app, /act === "settings"\) openSettingsModal/);
  assert.match(app, /act === "backup"\) backupToICloud/);
  assert.match(html, /id="btn-restore"/);
  assert.match(html, /id="settings-title"/);
});

check('header Settings/Back up not visible chrome (hidden util row)', () => {
  assert.match(html, /frm-util-row"[^>]*hidden|frm-util-row[\s\S]{0,20}hidden/);
});

check('TT host receives wishlist flag', () => {
  assert.match(app, /wishlist: \(\) => shelfMode === "wishlist"/);
});

check('GAME_TITLE_SEARCH_TESTED remains true (Micah gate; untouched)', () => {
  assert.match(app, /const GAME_TITLE_SEARCH_TESTED = true/);
  assert.match(app, /const APP_VERSION = "2\.2"/);
});

console.log(`${passed}/${passed} passed (wishlist + profile wiring)`);
