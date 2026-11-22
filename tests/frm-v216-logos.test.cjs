// V2.16.1: Micah-supplied platform marks for GameCube, Steam, Switch 2, and each Xbox.
"use strict";
const { strict: assert } = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const sources = fs.readFileSync(path.join(root, "assets/platforms/SOURCES.md"), "utf8");
const v216 = css.slice(css.indexOf("========== V2.16"));
const v2161 = css.slice(css.indexOf("========== V2.16.1"));
assert.ok(v216.length > 200, "V2.16 CSS block missing");
assert.ok(v2161.length > 100, "V2.16.1 CSS block missing");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log("PASS", name);
}

function loadBadgeFns() {
  const start = app.indexOf("  const PLATFORM_BADGES = {");
  const end = app.indexOf("  function coverMarkup");
  assert.ok(start >= 0 && end > start, "badge functions not found");
  const ctx = {
    escapeHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    },
  };
  vm.runInNewContext(app.slice(start, end), ctx);
  return ctx;
}

const B = loadBadgeFns();

const NEW_MARKS = [
  ["GameCube", "gamecube.svg"],
  ["Xbox 360", "xbox-360.svg"],
  ["Xbox One", "xbox-one.svg"],
  ["Xbox", "xbox-original.svg"],
  ["Series X|S", "xbox-series-xs-trimmed.svg"],
  ["Switch 2", "switch2.svg"],
  ["Steam", "steam.svg"],
];

check("APP_VERSION 2.16.1 and cache media-shelf-v2.16.1, no suffixes", () => {
  assert.match(app, /const APP_VERSION = "2\.16.1";/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.16.1";/);
  assert.doesNotMatch(app, /const APP_VERSION = "2\.16.1-/);
  assert.doesNotMatch(sw, /media-shelf-v2\.16.1-/);
});

check("each of the 7 platforms resolves to its own file; no shared xbox.svg; files exist", () => {
  const files = NEW_MARKS.map(([, file]) => file);
  assert.equal(new Set(files).size, 7, "each platform must have a distinct file");
  for (const [platform, file] of NEW_MARKS) {
    assert.equal(B.badgePlatformKey(platform), platform);
    const html = B.platformBadgeMarkup({ type: "game", platform });
    assert.match(app, new RegExp(platform.replace("|", "\\|") + "[\\s\\S]{0,80}" + file.replace(".", "\\.")), platform);
    assert.match(html, new RegExp(file.replace(".", "\\.")), platform);
    assert.doesNotMatch(html, /platform-badge-text/, platform);
    assert.doesNotMatch(html, /xbox\.svg/, platform);
    const svgPath = path.join(root, "assets/platforms", file);
    assert.ok(fs.existsSync(svgPath), file);
    const svg = fs.readFileSync(svgPath, "utf8");
    assert.match(svg, /fill="#ffffff"/i, file);
    assert.doesNotMatch(svg, /fill="#000/i, file);
  }
});

check("GCN, NS2 and STM text abbreviations are gone from badges and mapping entries", () => {
  assert.doesNotMatch(app, /abbr:\s*"GCN"/);
  assert.doesNotMatch(app, /abbr:\s*"NS2"/);
  assert.doesNotMatch(app, /abbr:\s*"STM"/);
  const gcn = B.platformBadgeMarkup({ type: "game", platform: "GameCube" });
  const ns2 = B.platformBadgeMarkup({ type: "game", platform: "Switch 2" });
  const steam = B.platformBadgeMarkup({ type: "game", platform: "Steam" });
  assert.doesNotMatch(gcn, />GCN</);
  assert.doesNotMatch(ns2, />NS2</);
  assert.doesNotMatch(steam, />STM</);
  // Stored shorthand names still map to the new marks.
  assert.equal(B.badgePlatformKey("GCN"), "GameCube");
  assert.equal(B.badgePlatformKey("NS2"), "Switch 2");
  assert.equal(B.badgePlatformKey("STM"), "Steam");
  assert.match(B.platformBadgeMarkup({ type: "game", platform: "GCN" }), /gamecube\.svg/);
  assert.match(B.platformBadgeMarkup({ type: "game", platform: "NS2" }), /switch2\.svg/);
  assert.match(B.platformBadgeMarkup({ type: "game", platform: "STM" }), /steam\.svg/);
});

check("PlayStation family is unchanged; PSP and PS Vita stay text", () => {
  for (const name of ["PSN", "PS1", "PS2", "PS3", "PS4", "PS5", "PlayStation 5", "ps4"]) {
    const html = B.platformBadgeMarkup({ type: "game", platform: name });
    assert.match(html, /playstation\.svg/, name);
    assert.doesNotMatch(html, /platform-badge-text/, name);
  }
  const psp = B.platformBadgeMarkup({ type: "game", platform: "PSP" });
  const psv = B.platformBadgeMarkup({ type: "game", platform: "PS Vita" });
  assert.match(psp, /platform-badge-text/);
  assert.match(psp, />PSP</);
  assert.doesNotMatch(psp, /playstation\.svg/);
  assert.match(psv, /platform-badge-text/);
  assert.match(psv, />PSV</);
  assert.doesNotMatch(psv, /playstation\.svg/);
});

check("Switch 2 is still checked before Switch; Switch keeps switch.svg", () => {
  const src = app.slice(app.indexOf("function badgePlatformKey"), app.indexOf("function platformBadgeMarkup"));
  const i2 = src.indexOf("Switch 2");
  const i1 = src.indexOf("Switch (Switch 2 already returned)");
  assert.ok(i2 >= 0 && i1 > i2, "Switch 2 rule must appear before the general Switch rule");
  const sw2 = B.platformBadgeMarkup({ type: "game", platform: "Nintendo Switch 2" });
  const sw1 = B.platformBadgeMarkup({ type: "game", platform: "Nintendo Switch" });
  assert.match(sw2, /switch2\.svg/);
  assert.doesNotMatch(sw2, /["']\.\/assets\/platforms\/switch\.svg/);
  assert.match(sw1, /switch\.svg/);
  assert.doesNotMatch(sw1, /switch2\.svg/);
  assert.equal(B.badgePlatformKey("Nintendo Switch 2"), "Switch 2");
  assert.equal(B.badgePlatformKey("Nintendo Switch"), "Switch");
});

check("SOURCES.md records Micah-supplied 2026-11-22 originals; SW precaches the new files", () => {
  assert.match(sources, /Micah-supplied, 2026-11-22/);
  for (const [, file] of NEW_MARKS) {
    assert.match(sources, new RegExp(file.replace(".", "\\.")));
    assert.match(sw, new RegExp("\\./assets/platforms/" + file.replace(".", "\\.")));
  }
  assert.match(sources, /switch2\.png/);
  assert.match(sources, /xbox-series-xs\.png/);
  assert.match(sources, /xbox-one\.png/);
  assert.match(sources, /xbox-360-transparent\.png/);
  assert.match(sources, /xbox-original\.png/);
  assert.match(sources, /gamecube\.png/);
  assert.match(sources, /steam\.png/);
});

check("wordmarks size by height at 9px with max-width 44px; squares stay in the 24px disc at 18px", () => {
  assert.match(v216, /platform-badge-wordmark/);
  assert.match(v216, /platform-badge-square/);
  const word = v216.match(/\.platform-badge\.platform-badge-wordmark\s*\{[^}]+\}/)[0];
  assert.match(word, /height:\s*24px/);
  assert.match(word, /max-width:\s*52px/);
  assert.match(word, /border-radius:\s*12px/);
  const wordImg = v216.match(/\.platform-badge-wordmark img\s*\{[^}]+\}/)[0];
  assert.match(wordImg, /max-width:\s*44px/);
  assert.match(wordImg, /height:\s*9px/);
  const squareImg = v216.match(/\.platform-badge-square img\s*\{[^}]+\}/)[0];
  assert.match(squareImg, /width:\s*18px/);
  assert.match(squareImg, /height:\s*18px/);
  // Position, scrim and inset are unchanged from V2.9
  const v29 = css.slice(css.indexOf("========== V2.9"));
  const disc = v29.match(/(?:^|\n)\.platform-badge\s*\{[^}]+\}/m)[0];
  assert.match(disc, /width:\s*24px/);
  assert.match(disc, /height:\s*24px/);
  assert.match(disc, /background:\s*rgba\(0,\s*0,\s*0,\s*0\.55\)/);
  assert.match(v29, /\.item-cover-fit \.platform-badge[\s\S]*right:\s*8px/);
  assert.match(v29, /\.item-cover-fit \.platform-badge[\s\S]*bottom:\s*8px/);
  const one = B.platformBadgeMarkup({ type: "game", platform: "Xbox One" });
  const cube = B.platformBadgeMarkup({ type: "game", platform: "GameCube" });
  assert.match(one, /platform-badge-wordmark/);
  assert.match(one, /width="44"/);
  assert.match(one, /height="9"/);
  assert.match(cube, /platform-badge-square/);
  assert.match(cube, /width="18"/);
  assert.match(cube, /height="18"/);
  const sw2 = B.platformBadgeMarkup({ type: "game", platform: "Switch 2" });
  const xs = B.platformBadgeMarkup({ type: "game", platform: "Series X|S" });
  assert.match(sw2, /platform-badge-wordmark/);
  assert.match(sw2, /switch2\.svg/);
  assert.match(sw2, /height="9"/);
  assert.match(xs, /platform-badge-wordmark/);
  assert.match(xs, /xbox-series-xs-trimmed\.svg/);
  assert.doesNotMatch(xs, /xbox-series-xs-full\.svg/);
  assert.match(xs, /height="9"/);
});

check("Series X|S uses the trimmed X|S-only mark; full mark is in the repo but unmapped", () => {
  const trimmed = path.join(root, "assets/platforms/xbox-series-xs-trimmed.svg");
  const full = path.join(root, "assets/platforms/xbox-series-xs-full.svg");
  assert.ok(fs.existsSync(trimmed));
  assert.ok(fs.existsSync(full));
  const html = B.platformBadgeMarkup({ type: "game", platform: "Series X|S" });
  assert.match(html, /xbox-series-xs-trimmed\.svg/);
  assert.doesNotMatch(html, /xbox-series-xs-full\.svg/);
  assert.match(app, /file:\s*"xbox-series-xs-trimmed\.svg"/);
  assert.doesNotMatch(app, /file:\s*"xbox-series-xs-full\.svg"/);
  assert.match(sources, /xbox-series-xs-full\.svg/);
  assert.match(sources, /Micah-approved 2026-11-22/);
  assert.match(sources, /alteration of Microsoft's mark/);
});

check("xbox.svg is retired from the precache; the file is kept", () => {
  assert.doesNotMatch(sw, /\.\/assets\/platforms\/xbox\.svg/);
  assert.ok(fs.existsSync(path.join(root, "assets/platforms/xbox.svg")));
  assert.match(sources, /retired/i);
  assert.match(sw, /\.\/assets\/platforms\/xbox-original\.svg/);
});

check("SOURCES records trademark owners, source sha256, and unknown upstream origin", () => {
  assert.match(sources, /Upstream origin \(where Micah obtained each file\) not recorded\./);
  assert.match(sources, /Nintendo/);
  assert.match(sources, /Microsoft/);
  assert.match(sources, /Valve Corporation/);
  assert.match(sources, /af63ee1cb5210028645f2b1cabaa129029687bc1ef132c7ee824e212abe99fe4/);
  assert.match(sources, /bb63f872b1f512688638b2735667ae9165530c5f9c679da6be74def6f16ae4bf/);
  assert.match(sources, /743c46e4bccfdf916b1b8a206efd55944580f0ecaaf917d616fc549afaba17ca/);
  assert.match(sources, /d4220ffc91e34f15147e3458cd327abbd111cac24219b558bb1ec9bb0e017b80/);
  assert.match(sources, /3e7f41e6e9cc04cf29002d05efd334bdd14ca23d84a945ec5dfb2d85344f6759/);
  assert.match(sources, /e02421331385f3a4c7b5ae0e90790baec281d47d4f481250882ed66d476ed7ef/);
  assert.match(sources, /9122acb9d4e64dc209d9670e0d7fba353a64789756782be812638b9758499554/);
});

check("original Xbox X is optically nudged in the disc", () => {
  const html = B.platformBadgeMarkup({ type: "game", platform: "Xbox" });
  assert.match(html, /platform-badge-xbox/);
  assert.match(html, /xbox-original\.svg/);
  assert.match(v2161, /platform-badge-xbox/);
  assert.match(v2161, /translate\(0\.6px,\s*-0\.6px\)/);
});

console.log(passed + " checks passed");
