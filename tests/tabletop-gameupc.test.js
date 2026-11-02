// Barcode lookup (GameUPC via the relay) — browser tests + shots. LOCAL ONLY.
// Needs: the page served at TT_ORIGIN, v39 (origin/main) at MAIN_ORIGIN, and the relay shim
// (relay/dev-shim.mjs, KEEP_CACHE=1, POSTs mocked) at RELAY, with DEV_ORIGIN = TT_ORIGIN.
// NODE_PATH=<dir with playwright-core> TT_ORIGIN=http://127.0.0.1:8861 MAIN_ORIGIN=http://127.0.0.1:8862 \
//   RELAY=http://127.0.0.1:8795 SHOTS=./shots node tests/tabletop-gameupc.test.js
const { chromium } = require("playwright-core");
const fs = require("fs");
const ORIGIN = process.env.TT_ORIGIN, MAIN = process.env.MAIN_ORIGIN, RELAY = process.env.RELAY || "http://127.0.0.1:8795";
const SHOTS = process.env.SHOTS || "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const T0 = "2026-10-01T10:00:00.000Z";
const SHELF = [{ id: "h1", title: "Hand Game", subtype: "board", status: "owned", dateAdded: T0, dateUpdated: T0 }];

async function open(browser, { lookup, width = 390, height = 844, origin = ORIGIN, reduced = false, relayDelay = 0, failPost = false }) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", reducedMotion: reduced ? "reduce" : "no-preference" });
  await ctx.addInitScript(({ lookup, relay, shelf }) => {
    if (lookup) window.__FRM_TT_LOOKUP__ = { relay };
    if (sessionStorage.getItem("__init")) return;
    sessionStorage.setItem("__init", "1");
    localStorage.clear();
    localStorage.setItem("media-shelf-seeded", "2026-01-01T00:00:00.000Z");
    localStorage.setItem("media-tracker-v1", JSON.stringify({ version: 1, savedAt: "2026-10-01T10:00:00.000Z", items: [] }));
    localStorage.setItem("media-tracker-v1:tabletop", JSON.stringify(shelf));
  }, { lookup, relay: RELAY, shelf: SHELF });
  const relayReqs = [];
  await ctx.route("**/*", async (r) => {
    const u = r.request().url();
    if (u.startsWith(RELAY)) {
      relayReqs.push({ method: r.request().method(), url: u.slice(RELAY.length), body: r.request().postData() });
      if (r.request().method() === "POST" && failPost) return r.fulfill({ status: failPost === true ? 502 : failPost, headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Expose-Headers": "Retry-After", "Retry-After": "3600" }, body: JSON.stringify({ error: failPost === 429 ? "slow down" : failPost === 503 ? "not configured" : "upstream" }) });
      if (relayDelay && r.request().method() === "GET") await new Promise((s) => setTimeout(s, relayDelay));
      return r.continue();
    }
    return u.startsWith(origin) || u.startsWith("data:") ? r.continue() : r.abort(); // thumbnails (BGG CDN) are not loaded in tests
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(origin + "/index.html");
  await page.waitForSelector("#stats .stat-pill");
  await page.click('.type-tabs .chip[data-type="tabletop"]');
  return { ctx, page, relayReqs, errors };
}
const posts = (r) => r.filter((x) => x.method === "POST");
const gets = (r) => r.filter((x) => x.method === "GET");
async function addForm(page) { await page.click("#btn-add"); await page.waitForSelector("#tt-form-modal:not([hidden])"); }
const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("media-tracker-v1:tabletop") || "[]"));
async function typeCode(page, code) { await page.click("#tt-barcode"); await page.keyboard.type(code, { delay: 40 }); }
/** Every visible button / focused element in the panel clears the pinned Cancel/Save bar once scrolled to. */
async function clearOfBar(page) {
  return page.evaluate(() => {
    const bar = document.querySelector("#tt-form > .form-actions-right").getBoundingClientRect();
    const els = [...document.querySelectorAll("#tt-upc button, #tt-upc .tt-upc-h")].filter((e) => e.offsetParent);
    const bad = [];
    const small = [];
    for (const e of els) {
      e.scrollIntoView({ block: "nearest" });
      const r = e.getBoundingClientRect();
      const b2 = document.querySelector("#tt-form > .form-actions-right").getBoundingClientRect();
      if (r.bottom > b2.top - 1) bad.push(e.textContent.trim().slice(0, 30));
      if (e.tagName === "BUTTON" && r.height < 44) small.push(`${e.textContent.trim().slice(0, 20)}:${r.height}`);
    }
    return { bad, small, n: els.length, barH: Math.round(bar.height), barPos: getComputedStyle(document.querySelector("#tt-form > .form-actions-right")).position };
  });
}
async function shot(page, name) { if (SHOTS) { await page.waitForTimeout(150); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--no-sandbox"], headless: true });

  /* ---------- flag OFF: same as v39, zero relay requests ---------- */
  {
    const { ctx, page, relayReqs, errors } = await open(browser, { lookup: false });
    await addForm(page);
    await typeCode(page, "111111111117");
    await page.waitForTimeout(1500);
    await page.$eval("#tt-lookup", (b) => b.click());
    await page.fill("#tt-title", "Off Test");
    await page.click("#tt-save");
    await page.waitForTimeout(300);
    check("flag off: zero relay requests (typed a valid code, pressed Lookup, saved)", relayReqs.length === 0, `${relayReqs.length} requests`);
    check("flag off: no barcode lookup UI in the DOM", (await page.$("#tt-upc")) === null);
    check("flag off: no page errors", errors.length === 0, errors.join(" | "));
    const formNow = await page.evaluate(() => { document.querySelector("#tt-btn-reset"); return document.querySelector("#tt-form-modal").outerHTML.length; });
    await ctx.close();
    // DOM of the add sheet, freshly opened, against live v39 (origin/main).
    const grab = async (origin) => {
      const o = await open(browser, { lookup: false, origin });
      await addForm(o.page);
      const h = await o.page.evaluate(() => document.querySelector("#tt-form-modal").outerHTML.replace(/\s+/g, " "));
      const lk = await o.page.evaluate(() => { document.querySelector("#tt-lookup").click(); return document.querySelector("#tt-lookup-status").textContent; });
      await o.ctx.close();
      return { h, lk, n: o.relayReqs.length };
    };
    const a = await grab(ORIGIN), b = await grab(MAIN);
    check("flag off: Add sheet markup identical to v39", a.h === b.h, `${a.h.length} vs ${b.h.length}`);
    check("flag off: Lookup button says the same as v39", a.lk === b.lk, a.lk);
    void formNow;
  }

  /* ---------- flag ON ---------- */
  // (a) match: fills, never posts. Typed key by key: debounce means one GET.
  {
    const { ctx, page, relayReqs, errors } = await open(browser, { lookup: true });
    await addForm(page);
    await typeCode(page, "111111111117");
    await page.waitForSelector(".tt-upc-msg:not(.tt-upc-loading)", { timeout: 15000 });
    const msg = await page.textContent(".tt-upc-msg");
    check("match: one GET for 12 keystrokes (debounced)", gets(relayReqs).length === 1, JSON.stringify(gets(relayReqs).map((g) => g.url)));
    check("match: title / BGG id / year filled", (await page.inputValue("#tt-title")) === "Splendor" && (await page.inputValue("#tt-bggId")) === "148228" && (await page.inputValue("#tt-year")) === "2014");
    check("match: status line", msg === "Found Splendor. Check the details, then save.", msg);
    await page.click("#tt-upc-go"); // same code again: answered, no new request
    await page.click("#tt-save");
    await page.waitForTimeout(800);
    check("match: same code again = no new request", gets(relayReqs).length === 1);
    check("match: saved locally", (await store(page)).some((e) => e.title === "Splendor" && e.barcode === "111111111117"));
    check("match: NEVER posts (no POST after save)", posts(relayReqs).length === 0, JSON.stringify(posts(relayReqs)));
    check("match: no page errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  // (b) suggestions: POST only after Confirm and Save.
  {
    const { ctx, page, relayReqs } = await open(browser, { lookup: true });
    await addForm(page);
    await page.fill("#tt-barcode", "222222222224");
    await page.click("#tt-upc-go");
    await page.waitForSelector(".tt-upc-list");
    const rows = await page.$$eval(".tt-upc-cand", (b) => b.map((x) => x.getAttribute("aria-label")));
    check("choose: suggestion rows with name + year", rows.length >= 2 && rows[0] === "Tiny Towns, 2019", rows.slice(0, 3).join(" | "));
    check("choose: focus on the list heading", (await page.evaluate(() => document.activeElement.id)) === "tt-upc-h");
    check("choose: no POST on showing suggestions", posts(relayReqs).length === 0);
    await page.click('[data-upc-pick="0"]');
    check("choose: confirm step shown, no POST yet", (await page.textContent("#tt-upc-h")) === "Is this your game?" && posts(relayReqs).length === 0);
    await page.click("[data-upc-cancel]");
    check("choose: Cancel returns to the list, focus on the row, no POST", (await page.evaluate(() => document.activeElement.dataset.upcPick)) === "0" && posts(relayReqs).length === 0);
    await page.click('[data-upc-pick="0"]');
    await page.click("[data-upc-confirm]");
    check("choose: after Confirm the form is filled, still no POST (sent on save)", (await page.inputValue("#tt-bggId")) === "265736" && posts(relayReqs).length === 0);
    await page.click("#tt-save");
    await page.waitForTimeout(800);
    const p = posts(relayReqs);
    check("choose: exactly one POST after Confirm + Save", p.length === 1 && p[0].url === "/barcode/confirm" && JSON.parse(p[0].body).bggId === "265736" && JSON.parse(p[0].body).upc === "222222222224", JSON.stringify(p));
    check("choose: saved locally", (await store(page)).some((e) => e.bggId === "265736"));
    await ctx.close();
  }
  // (b') confirmed pick, then the BGG id is changed by hand: nothing sent.
  {
    const { ctx, page, relayReqs } = await open(browser, { lookup: true });
    await addForm(page);
    await page.fill("#tt-barcode", "222222222224");
    await page.click("#tt-upc-go");
    await page.waitForSelector(".tt-upc-list");
    await page.click('[data-upc-pick="1"]');
    await page.click("[data-upc-confirm]");
    await page.fill("#tt-bggId", "999");
    await page.click("#tt-save");
    await page.waitForTimeout(500);
    const asked = await page.$("#tt-upc-h");
    check("choose: BGG id edited after confirm -> not the confirmed game; nothing sent without a new confirm", posts(relayReqs).length === 0, asked ? await asked.textContent() : "no ask");
    await ctx.close();
  }
  // (c) no data
  {
    const { ctx, page, relayReqs } = await open(browser, { lookup: true });
    await addForm(page);
    await page.fill("#tt-barcode", "333333333331");
    await page.click("#tt-upc-go");
    await page.waitForSelector("#tt-upc-h");
    check("none: no-data prompt", (await page.textContent("#tt-upc-h")) === "No match for this barcode");
    await page.fill("#tt-title", "Hand Game"); // same title as a hand-entered game already here
    await page.click("#tt-save");
    await page.waitForTimeout(400);
    check("none: no BGG id -> no confirm, no POST", posts(relayReqs).length === 0 && !(await page.isHidden("#tt-dup")));
    check("none: hand-entered same title is a title duplicate prompt, not a confirmed dup", /You already have “Hand Game”/.test(await page.textContent("#tt-dup-text")));
    await page.click("#tt-dup-add");
    await page.waitForTimeout(400);
    check("none: kept both copies, nothing posted", (await store(page)).filter((e) => e.title === "Hand Game").length === 2 && posts(relayReqs).length === 0);
    await ctx.close();
  }
  for (const choice of ["skip", "send"]) {
    const { ctx, page, relayReqs } = await open(browser, { lookup: true });
    await addForm(page);
    await page.fill("#tt-barcode", "333333333331");
    await page.click("#tt-upc-go");
    await page.waitForSelector("#tt-upc-h");
    await page.fill("#tt-title", `Entered ${choice}`);
    await page.fill("#tt-bggId", "174430");
    await page.click("#tt-save");
    await page.waitForSelector('[data-upc-send="send"]');
    check(`none+id (${choice}): Save asks first, nothing saved or sent yet`, posts(relayReqs).length === 0 && !(await store(page)).some((e) => e.title === `Entered ${choice}`));
    await page.click(`[data-upc-send="${choice}"]`);
    await page.waitForTimeout(800);
    const p = posts(relayReqs);
    check(`none+id (${choice}): saved locally`, (await store(page)).some((e) => e.title === `Entered ${choice}`));
    check(`none+id (${choice}): ${choice === "send" ? "one POST with that BGG id" : "no POST"}`, choice === "send" ? p.length === 1 && JSON.parse(p[0].body).bggId === "174430" : p.length === 0, JSON.stringify(p));
    await ctx.close();
  }
  // POST failure is non-blocking
  {
    const { ctx, page, relayReqs } = await open(browser, { lookup: true, failPost: true });
    await addForm(page);
    await page.fill("#tt-barcode", "222222222224");
    await page.click("#tt-upc-go");
    await page.waitForSelector(".tt-upc-list");
    await page.click('[data-upc-pick="0"]');
    await page.click("[data-upc-confirm]");
    await page.click("#tt-save");
    await page.waitForTimeout(800);
    const toast = await page.textContent("#toast");
    check("post failure: game still saved, sheet closed, toast says so", (await store(page)).some((e) => e.bggId === "265736") && (await page.isHidden("#tt-form-modal")) && toast === "Saved. The barcode match wasn’t sent.", toast);
    check("post failure: exactly one attempt", posts(relayReqs).length === 1);
    await ctx.close();
  }
  // Relay hardening: a confirm refused by the global daily cap (429), by a missing KV (503) or by
  // the lookup-before-confirm rule (409) is a send failure: saved anyway, same toast, one attempt.
  for (const st of [429, 503, 409]) {
    const { ctx, page, relayReqs } = await open(browser, { lookup: true, failPost: st });
    await addForm(page);
    await page.fill("#tt-barcode", "222222222224");
    await page.click("#tt-upc-go");
    await page.waitForSelector(".tt-upc-list");
    await page.click('[data-upc-pick="0"]');
    await page.click("[data-upc-confirm]");
    await page.click("#tt-save");
    await page.waitForTimeout(800);
    const toast = await page.textContent("#toast");
    check(`confirm refused ${st}: saved, sheet closed, toast "Saved. The barcode match wasn’t sent."`, (await store(page)).some((e) => e.bggId === "265736") && (await page.isHidden("#tt-form-modal")) && toast === "Saved. The barcode match wasn’t sent.", toast);
    check(`confirm refused ${st}: exactly one attempt, no retry`, posts(relayReqs).length === 1);
    await ctx.close();
  }
  // reduced motion
  {
    const { ctx, page } = await open(browser, { lookup: true, reduced: true, relayDelay: 1500 });
    await addForm(page);
    await page.fill("#tt-barcode", "111111111117");
    await page.click("#tt-upc-go");
    await page.waitForSelector(".tt-upc-spin");
    const an = await page.$eval(".tt-upc-spin", (e) => getComputedStyle(e).animationName);
    check("reduced motion: spinner does not animate", an === "none", an);
    await ctx.close();
  }

  /* ---------- shots + bar clearance at four sizes ---------- */
  for (const [w, h] of [[390, 844], [466, 1000], [1000, 720], [1000, 420]]) {
    const tag = `${w}x${h}`;
    const { ctx, page } = await open(browser, { lookup: true, width: w, height: h, relayDelay: 1200 });
    await addForm(page);
    await page.fill("#tt-barcode", "111111111117");
    await page.click("#tt-upc-go");
    await page.waitForSelector(".tt-upc-loading");
    await page.$eval("#tt-upc", (e) => e.scrollIntoView({ block: "nearest" }));
    await shot(page, `on-loading-${tag}`);
    await page.waitForSelector(".tt-upc-msg:not(.tt-upc-loading)");
    await shot(page, `on-match-${tag}`);
    let c = await clearOfBar(page);
    check(`${tag} match: buttons clear the bar, >=44px`, !c.bad.length && !c.small.length, JSON.stringify(c));
    await page.fill("#tt-barcode", "222222222224");
    await page.click("#tt-upc-go");
    await page.waitForSelector(".tt-upc-list");
    await shot(page, `on-suggestions-${tag}`);
    c = await clearOfBar(page);
    check(`${tag} suggestions: rows clear the bar when focused/scrolled, >=44px`, !c.bad.length && !c.small.length, JSON.stringify({ ...c, bad: c.bad.slice(0, 3) }));
    await page.$eval("#tt-upc-h", (e) => e.scrollIntoView({ block: "start" }));
    await page.click('[data-upc-pick="0"]');
    await shot(page, `on-confirm-${tag}`);
    c = await clearOfBar(page);
    check(`${tag} confirm: Confirm/Cancel clear the bar, >=44px`, !c.bad.length && !c.small.length, JSON.stringify(c));
    await page.fill("#tt-barcode", "333333333331");
    await page.click("#tt-upc-go");
    await page.waitForSelector("text=No match for this barcode");
    await shot(page, `on-nodata-${tag}`);
    await page.fill("#tt-title", "Shot game");
    await page.fill("#tt-bggId", "174430");
    await page.click("#tt-save");
    await page.waitForSelector('[data-upc-send="send"]');
    await shot(page, `on-send-ask-${tag}`);
    c = await clearOfBar(page);
    check(`${tag} send ask: buttons clear the bar, >=44px`, !c.bad.length && !c.small.length, JSON.stringify(c));
    const ov = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    check(`${tag} no horizontal overflow`, ov);
    await ctx.close();
  }
  // flag-off shot for comparison
  for (const [w, h] of [[390, 844]]) {
    const { ctx, page } = await open(browser, { lookup: false, width: w, height: h });
    await addForm(page);
    await page.$eval("#tt-barcode", (e) => e.scrollIntoView({ block: "center" }));
    await shot(page, `off-sheet-${w}x${h}`);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
