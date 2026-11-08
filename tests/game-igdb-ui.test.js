// Local headless browser tests. Every provider request is intercepted; no real POSTs, screenshots
// or device claims. Includes one-result selection, split path, races, old data and failures.
const { chromium } = require("playwright-core");
const fs = require("fs");
const ORIGIN = process.env.TT_ORIGIN || "http://127.0.0.1:8894";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(ORIGIN)) throw new Error("Local origin required");
const RELAY = "http://127.0.0.1:8796";
const result = { igdbId: "42", title: "Switchblade - Definitive Edition", year: 2020, creator: "Example Studio", platforms: ["Nintendo Switch"], coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co123.jpg" };
const stamp = "2026-10-01T10:00:00Z";
const shelf = [
 { id: "legacy", type: "game", title: "Legacy game", platform: "Switch", rawgId: "777", externalId: "rawg-legacy-external", coverSource: "rawg", coverSourceId: "777", coverUrl: "https://media.rawg.io/legacy.jpg", status: "owned", dateAdded: stamp, dateUpdated: stamp },
 { id: "blank", type: "game", title: "No cover game", platform: "Switch", coverUrl: "", status: "owned", dateAdded: stamp, dateUpdated: stamp }
];
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : " " + d}`); };
const store = p => p.evaluate(() => JSON.parse(localStorage.getItem("media-tracker-v1")).items);
async function open(browser, { configured = true, candidates = [result], status = 200, delay = 0, barcodeTitle = "Switchblade - Definitive Edition (Nintendo Switch)", wikidata = false, upcStatus = 200, failNetwork = false, items = shelf } = {}) {
 const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
 await ctx.addInitScript(({ configured, relay, items }) => {
  if (configured) window.__FRM_GAME_RELAY__ = relay;
  if (sessionStorage.getItem("test-init")) return;
  sessionStorage.setItem("test-init", "1");
  localStorage.clear();
  localStorage.setItem("media-shelf-seeded", "2026-01-01T00:00:00Z");
  localStorage.setItem("media-tracker-v1", JSON.stringify({ version: 1, items }));
  localStorage.setItem("media-shelf-rawg-key", "dummy-legacy-key");
 }, { configured, relay: RELAY, items });
 const requests = [], writes = [], errors = [];
 await ctx.route("**/*", async r => {
  const req = r.request(), url = new URL(req.url());
  if (!["GET", "HEAD"].includes(req.method())) { writes.push(req.url()); return r.abort(); }
  if (url.origin === RELAY) {
   requests.push({ kind: "igdb", title: url.searchParams.get("title"), url: req.url() });
   if (delay) await new Promise(resolve => setTimeout(resolve, delay));
   if (failNetwork) return r.abort();
   return r.fulfill({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Expose-Headers": "Retry-After", "Retry-After": "120" }, body: JSON.stringify(status === 200 ? { source: "igdb", candidates } : { error: "provider_busy" }) });
  }
  if (url.hostname === "query.wikidata.org") { requests.push({ kind: "wikidata" }); return r.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": ORIGIN }, body: JSON.stringify({ results: { bindings: wikidata && barcodeTitle ? [{ itemLabel: { value: barcodeTitle }, platLabel: { value: "Nintendo Switch" } }] : [] } }) }); }
  if (url.hostname === "api.upcitemdb.com") { requests.push({ kind: "upc" }); return r.fulfill({ status: upcStatus, contentType: "application/json", headers: { "Access-Control-Allow-Origin": ORIGIN, "Retry-After": "120", "Access-Control-Expose-Headers": "Retry-After" }, body: JSON.stringify({ items: barcodeTitle ? [{ title: barcodeTitle }] : [] }) }); }
  if (url.origin === ORIGIN) {
   if (process.env.GAME_UI_SOURCE && url.pathname === "/app.js") return r.fulfill({ contentType: "application/javascript", body: fs.readFileSync(process.env.GAME_UI_SOURCE) });
   return r.continue();
  }
  requests.push({ kind: "blocked", host: url.hostname }); return r.abort();
 });
 const page = await ctx.newPage(); if (process.env.GAME_UI_SOURCE) page.setDefaultTimeout(2000); page.on("pageerror", e => errors.push(String(e)));
 await page.goto(ORIGIN + "/"); await page.waitForSelector("#stats .stat-pill");
 return { ctx, page, requests, writes, errors };
}
async function form(p) { await p.click("#btn-add"); await p.waitForSelector("#modal:not([hidden])"); await p.selectOption("#field-type", "game"); await p.selectOption("#field-platform", "Switch"); }
async function barcode(p) { await p.fill("#field-barcode", "012345678901"); await p.click("#btn-lookup"); }
async function choose(p, index = 0) { await p.click(`[data-game-pick="${index}"]`); await p.click("#game-match-use"); }
(async () => {
 const browser = await chromium.launch({ env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^TWITCH_/.test(key))), executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
 try {
  {
   const s = await open(browser, { configured: false }); const p = s.page; await form(p);
   check("unconfigured title search hidden", await p.isHidden("#btn-game-title-lookup"));
   await barcode(p); await p.waitForFunction(() => !document.querySelector("#btn-lookup").disabled);
   check("barcode-only lookup does not require Title", s.requests.some(r => r.kind === "upc") && await p.inputValue("#field-title") === "");
   check("unconfigured relay receives no request and gives actionable status", !s.requests.some(r => r.kind === "igdb") && /not configured/.test(await p.textContent("#lookup-status")));
   check("old RAWG key never requested or sent", !s.requests.some(r => r.host === "api.rawg.io") && !JSON.stringify(s.requests).includes("dummy-legacy-key"));
   check("manual fields/shelf preserved without relay", (await store(p)).length === 2 && await p.inputValue("#field-cover") === "");
   await s.ctx.close();
  }
  {
   const s = await open(browser); const p = s.page; await form(p); await barcode(p); await p.waitForSelector("#game-match-picker:not([hidden])");
   check("barcode flow is Wikidata then UPCitemdb then IGDB title only", s.requests.filter(r => r.kind !== "blocked").map(r => r.kind).join(",") === "wikidata,upc,igdb");
   check("raw dashed/edition product title retained in conservative query", s.requests.find(r => r.kind === "igdb").title === "Switchblade - Definitive Edition (Nintendo Switch)");
   check("ONE result never autofills cover/details/title", await p.inputValue("#field-title") === "" && await p.inputValue("#field-cover") === "" && await p.inputValue("#field-year") === "");
   check("one-result choice requires a tap before Use", await p.isDisabled("#game-match-use") && await p.locator("[data-game-pick]").count() === 1);
   check("Save becomes outline while choosing", await p.$eval('#modal .form-actions .btn-primary', el => getComputedStyle(el).backgroundColor) === "rgba(0, 0, 0, 0)");
   await p.evaluate(() => { document.querySelector("#field-title").value = "Manual save probe"; document.querySelector("#item-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
   check("Save without choosing cannot accidentally save the candidate or manual form", (await store(p)).length === 2 && /cancel the selection/.test(await p.textContent("#lookup-status")));
   await p.evaluate(() => { document.querySelector("#field-title").value = ""; });
   await choose(p);
   check("explicit selection fills title/cover/details and separate IGDB ID", await p.inputValue("#field-title") === result.title && await p.inputValue("#field-cover") === result.coverUrl && await p.inputValue("#field-igdb-id") === "42");
   check("selection itself never saves", (await store(p)).length === 2);
   await p.locator('#modal .form-actions button[type="submit"]').click(); await p.waitForFunction(() => document.querySelector("#modal").hidden);
   const saved = (await store(p)).find(g => g.igdbId === "42");
   check("Save stores explicit IGDB title and cover URL without guessed RAWG ID", saved?.title === result.title && saved.coverUrl === result.coverUrl && saved.rawgId === "" && saved.coverSource === "igdb");
   const [dl] = await Promise.all([p.waitForEvent("download"), p.evaluate(() => document.querySelector("#btn-export").click())]);
   const exported = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
   check("export retains both new IGDB and untouched legacy RAWG fields", exported.items.some(g => g.igdbId === "42") && exported.items.some(g => g.rawgId === "777" && g.coverUrl === shelf[0].coverUrl));
   check("no provider writes or browser errors", s.writes.length === 0 && s.errors.length === 0, s.errors.join(" | "));
   await s.ctx.close();
   // Actual import through the existing backup/import flow into a fresh empty shelf.
   const imported = await open(browser, { items: [] });
   await imported.page.setInputFiles("#import-file", { name: "igdb-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)) });
   await imported.page.waitForSelector("#confirm:not([hidden])");
   await imported.page.click("#confirm-ok"); await imported.page.waitForTimeout(250);
   check("backup import preserves IGDB and old RAWG identities", (await store(imported.page)).some(g => g.igdbId === "42") && (await store(imported.page)).some(g => g.rawgId === "777"));
   await imported.ctx.close();
   // Focused negative control: the same strict one-result assertions must detect
   // an application response mutation that autofills the first candidate.
   if (process.env.GAME_UI_SOURCE) { console.log(`\n${pass}/${pass+fail} passed (focused control)`); process.exitCode = fail ? 1 : 0; return; }
  }
  {
   const s = await open(browser, { wikidata: true }); const p = s.page; await form(p); await barcode(p); await p.waitForSelector("#game-match-picker:not([hidden])");
   check("Wikidata barcode hit skips UPCitemdb", !s.requests.some(r => r.kind === "upc") && s.requests.some(r => r.kind === "igdb"));
   await s.ctx.close();
  }
  {
   const s = await open(browser, { barcodeTitle: "Hades (PlayStation 5)" }); const p = s.page; await form(p); await barcode(p); await p.waitForFunction(() => !document.querySelector("#btn-lookup").disabled);
   check("barcode platform mismatch does not query IGDB or change platform", !s.requests.some(r => r.kind === "igdb") && await p.inputValue("#field-platform") === "Switch" && /different platform/.test(await p.textContent("#lookup-status")));
   await s.ctx.close();
  }
  for (const typed of ["", "012345678901"]) {
   const s = await open(browser); const p = s.page; await form(p); await p.fill("#field-title", typed); await p.click("#btn-game-title-lookup");
   check(`title search rejects ${typed || "empty title"} without providers`, !s.requests.some(r => r.kind === "igdb" || r.kind === "upc" || r.kind === "wikidata")); await s.ctx.close();
  }
  {
   const candidates = [{ ...result, igdbId: "43", title: "Wrong platform", platforms: ["PlayStation 5"] }, result, { ...result, igdbId: "44", title: "Another edition", coverUrl: "" }];
   const s = await open(browser, { candidates }); const p = s.page; await form(p); await p.fill("#field-title", "Manual title"); await p.fill("#field-creator", "Manual creator"); await p.fill("#field-cover", "https://example.invalid/my-cover.jpg");
   await p.click("#btn-game-title-lookup"); await p.waitForSelector("#game-match-picker:not([hidden])");
   check("title path queries IGDB, never barcode vendors", s.requests.filter(r => r.kind !== "blocked").every(r => r.kind === "igdb"));
   check("wrong-platform candidate cannot be selected", await p.isDisabled('[data-game-pick="0"]'));
   check("multiple/ambiguous results require selection and preserve filled fields", await p.locator("[data-game-pick]").count() === 3 && await p.inputValue("#field-title") === "Manual title" && await p.inputValue("#field-creator") === "Manual creator");
   await choose(p, 1); await p.waitForSelector("#confirm:not([hidden])");
   check("explicit Use still does not silently overwrite manual cover/title", await p.inputValue("#field-title") === "Manual title" && await p.inputValue("#field-cover") === "https://example.invalid/my-cover.jpg");
   await p.click("#confirm-cancel");
   check("cancel overwrite retains manual fields", await p.inputValue("#field-title") === "Manual title" && await p.inputValue("#field-creator") === "Manual creator");
   await s.ctx.close();
  }
  {
   const s = await open(browser, { candidates: Array.from({ length: 5 }, (_, i) => ({ ...result, igdbId: String(100 + i), coverUrl: i ? "" : result.coverUrl })) }); const p = s.page;
   await form(p); await barcode(p); await p.waitForSelector("#game-match-picker:not([hidden])"); await p.waitForTimeout(100);
   check("five results still require a deliberate selection", await p.locator("[data-game-pick]").count() === 5 && await p.isDisabled("#game-match-use") && await p.inputValue("#field-title") === "");
   const frames = await p.$$eval('.game-match-cover', els => els.map(e => { const r = e.getBoundingClientRect(); return [r.width, r.height, getComputedStyle(e).borderRadius]; }));
   check("five-result failed-image and no-cover frames share dimensions and radius", frames.length === 5 && frames.every(x => JSON.stringify(x) === JSON.stringify([64,96,"4px"])), JSON.stringify(frames));
   const typography = await p.evaluate(() => [getComputedStyle(document.querySelector('.game-match-name')).fontSize, getComputedStyle(document.querySelector('.game-match-meta')).fontSize]);
   check("choice title/meta hierarchy is 14px ink and 13px muted", typography.join(',') === '14px,13px');
   await p.click("#game-match-cancel");
   check("cancel choice preserves manual entry and restores normal Save", await p.isHidden("#game-match-picker") && (await store(p)).length === 2);
   await s.ctx.close();
  }
  for (const options of [{ barcodeTitle: "" }, { barcodeTitle: "012345678901" }, { candidates: [] }, { status: 503 }, { status: 401 }, { status: 504 }, { status: 429 }, { failNetwork: true }, { upcStatus: 429 }]) {
   const s = await open(browser, options); const p = s.page; await form(p); await p.fill("#field-title", "Keep manual"); await p.fill("#field-year", "1999"); await barcode(p); await p.waitForFunction(() => !document.querySelector("#btn-lookup").disabled);
   check(`failure ${JSON.stringify(options)} preserves manual inputs and shelf`, await p.inputValue("#field-title") === "Keep manual" && await p.inputValue("#field-year") === "1999" && (await store(p)).length === 2);
   if (options.failNetwork) check("network error is actionable without exposing provider internals", /Try again.*What you typed is kept/.test(await p.textContent("#lookup-status")));
   if (options.barcodeTitle !== undefined) check("no usable barcode title means no IGDB request", !s.requests.some(r => r.kind === "igdb"));
   if (options.status === 429 || options.upcStatus === 429) { const n = s.requests.length; await p.click("#btn-lookup"); await p.waitForFunction(() => !document.querySelector("#btn-lookup").disabled); check("Retry-After prevents duplicate request to limited source", s.requests.filter(r => r.kind === (options.status ? "igdb" : "upc")).length === 1 && /seconds/.test(await p.textContent("#lookup-status"))); }
   await s.ctx.close();
  }
  {
   const s = await open(browser, { delay: 300 }); const p = s.page; await form(p); await barcode(p);
   await p.waitForFunction(() => document.querySelector("#btn-lookup").disabled);
   await p.fill("#field-title", "Newer manual edit"); await p.waitForTimeout(400);
   check("late response cannot overwrite newer edit or reopen picker", await p.inputValue("#field-title") === "Newer manual edit" && await p.isHidden("#game-match-picker"));
   await s.ctx.close();
  }
  {
   const s = await open(browser); const p = s.page; await p.waitForTimeout(150);
   const sizes = await p.$$eval('.item-cover-placeholder.game', els => els.filter(e => !e.hidden).map(e => { const r = e.getBoundingClientRect(); return [r.width, r.height, getComputedStyle(e).borderRadius]; }));
   check("failed legacy image uses identical no-cover frame dimensions/radius", sizes.length === 2 && JSON.stringify(sizes[0]) === JSON.stringify(sizes[1]), JSON.stringify(sizes));
   await p.locator('.item-title', { hasText: "Legacy game" }).click(); await p.waitForSelector("#modal:not([hidden])");
   await p.locator('#modal .form-actions button[type="submit"]').click(); await p.waitForTimeout(150);
   const legacy = (await store(p)).find(g => g.id === "legacy");
   check("legacy edit/save keeps RAWG ID, external ID and cover URL without guessed IGDB ID", legacy.rawgId === "777" && legacy.externalId === "rawg-legacy-external" && legacy.coverUrl === shelf[0].coverUrl && legacy.igdbId === "");
   check("exact footer credit and no visible RAWG key/reference request", /Game data from IGDB.com\./.test(await p.textContent(".footer-credits")) && await p.locator("#api-card-rawg").count() === 0);
   await s.ctx.close();
  }
 } finally { await browser.close(); }
 console.log(`\n${pass}/${pass+fail} passed`); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
