// V2.9: white monochrome official platform marks; badge inset on the visible cover;
// fallback EXPANSION pill meets 4.5:1; expansions stay flat tiles with full titles.
"use strict";
const { strict: assert } = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const tt = fs.readFileSync(path.join(root, "tabletop.js"), "utf8");
const sources = fs.readFileSync(path.join(root, "assets/platforms/SOURCES.md"), "utf8");
const T = require(path.join(root, "tabletop.js"));
const v29 = css.slice(css.indexOf("========== V2.9"));
assert.ok(v29.length > 200, "V2.9 CSS block missing");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log("PASS", name);
}

check("APP_VERSION 2.16.1 and cache media-shelf-v2.16.1, no suffixes", () => {
  assert.match(app, /const APP_VERSION = "2\.16.1";/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.16.1";/);
  assert.doesNotMatch(app, /const APP_VERSION = "2\.12-/);
  assert.doesNotMatch(sw, /media-shelf-v2\.16.1-/);
});

check("item 1: official marks are white monochrome; text badges for the rest; Micah personal-use note", () => {
  assert.match(sources, /white monochrome/i);
  assert.match(sources, /personal use/i);
  assert.match(sources, /#ffffff/);
  assert.match(sources, /xbox\.svg/);
  assert.match(sources, /playstation\.svg/);
  assert.match(sources, /switch\.svg/);
  assert.match(sources, /wii\.svg/);
  assert.match(sources, /wiiu\.svg/);
  assert.match(sources, /gamecube\.svg/);
  assert.match(sources, /Steam/);
  assert.match(sources, /switch2\.svg/);
  const xbox = fs.readFileSync(path.join(root, "assets/platforms/xbox.svg"), "utf8");
  const ps = fs.readFileSync(path.join(root, "assets/platforms/playstation.svg"), "utf8");
  const nsw = fs.readFileSync(path.join(root, "assets/platforms/switch.svg"), "utf8");
  const wii = fs.readFileSync(path.join(root, "assets/platforms/wii.svg"), "utf8");
  const wiiu = fs.readFileSync(path.join(root, "assets/platforms/wiiu.svg"), "utf8");
  assert.match(xbox, /fill="#ffffff"/i);
  assert.doesNotMatch(xbox, /fill="#000/);
  assert.match(ps, /fill:#ffffff/i);
  assert.doesNotMatch(ps, /fill:#1f1f1f/);
  assert.match(nsw, /fill:#FFFFFF/i);
  assert.doesNotMatch(nsw, /#E60012/);
  assert.match(wii, /fill:#FFFFFF/i);
  assert.doesNotMatch(wii, /#8C8C8C/);
  assert.match(wiiu, /fill:#FFFFFF/i);
  assert.doesNotMatch(wiiu, /#0096C8|#8C8C8C/);
  // Text-only platforms (no file)
  assert.match(app, /PC:\s*\{\s*file:\s*"",\s*abbr:\s*"PC"/);
  assert.match(app, /Other:\s*\{\s*file:\s*"",\s*abbr:\s*"OTH"/);
  assert.match(app, /PSP:\s*\{\s*file:\s*"",\s*abbr:\s*"PSP"/);
  assert.match(app, /"PS Vita":\s*\{\s*file:\s*"",\s*abbr:\s*"PSV"/);
  assert.match(app, /Steam:\s*\{\s*file:\s*"steam\.svg"/);
  assert.match(app, /"Switch 2":\s*\{\s*file:\s*"switch2\.svg"/);
  assert.match(app, /GameCube:\s*\{\s*file:\s*"gamecube\.svg"/);
  assert.doesNotMatch(sw, /\.\/assets\/platforms\/xbox\.svg/);
  assert.match(sw, /\.\/assets\/platforms\/wiiu\.svg/);
  assert.doesNotMatch(sw, /boardgamegeek|geekdo/);
});

check("item 1: 24px disc, rgba(0,0,0,.55), inset 8px on the visible cover-fit box", () => {
  assert.match(app, /item-cover-fit/);
  assert.match(v29, /\.item-cover-fit/);
  assert.match(v29, /\.item-cover-fit \.platform-badge[\s\S]*right:\s*8px/);
  assert.match(v29, /\.item-cover-fit \.platform-badge[\s\S]*bottom:\s*8px/);
  const disc = v29.match(/(?:^|\n)\.platform-badge\s*\{[^}]+\}/m)[0];
  assert.match(disc, /width:\s*24px/);
  assert.match(disc, /height:\s*24px/);
  assert.match(disc, /background:\s*rgba\(0,\s*0,\s*0,\s*0\.55\)/);
  assert.match(disc, /border-radius:\s*50%/);
  assert.match(v29, /\.platform-badge-text[\s\S]*font-family:\s*var\(--font\)/);
  assert.match(v29, /\.platform-badge-text[\s\S]*color:\s*#ffffff/);
  assert.match(v29, /\.platform-badge-text[\s\S]*overflow:\s*hidden/);
  assert.match(v29, /\.platform-badge-text[\s\S]*max-width:\s*none/);
  // No CSS filter inventing a monochrome mark
  assert.match(v29, /filter:\s*none/);
});

check("item 2: grid render flattens every expansion to its own tile; titles stay unclamped", () => {
  const render = tt.slice(tt.indexOf("function render()"), tt.indexOf("queueExpPillSamples"));
  assert.match(render, /flattenShelfTiles\(groups, sortKey\)/);
  assert.match(render, /tiles\.map\(\(e\) => `<li class="tt-group">\$\{tileHtml\(e\)\}<\/li>`\)/);
  assert.doesNotMatch(render, /cardHtml|tt-exp-list/);
  const title = v29.match(/\.item-card \.item-title,\s*\.item-card\.tt-card \.item-title\s*\{[^}]+\}/);
  assert.ok(title, "V2.9 title rule missing");
  assert.match(title[0], /display:\s*block/);
  assert.match(title[0], /line-clamp:\s*none/);
  assert.match(title[0], /overflow:\s*visible/);
  assert.match(title[0], /text-overflow:\s*unset/);
  const base = T.normalize({ id: "dv", title: "Disney Villainous: The Worst Takes It All", subtype: "board", status: "owned", dateUpdated: "2020-01-01" });
  const e1 = T.normalize({ id: "ev", title: "Evil Comes Prepared", subtype: "expansion", status: "owned", parentId: "dv", parentTitle: base.title, dateUpdated: "2021-01-01" });
  const orphan = T.normalize({ id: "or", title: "Orphan Expansion", subtype: "expansion", status: "want", dateUpdated: "2021-02-01" });
  const ownedOrphan = T.normalize({ id: "oo", title: "Loose Exp", subtype: "expansion", status: "owned", dateUpdated: "2021-03-01" });
  const groupsLib = T.filterGroupsForShelf(T.groupShelf([base, e1, orphan, ownedOrphan], "title"), { wishlist: false, statusFilter: "all", q: "" });
  const lib = T.flattenShelfTiles(groupsLib, "title").map((e) => e.title);
  assert.deepEqual(lib, [
    "Disney Villainous: The Worst Takes It All",
    "Evil Comes Prepared",
    "Loose Exp",
  ]); // Want orphan omitted from Library; owned orphan is its own tile
  const groupsWish = T.filterGroupsForShelf(T.groupShelf([base, e1, orphan], "title"), { wishlist: true, statusFilter: "all", q: "" });
  const wish = T.flattenShelfTiles(groupsWish, "title").map((e) => e.title);
  assert.deepEqual(wish, ["Orphan Expansion"]);
  const groupsAllWish = T.filterGroupsForShelf(T.groupShelf([base, e1, orphan], "updated"), { wishlist: true, statusFilter: "all", q: "" });
  const wishUpdated = T.flattenShelfTiles(groupsAllWish, "updated").map((e) => e.title);
  assert.deepEqual(wishUpdated, ["Orphan Expansion"]);
});

check("item 3: fallback EXPANSION pill uses white or #1a1a1a at >= 4.5:1", () => {
  const pill = v29.match(/\.item-card \.item-badges \.badge-type\.tabletop\s*\{[^}]+\}/)[0];
  assert.match(pill, /background:\s*#8c1d5a/);
  assert.match(pill, /color:\s*#ffffff/);
  const fill = [0x8c, 0x1d, 0x5a];
  const white = T.contrastRatioRgb(fill, [255, 255, 255]);
  const ink = T.contrastRatioRgb(fill, [26, 26, 26]);
  assert.ok(white >= 4.5, "white on fallback fill " + white);
  // Ink is not required to pass when white already does; record it.
  assert.ok(white >= ink || ink >= 4.5);
});

console.log(`${passed}/${passed} passed (v2.9 platform badges + fallback pill + flat titles)`);
