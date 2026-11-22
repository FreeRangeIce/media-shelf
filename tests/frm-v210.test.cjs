// V2.10: display-time platform badge mapping, 9px 3-char text badges, Wii U mark size,
// sticky-header scroll padding, and navy/blue Expansion pills.
"use strict";
const { strict: assert } = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const ttSrc = fs.readFileSync(path.join(root, "tabletop.js"), "utf8");
const T = require(path.join(root, "tabletop.js"));
const v210 = css.slice(css.indexOf("========== V2.10"));
assert.ok(v210.length > 200, "V2.10 CSS block missing");

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

function hexToRgb(hex) {
  return String(hex)
    .replace("#", "")
    .match(/../g)
    .map((h) => parseInt(h, 16));
}

const B = loadBadgeFns();

check("APP_VERSION 2.15.1 and cache media-shelf-v2.15.1, no suffixes", () => {
  assert.match(app, /const APP_VERSION = "2\.15.1";/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.15.1";/);
  assert.doesNotMatch(app, /const APP_VERSION = "2\.12-/);
  assert.doesNotMatch(sw, /media-shelf-v2\.15.1-/);
  assert.doesNotMatch(app, /const APP_VERSION = "2\.9";/);
  assert.doesNotMatch(sw, /const CACHE = "media-shelf-v2\.9";/);
});

check("badge mapping: required names and every common variant", () => {
  const expect = [
    // Required names from the brief
    ["Switch 2", "Switch 2"],
    ["Nintendo Switch 2", "Switch 2"],
    ["PSN", "PSN"],
    ["PlayStation 5", "PS5"],
    ["Xbox Series X|S", "Series X|S"],
    ["Wii", "Wii"],
    ["Wii U", "Wii U"],
    // Switch 2 / NS2 first
    ["NS2", "Switch 2"],
    ["ns2", "Switch 2"],
    ["switch 2", "Switch 2"],
    ["nintendo switch 2", "Switch 2"],
    // Switch family
    ["Switch", "Switch"],
    ["Nintendo Switch", "Switch"],
    ["nintendo switch", "Switch"],
    ["NINTENDO SWITCH", "Switch"],
    // PlayStation family
    ["psn", "PSN"],
    ["PlayStation", "PSN"],
    ["playstation", "PSN"],
    ["PS1", "PS1"],
    ["PS2", "PS2"],
    ["PS3", "PS3"],
    ["PS4", "PS4"],
    ["PS5", "PS5"],
    ["ps4", "PS4"],
    ["ps5", "PS5"],
    ["PlayStation 1", "PS1"],
    ["PlayStation 4", "PS4"],
    ["playstation 5", "PS5"],
    // Xbox family, including 360
    ["Xbox", "Xbox"],
    ["xbox", "Xbox"],
    ["Xbox One", "Xbox One"],
    ["Xbox 360", "Xbox 360"],
    ["360", "Xbox 360"],
    ["xbox 360", "Xbox 360"],
    ["Series X|S", "Series X|S"],
    ["xbox series x|s", "Series X|S"],
    // Wii U before Wii
    ["wii u", "Wii U"],
    ["WiiU", "Wii U"],
    ["wiiu", "Wii U"],
    ["wii", "Wii"],
    // Text platforms
    ["GameCube", "GameCube"],
    ["gamecube", "GameCube"],
    ["GCN", "GameCube"],
    ["Steam", "Steam"],
    ["steam", "Steam"],
    ["STM", "Steam"],
    ["PC", "PC"],
    ["pc", "PC"],
    ["Other", "Other"],
  ];
  for (const [input, key] of expect) {
    assert.equal(B.badgePlatformKey(input), key, `${input} -> ${key}`);
  }
});

check("badge mapping: PSP and PS Vita stay text (PSP, PSV), not the PlayStation logo", () => {
  const cases = [
    ["PSP", "PSP"], ["psp", "PSP"], ["PlayStation Portable", "PSP"],
    ["PS Vita", "PSV"], ["ps vita", "PSV"], ["PlayStation Vita", "PSV"], ["Playstation Vita", "PSV"], ["Vita", "PSV"], ["PSVita", "PSV"],
  ];
  for (const [name, abbr] of cases) {
    assert.equal(B.badgePlatformKey(name), abbr === "PSP" ? "PSP" : "PS Vita", name);
    const html = B.platformBadgeMarkup({ type: "game", platform: name });
    assert.match(html, /platform-badge-text/, name);
    assert.match(html, new RegExp(">" + abbr + "<"), name);
    assert.doesNotMatch(html, />PS </, name);
    assert.doesNotMatch(html, /playstation\.svg/, name);
  }
});

check("badge mapping: unknown and multi-name stay text (3 chars); stored values unused", () => {
  assert.equal(B.badgePlatformKey("Atari Jaguar CD"), "");
  const atari = B.platformBadgeMarkup({ type: "game", platform: "Atari Jaguar CD" });
  assert.match(atari, />ATA</);
  assert.doesNotMatch(atari, />ATAR</);
  const multi = B.platformBadgeMarkup({ type: "game", platform: "PS5, Switch" });
  assert.match(multi, /platform-badge-text/);
  assert.doesNotMatch(multi, /playstation\.svg|switch\.svg/);
  const item = { type: "game", platform: "PlayStation" };
  B.platformBadgeMarkup(item);
  assert.equal(item.platform, "PlayStation", "stored platform must not be rewritten");
});

check("badge markup: PSN / long names / lowercase share one logo per family", () => {
  const cases = [
    ["PSN", "playstation.svg"],
    ["PlayStation", "playstation.svg"],
    ["PlayStation 5", "playstation.svg"],
    ["ps4", "playstation.svg"],
    ["Nintendo Switch", "switch.svg"],
    ["Switch", "switch.svg"],
    ["Xbox Series X|S", "xbox.svg"],
    ["Xbox One", "xbox.svg"],
    ["Xbox 360", "xbox.svg"],
    ["Wii", "wii.svg"],
    ["Wii U", "wiiu.svg"],
  ];
  for (const [name, file] of cases) {
    const html = B.platformBadgeMarkup({ type: "game", platform: name });
    assert.match(html, new RegExp(file.replace(".", "\\.")), name);
    assert.doesNotMatch(html, /platform-badge-text/, name);
  }
  const ns2 = B.platformBadgeMarkup({ type: "game", platform: "Nintendo Switch 2" });
  assert.match(ns2, />NS2</);
  assert.doesNotMatch(ns2, /switch\.svg/);
  const steam = B.platformBadgeMarkup({ type: "game", platform: "Steam" });
  assert.match(steam, />STM</);
  const gcn = B.platformBadgeMarkup({ type: "game", platform: "GameCube" });
  assert.match(gcn, />GCN</);
});

check("display-time only: normalizePlatform / backup keys / routes are not rewritten by badge code", () => {
  assert.match(app, /function badgePlatformKey/);
  assert.match(app, /const key = badgePlatformKey\(raw\)/);
  assert.doesNotMatch(app, /item\.platform\s*=\s*badgePlatformKey/);
  assert.match(app, /const STORAGE_KEY = "media-tracker-v1"/);
});

check("24px disc, 8px inset, and Duo 80px / 559px clearance are unchanged", () => {
  assert.match(v210, /24px disc/);
  // The V2.9 disc rules remain
  const v29 = css.slice(css.indexOf("========== V2.9"));
  const disc = v29.match(/(?:^|\n)\.platform-badge\s*\{[^}]+\}/m)[0];
  assert.match(disc, /width:\s*24px/);
  assert.match(disc, /height:\s*24px/);
  assert.match(v29, /\.item-cover-fit \.platform-badge[\s\S]*right:\s*8px/);
  assert.match(v29, /\.item-cover-fit \.platform-badge[\s\S]*bottom:\s*8px/);
  assert.match(css, /--frm-duo-hub-clearance:\s*80px/);
  assert.match(css, /@media \(max-width:\s*559px\)[\s\S]*--frm-duo-hub-clearance/);
  assert.doesNotMatch(v210, /frm-duo-hub-clearance/);
});

check("text badges are 9px bold; Wii U mark is ~18px by at least 7px", () => {
  const text = v210.match(/\.platform-badge-text\s*\{[^}]+\}/)[0];
  assert.match(text, /font-size:\s*9px/);
  assert.match(text, /font-weight:\s*700/);
  assert.match(text, /text-align:\s*center/);
  const wiiu = v210.match(/\.platform-badge-wiiu img\s*\{[^}]+\}/)[0];
  assert.match(wiiu, /width:\s*18px/);
  assert.match(wiiu, /height:\s*7px/);
  assert.match(wiiu, /min-height:\s*7px/);
  assert.match(app, /platform-badge-wiiu/);
});

check("scroll-padding-top is the measured header height + 8px, header not compacted", () => {
  assert.match(v210, /scroll-padding-top:\s*var\(--frm-sticky-pad,\s*0px\)/);
  assert.match(app, /function syncStickyHeaderPad/);
  assert.match(app, /function watchStickyHeaderPad/);
  assert.match(app, /ResizeObserver/);
  assert.match(app, /\$\{h \+ 8\}px/);
  assert.match(app, /watchStickyHeaderPad\(\);/);
  assert.doesNotMatch(v210, /\.frm-site-header[^{]*\{[^}]*height:\s*\d+px/);
});

check("navy and blue covers sample a fill; white text is at least 4.5:1; no pink swap", () => {
  function solid(rgb) {
    const buf = new Uint8ClampedArray(16);
    for (let i = 0; i < 16; i += 4) {
      buf[i] = rgb[0];
      buf[i + 1] = rgb[1];
      buf[i + 2] = rgb[2];
      buf[i + 3] = 255;
    }
    return buf;
  }
  const navy = [0x10, 0x10, 0x40];
  const blue = [0x1e, 0x3c, 0xc8];
  const navyHue = T.dominantHueFromPixels(solid(navy), 2, 2);
  const blueHue = T.dominantHueFromPixels(solid(blue), 2, 2);
  assert.ok(navyHue, "navy #101040 must be sampled");
  assert.ok(blueHue, "blue #1e3cc8 must be sampled");
  const navyColors = T.pillColorsFromRgb(navyHue);
  const blueColors = T.pillColorsFromRgb(blueHue);
  assert.equal(navyColors.text, "#ffffff");
  assert.equal(blueColors.text, "#ffffff");
  assert.notEqual(navyColors.fill.toLowerCase(), "#8c1d5a");
  assert.notEqual(blueColors.fill.toLowerCase(), "#8c1d5a");
  assert.ok(T.contrastRatioRgb(hexToRgb(navyColors.fill), [255, 255, 255]) >= 4.5, navyColors.fill);
  assert.ok(T.contrastRatioRgb(hexToRgb(blueColors.fill), [255, 255, 255]) >= 4.5, blueColors.fill);

  // Near-gray and near-black still have no sample → CSS fallback #8c1d5a
  const grey = new Uint8ClampedArray([12, 12, 12, 255, 250, 250, 250, 255, 128, 128, 128, 255, 20, 20, 20, 255]);
  assert.equal(T.dominantHueFromPixels(grey, 2, 2), null);
  // A light yellow is darkened until white text passes, not swapped to pink
  const yellow = T.pillColorsFromRgb([250, 230, 80]);
  assert.equal(yellow.text, "#ffffff");
  assert.notEqual(yellow.fill.toLowerCase(), "#8c1d5a");
  assert.ok(T.contrastRatioRgb(hexToRgb(yellow.fill), [255, 255, 255]) >= 4.5, yellow.fill);
});

check("badgePlatformKey is not used to write storage; cache name scheme unchanged aside from v2.10", () => {
  assert.match(ttSrc, /function dominantHueFromPixels/);
  assert.match(ttSrc, /sat < 0\.20/);
  assert.match(ttSrc, /function darkenRgbForWhiteText/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.15.1"/);
});

console.log(`${passed}/${passed} passed (v2.10 badge mapping + text size + Wii U + pills + scroll pad)`);
