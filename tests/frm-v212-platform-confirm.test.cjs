// V2.12: a barcode match listed on several platforms asks "<Title> came out on several platforms.
// Is this the <platform> copy?" before filling. Yes fills like Use (platform kept); Pick another goes
// back to the candidate list with nothing filled. Real app in headless Chrome; every provider is
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
const MULTI = { igdbId: "26226", title: "Celeste", creator: "Maddy Makes Games", year: 2018, platforms: ["Nintendo Switch", "PC (Microsoft Windows)", "PlayStation 4", "Xbox One"], coverUrl: "" };
const SINGLE = { igdbId: "1942", title: "Celeste Classic", creator: "Maddy Thorson", year: 2015, platforms: ["Nintendo Switch"], coverUrl: "" };

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

async function openPage(browser, base, width, candidates) {
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
    if (u.hostname === "query.wikidata.org") { calls.push("wikidata"); return r.fulfill({ contentType: "application/json", headers: hdr, body: JSON.stringify({ results: { bindings: [{ itemLabel: { value: "Celeste" }, platLabel: { value: "Nintendo Switch" } }] } }) }); }
    if (u.origin === RELAY && u.pathname === "/game/search") { calls.push("igdb:" + u.searchParams.get("title")); return r.fulfill({ contentType: "application/json", headers: hdr, body: JSON.stringify({ source: "igdb", candidates }) }); }
    calls.push("blocked:" + u.hostname); return r.abort();
  });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/"); await page.waitForSelector("#stats");
  await page.evaluate(() => document.getElementById("btn-add").click());
  await page.waitForSelector("#modal:not([hidden])");
  await page.selectOption("#field-type", "game");
  await page.selectOption("#field-platform", "Switch");
  return { ctx, page, calls, writes, errors };
}
async function scanLookup(page) { await page.fill("#field-barcode", "045496590741"); await page.click("#btn-lookup"); await page.waitForSelector("[data-game-pick]"); }
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
      check(`${width}: question names the title and the chosen platform`, q === "Celeste came out on several platforms. Is this the Switch copy?", q);
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
      if (SHOTS) { await page.evaluate(() => document.getElementById("game-match-picker").scrollIntoView({ block: "start" })); await page.waitForTimeout(150); await page.screenshot({ path: path.join(SHOTS, `pick-another-list-${width}.png`) }); }
      // Yes: fills like Use; the chosen platform stays Switch.
      await page.click('[data-game-pick="0"]'); await page.click("#game-match-use"); await page.click("#game-confirm-yes");
      await page.waitForFunction(() => document.getElementById("game-match-picker").hidden);
      const after = await form(page);
      check(`${width}: Yes fills title / IGDB id and keeps the chosen platform`, after.title === "Celeste" && after.igdb === "26226" && after.platform === "Switch", JSON.stringify(after));
      check(`${width}: nothing saved until Save; no writes; no page errors`, (await page.evaluate(() => JSON.parse(localStorage.getItem("media-tracker-v1")).items.length)) === 1 && writes.length === 0 && errors.length === 0, JSON.stringify({ writes, errors }));
      await ctx.close();
    }
    // Single-platform match: Use fills directly, as before (no confirm).
    {
      const { ctx, page } = await openPage(browser, base, 411, [MULTI, SINGLE]);
      await scanLookup(page);
      await page.click('[data-game-pick="1"]'); await page.click("#game-match-use");
      await page.waitForFunction(() => document.getElementById("game-match-picker").hidden);
      check("single-platform match: Use fills directly, no confirm", (await form(page)).igdb === "1942");
      await ctx.close();
    }
    // Title search (not a scan): unchanged, no confirm.
    {
      const { ctx, page } = await openPage(browser, base, 411, [MULTI]);
      await page.fill("#field-title", "Celeste");
      await page.click("#btn-game-title-lookup"); await page.waitForSelector("[data-game-pick]");
      await page.click('[data-game-pick="0"]'); await page.click("#game-match-use");
      await page.waitForFunction(() => document.getElementById("game-match-picker").hidden);
      check("title search: Use fills directly, no confirm (scan path only)", (await form(page)).igdb === "26226");
      await ctx.close();
    }
  } finally {
    await browser.close(); server.close();
  }
  console.log(`${passed}/${passed} passed (v2.12 barcode platform confirm; headless Chrome, mocked providers)`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
