// V2.15: shipped dev/fixture-cover-*.svg files are removed. The comic Lookup
// fixture (localStorage["frm:devComicFixture"] only) uses inline SVG data URLs
// that are not deployed.
"use strict";
const { strict: assert } = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("PASS " + name);
}

check("APP_VERSION 2.15.2 and cache media-shelf-v2.15.2, no suffixes", () => {
  assert.match(app, /const APP_VERSION = "2\.15.2";/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.15.2";/);
  assert.doesNotMatch(app, /const APP_VERSION = "2\.15-/);
  assert.doesNotMatch(sw, /media-shelf-v2\.15.2-/);
});

check("dev/fixture-cover-*.svg are not shipped", () => {
  const devDir = path.join(root, "dev");
  assert.equal(fs.existsSync(devDir), false, "dev/ directory should be gone");
  for (let i = 0; i < 5; i++) {
    assert.equal(fs.existsSync(path.join(root, "dev", `fixture-cover-${i}.svg`)), false);
  }
});

check("app, service worker, index and README do not mention fixture-cover files", () => {
  assert.doesNotMatch(app, /fixture-cover/);
  assert.doesNotMatch(sw, /fixture-cover/);
  assert.doesNotMatch(html, /fixture-cover/);
  assert.doesNotMatch(readme, /fixture-cover/);
  assert.doesNotMatch(app, /\.\/dev\/fixture-cover/);
  assert.doesNotMatch(sw, /\/dev\//);
});

check("service worker precache does not include dev/ or fixture covers", () => {
  const block = sw.slice(sw.indexOf("const ASSETS = ["), sw.indexOf("];", sw.indexOf("const ASSETS = [")) + 2);
  assert.match(block, /const ASSETS = \[/);
  assert.doesNotMatch(block, /fixture-cover|\.\/dev\//);
});

check("dev fixture covers are inline SVG data URLs, allowed only in fixture mode", () => {
  const fn = app.slice(app.indexOf("function devFixtureCoverUrl"), app.indexOf("function devFixtureVariant"));
  assert.match(fn, /data:image\/svg\+xml,/);
  assert.match(fn, /encodeURIComponent\(svg\)/);
  assert.doesNotMatch(fn, /fixture-cover|\.\/dev\//);
  const coverUrl = app.slice(app.indexOf("function comicCoverUrl"), app.indexOf("function comicPickerImageUrl"));
  assert.match(coverUrl, /fixture && \/\^data:image\\\/svg\\\+xml\[,;\]\/i\.test\(s\)/);
  assert.doesNotMatch(coverUrl, /fixture-cover/);
});

console.log(`${passed}/${passed} passed (v2.15 fixture covers not shipped)`);
