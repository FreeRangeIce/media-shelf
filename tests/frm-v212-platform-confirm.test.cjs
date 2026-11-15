// V2.12: a barcode that Wikidata lists on several platforms (Sonic Frontiers, 5055277048182) no longer
// blocks when the chosen platform is among them; the manual scan asks "<Title> came out on several
// platforms. Is this the <platform> copy?" before filling. Yes fills like Use (platform kept); Pick
// another goes back to the candidate list with nothing filled. A barcode naming one platform never asks,
// even when IGDB lists several; a platform the barcode never names is still blocked. Real app in headless Chrome; every provider is
// mocked, nothing leaves the box. SHOTS=<dir> also writes the 344 / 411 captures.
"use strict";
const { strict: assert } = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("/workspace/pw-tools/node_modules/playwright-core");

const root = path.join(__dirname, "..");
const SHOTS = process.env.SHOTS || "";
const RELAY = "https://media-shelf-games.freerangeice.workers.dev";
const T0 = "2026-11-14T00:00:00.000Z";
const SHELF = { version: 1, savedAt: T0, items: [{ id: "g0", type: "game", title: "Hollow Knight", platform: "Switch", status: "owned", format: "physical", dateAdded: T0, dateUpdated: T0 }] };
const SONIC_BARCODE = "5055277048182";
// Wikidata answers every release platform, in no particular order (PS5 first, as seen live).
const SONIC_WIKIDATA = ["PlayStation 5", "Nintendo Switch", "PlayStation 4", "Xbox One", "Xbox Series X and Series S", "Microsoft Windows"].map((p) => ({ itemLabel: { value: "Sonic Frontiers" }, platLabel: { value: p } }));
const ONE_WIKIDATA = [{ itemLabel: { value: "Sonic Frontiers" }, platLabel: { value: "Nintendo Switch" } }];
const MULTI = { igdbId: "119133", title: "Sonic Frontiers", creator: "Sonic Team", year: 2022, platforms: ["PlayStation 5", "Nintendo Switch", "PlayStation 4", "Xbox One", "Xbox Series X|S", "PC (Microsoft Windows)"], coverUrl: "" };
const SINGLE = { igdbId: "1942", title: "Sonic Frontiers: Switch Edition", creator: "Sonic Team", year: 2022, platforms: ["Nintendo Switch"], coverUrl: "" };

function startServer() {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    if (rel === "/") rel = "/index.html";
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

let passed = 0;
const check = (name, ok, detail = "") => { assert.ok(ok, `${name} ${detail}`); passed += 1; console.log("PASS", name); };

async function openPage(browser, base, width, candidates, { wikidata = SONIC_WIKIDATA, platform = "Switch" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await ctx.addInitScript((shelf) => {
    if (sessionStorage.getItem("t")) return; sessionStorage.setItem("t", "1");
    localStorage.clear();
    localStorage.setItem("media-shelf-seeded", "2026-01-01T00:00:00Z");
    localStorage.setItem("media-shelf-last-backup", new Date().toISOString());
    localStorage.setItem("media-tracker-v1", JSON.stringify(shelf));
  }, SHELF);
  const calls = [], writes = [];
  await ctx.route("**/*", async (r) => {
    const req = r.request(), u = new URL(req.url());
    if (u.origin === base) return r.continue();
    if (!["GET", "HEAD"].includes(req.method())) { writes.push(req.url()); return r.abort(); }
    const hdr = { "Access-Control-Allow-Origin": "*" };
    if (u.hostname === "query.wikidata.org") { calls.push("wikidata"); return r.fulfill({ contentType: "application/json", headers: hdr, body: JSON.stringify({ results: { bindings: wikidata } }) }); }
    if (u.origin === RELAY && u.pathname === "/game/search") { calls.push("igdb:" + u.searchParams.get("title")); return r.fulfill({ contentType: "application/json", headers: hdr, body: JSON.stringify({ source: "igdb", candidates }) }); }
    calls.push("blocked:" + u.hostname); return r.abort();
  });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/"); await page.waitForSelector("#stats");
  await page.evaluate(() => document.getElementById("btn-add").click());
  await page.waitForSelector("#modal:not([hidden])");
  await page.selectOption("#field-type", "game");
  await page.selectOption("#field-platform", platform);
  return { ctx, page, calls, writes, errors };
}
async function scanLookup(page) { await page.fill("#field-barcode", SONIC_BARCODE); await page.click("#btn-lookup"); await page.waitForSelector("[data-game-pick]"); }
const form = (page) => page.evaluate(() => ({ title: document.getElementById("field-title").value, platform: document.getElementById("field-platform").value, igdb: document.getElementById("field-igdb-id").value, year: document.getElementById("field-year") ? document.getElementById("field-year").value : "" }));

(async () => {
  const { server, base } = await startServer();
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const width of [344, 411]) {
      const { ctx, page, calls, writes, errors } = await openPage(browser, base, width, [MULTI, SINGLE]);
      await scanLookup(page);
      const before = await form(page);
      await page.click('[data-game-pick="0"]'); await page.click("#game-match-use");
      await page.waitForSelector("#game-confirm-yes");
      const q = (await page.textContent("#game-match-heading")).trim();
      check(`${width}: question names the title and the chosen platform`, q === "Sonic Frontiers came out on several platforms. Is this the Switch copy?", q);
      check(`${width}: focus moves to the question`, await page.evaluate(() => document.activeElement && document.activeElement.id === "game-match-heading"));
      const ui = await page.evaluate(() => {
        const st = (id) => { const e = document.getElementById(id), c = getComputedStyle(e), b = e.getBoundingClientRect(); return { text: e.textContent.trim(), bg: c.backgroundColor, color: c.color, border: c.borderColor, h: b.height, w: b.width, top: b.top, bottom: b.bottom }; };
        const q = getComputedStyle(document.getElementById("game-match-heading"));
        return { yes: st("game-confirm-yes"), other: st("game-confirm-other"), qColor: q.color, scrollW: document.documentElement.scrollWidth, vw: innerWidth, list: document.querySelectorAll("[data-game-pick]").length };
      });
      check(`${width}: "Yes, add it" is filled #8B5E3C with white text, 44px`, ui.yes.text === "Yes, add it" && ui.yes.bg === "rgb(139, 94, 60)" && ui.yes.color === "rgb(255, 255, 255)" && ui.yes.h >= 44, JSON.stringify(ui.yes));
      check(`${width}: "Pick another" is outlined, 44px`, ui.other.text === "Pick another" && ui.other.bg === "rgba(0, 0, 0, 0)" && ui.other.border !== "rgba(0, 0, 0, 0)" && ui.other.h >= 44, JSON.stringify(ui.other));
      check(`${width}: no warning color on the question; no horizontal scroll`, !/rgb\((1[5-9]\d|2\d\d), (\d|[1-9]\d), (\d|[1-9]\d)\)/.test(ui.qColor) && ui.scrollW <= ui.vw, ui.qColor);
      check(`${width}: nothing filled before Yes`, JSON.stringify(await form(page)) === JSON.stringify(before));
      // Touch contexts never apply :hover, so read the rule itself.
      const hover = await page.evaluate(() => { for (const sh of document.styleSheets) { for (const r of sh.cssRules) { if (r.selectorText === "#game-match-picker .game-confirm-yes:hover") return r.style.backgroundColor + "|" + r.style.color; } } return ""; });
      check(`${width}: hover #7a5234 with white text`, hover === "rgb(122, 82, 52)|rgb(255, 255, 255)", hover);
      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.locator("#game-match-picker").scrollIntoViewIfNeeded();
        await page.evaluate(() => { const p = document.getElementById("game-match-picker"); p.scrollIntoView({ block: "center" }); });
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(SHOTS, `platform-confirm-${width}.png`) });
      }
      // Pick another: back to the list, nothing filled, Use needs a new choice.
      await page.click("#game-confirm-other");
      await page.waitForSelector("[data-game-pick]");
      check(`${width}: Pick another returns to the candidate list, nothing filled, Use disabled`, (await page.$$("[data-game-pick]")).length === 2 && JSON.stringify(await form(page)) === JSON.stringify(before) && await page.isDisabled("#game-match-use"));
      check(`${width}: Pick another sends no new request`, calls.filter((c) => c.startsWith("igdb:")).length === 1, JSON.stringify(calls));
      // V2.12b list layout: heading like "Add item" with 24px above; Use first, Cancel after, left-aligned, 8px, 44px.
      const lay = async () => page.evaluate(() => {
        const r = (e) => e.getBoundingClientRect();
        const h = document.getElementById("game-match-heading"), t = document.getElementById("modal-title");
        const hc = getComputedStyle(h), tc = getComputedStyle(t);
        const row = document.querySelector("#game-match-picker .lookup-actions");
        const btns = [...row.querySelectorAll("button")];
        const use = document.getElementById("game-match-use"), cancel = document.getElementById("game-match-cancel"), uc = getComputedStyle(use), cc = getComputedStyle(cancel);
        const card = document.querySelector("[data-game-pick]");
        let hover = "";
        for (const sh of document.styleSheets) for (const rule of sh.cssRules) if (rule.selectorText === "#game-match-picker #game-match-use:not(:disabled):hover") hover = rule.style.backgroundColor + "|" + rule.style.color;
        return { padTop: hc.paddingTop, size: [hc.fontSize, hc.fontWeight, hc.lineHeight], title: [tc.fontSize, tc.fontWeight, tc.lineHeight], order: btns.map((b) => b.id),
          useLeft: Math.round(r(use).left), cardLeft: Math.round(r(card).left), gap: Math.round(r(cancel).left - r(use).right), sameRow: Math.round(r(use).top) === Math.round(r(cancel).top),
          useH: r(use).height, cancelH: r(cancel).height, use: [uc.backgroundColor, uc.color, uc.borderColor], cancel: [cc.backgroundColor, cc.borderColor], hover };
      });
      const L0 = await lay();
      check(`${width}: list heading has 24px above it and matches "Add item" size/weight`, L0.padTop === "24px" && JSON.stringify(L0.size) === JSON.stringify(L0.title), JSON.stringify(L0));
      check(`${width}: Use this match first, Cancel lookup after, left-aligned with the cards, 8px gap, one row, 44px`, L0.order.join() === "game-match-use,game-match-cancel" && L0.useLeft === L0.cardLeft && L0.gap === 8 && L0.sameRow && L0.useH >= 44 && L0.cancelH >= 44, JSON.stringify(L0));
      check(`${width}: Use keeps the gray disabled outline until a match is picked; Cancel outlined`, L0.use[0] === "rgba(0, 0, 0, 0)" && L0.use[1] === "rgb(154, 144, 136)" && L0.cancel[0] === "rgba(0, 0, 0, 0)" && L0.cancel[1] !== "rgba(0, 0, 0, 0)", JSON.stringify(L0));
      if (SHOTS) { await page.evaluate(() => document.getElementById("game-match-picker").scrollIntoView({ block: "start" })); await page.waitForTimeout(150); await page.screenshot({ path: path.join(SHOTS, `pick-another-list-${width}.png`) }); }
      await page.click('[data-game-pick="0"]');
      await page.waitForFunction(() => !document.getElementById("game-match-use").disabled);
      await page.waitForTimeout(350); // let the button's color transition finish
      const L1 = await lay();
      check(`${width}: once picked, Use is filled #8B5E3C with white text (hover #7a5234)`, L1.use[0] === "rgb(139, 94, 60)" && L1.use[1] === "rgb(255, 255, 255)" && L1.hover === "rgb(122, 82, 52)|rgb(255, 255, 255)", JSON.stringify(L1));
      if (SHOTS) { await page.waitForTimeout(100); await page.screenshot({ path: path.join(SHOTS, `pick-another-list-selected-${width}.png`) }); }
      // Yes: fills like Use; the chosen platform stays Switch.
      await page.click('[data-game-pick="0"]'); await page.click("#game-match-use"); await page.click("#game-confirm-yes");
      await page.waitForFunction(() => document.getElementById("game-match-picker").hidden);
      const after = await form(page);
      check(`${width}: Yes fills title / IGDB id and keeps the chosen platform`, after.title === "Sonic Frontiers" && after.igdb === "119133" && after.platform === "Switch", JSON.stringify(after));
      check(`${width}: nothing saved until Save; no writes; no page errors`, (await page.evaluate(() => JSON.parse(localStorage.getItem("media-tracker-v1")).items.length)) === 1 && writes.length === 0 && errors.length === 0, JSON.stringify({ writes, errors }));
      await ctx.close();
    }
    // A barcode naming one platform: Use fills directly, as before, even though IGDB lists several.
    {
      const { ctx, page } = await openPage(browser, base, 411, [MULTI, SINGLE], { wikidata: ONE_WIKIDATA });
      await scanLookup(page);
      await page.click('[data-game-pick="0"]'); await page.click("#game-match-use");
      await page.waitForFunction(() => document.getElementById("game-match-picker").hidden);
      const f = await form(page);
      check("single-platform barcode: Use fills directly, no confirm (IGDB's platform list doesn't trigger it)", f.igdb === "119133" && f.platform === "Switch", JSON.stringify(f));
      await ctx.close();
    }
    // PS4 / PS5 chosen: no block either; the chosen platform stays.
    for (const plat of ["PS4", "PS5"]) {
      const { ctx, page } = await openPage(browser, base, 411, [MULTI], { platform: plat });
      await scanLookup(page);
      await page.click('[data-game-pick="0"]'); await page.click("#game-match-use");
      await page.waitForSelector("#game-confirm-yes");
      const q = (await page.textContent("#game-match-heading")).trim();
      await page.click("#game-confirm-yes");
      await page.waitForFunction(() => document.getElementById("game-match-picker").hidden);
      const f = await form(page);
      check(`Sonic barcode under ${plat}: not blocked, confirm names ${plat}, platform kept`, q.endsWith(`Is this the ${plat} copy?`) && f.platform === plat && f.igdb === "119133", JSON.stringify({ q, f }));
      await ctx.close();
    }
    // A platform the barcode never names (Wii U) keeps the hard block; nothing is filled, IGDB isn't asked.
    {
      const { ctx, page, calls } = await openPage(browser, base, 411, [MULTI], { platform: "Wii U" });
      await page.fill("#field-barcode", SONIC_BARCODE); await page.click("#btn-lookup");
      await page.waitForFunction(() => /different platform/.test(document.getElementById("lookup-status") ? document.getElementById("lookup-status").textContent : document.body.textContent));
      const f = await form(page);
      check("Sonic barcode under Wii U: still blocked, nothing filled, no IGDB request", f.title === "" && f.platform === "Wii U" && !calls.some((c) => c.startsWith("igdb:")) && await page.isHidden("#game-match-picker"), JSON.stringify({ f, calls }));
      await ctx.close();
    }
    // Title search (not a scan): unchanged, no confirm.
    {
      const { ctx, page } = await openPage(browser, base, 411, [MULTI]);
      await page.fill("#field-title", "Sonic Frontiers");
      await page.click("#btn-game-title-lookup"); await page.waitForSelector("[data-game-pick]");
      await page.click('[data-game-pick="0"]'); await page.click("#game-match-use");
      await page.waitForFunction(() => document.getElementById("game-match-picker").hidden);
      check("title search: Use fills directly, no confirm (scan path only)", (await form(page)).igdb === "119133");
      await ctx.close();
    }
  } finally {
    await browser.close(); server.close();
  }
  console.log(`${passed}/${passed} passed (v2.12 barcode platform confirm; headless Chrome, mocked providers)`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
