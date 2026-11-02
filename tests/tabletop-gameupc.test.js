// Barcode lookup (GameUPC via the relay) — browser tests + shots. LOCAL ONLY.
// Needs: the page served at TT_ORIGIN, v39 (origin/main) at MAIN_ORIGIN, and the relay shim
// (relay/dev-shim.mjs, KEEP_CACHE=1, POSTs mocked) at RELAY, with DEV_ORIGIN = TT_ORIGIN.
// NODE_PATH=<dir with playwright-core> TT_ORIGIN=http://127.0.0.1:8861 MAIN_ORIGIN=http://127.0.0.1:8862 \
//   RELAY=http://127.0.0.1:8795 SHOTS=./shots node tests/tabletop-gameupc.test.js
const { chromium } = require("playwright-core");
const fs = require("fs");
const ORIGIN = process.env.TT_ORIGIN, MAIN = process.env.MAIN_ORIGIN, RELAY = process.env.RELAY || "http://127.0.0.1:8795";
const SHOTS = process.env.SHOTS || "";
const FLAG_ON = 'const GAMEUPC_LOOKUP = { enabled: true, relay: "https://frm-tabletop.freerangeice.workers.dev" };';
const liveReqs = []; // requests aimed at the live relay (aborted; must stay empty)
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const T0 = "2026-10-01T10:00:00.000Z";
const SHELF = [{ id: "h1", title: "Hand Game", subtype: "board", status: "owned", dateAdded: T0, dateUpdated: T0 }];

async function open(browser, { lookup, width = 390, height = 844, origin = ORIGIN, reduced = false, relayDelay = 0, failPost = false, failGet = 0 }) {
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
      if (failGet && r.request().method() === "GET") return r.fulfill({ status: failGet, headers: { "Access-Control-Allow-Origin": origin, "Retry-After": "30" }, body: "{}" });
      if (relayDelay && r.request().method() === "GET") await new Promise((s) => setTimeout(s, relayDelay));
      return r.continue();
    }
    if (/^https:\/\/frm-tabletop\.freerangeice\.workers\.dev/.test(u)) { liveReqs.push(u); return r.abort(); } // the live Worker: never contacted from tests
    // v43 ships with Lookup on. "lookup: false" serves this branch's tabletop.js with the flag
    // forced off (test only), so the flag-off checks keep comparing against v39.
    if (!lookup && origin === ORIGIN && u.startsWith(ORIGIN + "/tabletop.js")) {
      const res = await r.fetch();
      const body = await res.text();
      if (!body.includes(FLAG_ON)) throw new Error("flag line not found in tabletop.js");
      return r.fulfill({ response: res, body: body.replace(FLAG_ON, 'const GAMEUPC_LOOKUP = { enabled: false, relay: "" };') });
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
    // Option A: this device's own random id, kept in its own key, sent as userId.
    const devId = await page.evaluate(() => localStorage.getItem("frm-gameupc-device-id"));
    check("device id: made on first send, 8 to 64 letters/digits/dashes", /^[A-Za-z0-9-]{8,64}$/.test(devId || ""), String(devId));
    check("device id: sent as userId with the match", JSON.parse(p[0].body).userId === devId, p[0].body);
    // Backups and exports never carry it.
    await page.evaluate(() => {
      const lib = JSON.parse(localStorage.getItem("media-tracker-v1"));
      lib.items = [{ id: "b1", type: "book", title: "Export Probe", status: "owned", dateAdded: "2026-10-01T10:00:00.000Z", dateUpdated: "2026-10-01T10:00:00.000Z" }];
      localStorage.setItem("media-tracker-v1", JSON.stringify(lib));
    });
    await page.reload(); await page.waitForTimeout(400);
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 5000 }), page.evaluate(() => document.querySelector("#btn-export").click())]);
    const exported = fs.readFileSync(await dl.path(), "utf8");
    check("device id: not in the export file", exported.includes("Export Probe") && !exported.includes(devId) && !/frm-gameupc-device-id|userId|user_id/.test(exported));
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
    const t1 = await page.textContent("#toast");
    check("choose: BGG id edited after confirm -> toast says the match wasn't sent", t1 === "Saved. The barcode match wasn’t sent.", t1);
    await ctx.close();
  }
  // (b'') confirmed pick, then the barcode is edited: dropped at Save, same toast, nothing sent.
  {
    const { ctx, page, relayReqs } = await open(browser, { lookup: true });
    await addForm(page);
    await page.fill("#tt-barcode", "222222222224");
    await page.click("#tt-upc-go");
    await page.waitForSelector(".tt-upc-list");
    await page.click('[data-upc-pick="0"]');
    await page.click("[data-upc-confirm]");
    await page.fill("#tt-barcode", "22222222222");
    await page.click("#tt-save");
    await page.waitForTimeout(600);
    const t2 = await page.textContent("#toast");
    check("choose: barcode edited after confirm -> saved, nothing sent, toast says so", posts(relayReqs).length === 0 && (await store(page)).some((e) => e.bggId === "265736") && t2 === "Saved. The barcode match wasn’t sent.", t2);
    await ctx.close();
  }
  // Wording (Berean-approved #8 #12 #14 #15) verbatim on the page.
  {
    const { ctx, page } = await open(browser, { lookup: true });
    await addForm(page);
    await page.fill("#tt-barcode", "222222222224");
    await page.click("#tt-upc-go");
    await page.waitForSelector(".tt-upc-list");
    await page.click('[data-upc-pick="0"]');
    const w8 = await page.textContent("#tt-upc-what");
    check("#8 confirm text", w8 === "Confirm fills in this game. When you save, its BGG id and barcode 222222222224 are sent to GameUPC, with a random id for this device, so this barcode can be matched next time.", w8);
    const name = await page.textContent(".tt-upc-cand-static .tt-upc-cand-name");
    await page.click("[data-upc-confirm]");
    const w12 = await page.textContent(".tt-upc-msg");
    check("#12 picked text", w12 === `${name} filled in. Its BGG id is sent to GameUPC with this barcode when you save.`, w12);
    await page.fill("#tt-barcode", "333333333331");
    await page.click("#tt-upc-go");
    await page.waitForSelector("#tt-upc-h");
    const w14 = await page.textContent("#tt-upc-panel .field-hint");
    check("#14 no-data hint", w14 === "Enter the game yourself. If you add its BGG id, you’ll be asked before it’s sent to GameUPC with this barcode. Without a BGG id, nothing is sent.", w14);
    await page.fill("#tt-title", "Ask");
    await page.fill("#tt-bggId", "174430");
    await page.click("#tt-save");
    await page.waitForSelector('[data-upc-send="send"]');
    const w15 = await page.textContent("#tt-upc-h");
    check("#15 send-ask heading", w15 === "Send this barcode match to GameUPC?", w15);
    await ctx.close();
  }
  // #21: own 429 vs 503 / upstream busy on lookup
  for (const [st, want] of [[429, "Too many lookups. Try again in a minute."], [503, "Barcode lookup is busy. Try again in a minute."]]) {
    const { ctx, page } = await open(browser, { lookup: true, failGet: st });
    await addForm(page);
    await page.fill("#tt-barcode", "444444444442");
    await page.click("#tt-upc-go");
    await page.waitForSelector(".tt-upc-err");
    const m = await page.textContent(".tt-upc-msg");
    check(`#21 lookup ${st}: "${want}"`, m === want, m);
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
  // reduced motion: the Confirm card scrolls into place at once (behavior auto), above the rule
  {
    const { ctx, page } = await open(browser, { lookup: true, reduced: true, width: 320, height: 700 });
    await addForm(page);
    await page.fill("#tt-barcode", "222222222224");
    await page.click("#tt-upc-go");
    await page.waitForSelector(".tt-upc-list");
    await page.click('[data-upc-pick="0"]');
    const q = await page.evaluate(() => { const rule = document.querySelector("#tt-form > .form-actions-right").getBoundingClientRect().top; const b = Math.max(...[...document.querySelectorAll(".tt-upc-confirm .tt-upc-actions .btn")].map((x) => x.getBoundingClientRect().bottom)); return { b: Math.round(b), rule: Math.round(rule) }; });
    check("reduced motion 320x700: Confirm buttons above the rule immediately (no smooth scroll)", q.b <= q.rule, JSON.stringify(q));
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
  /** Pinned bar facts: sticky, on screen at the panel bottom, 1px rule, 24px fade; Save filled or outline. */
  const barFacts = (page) => page.evaluate(() => {
    const bar = document.querySelector("#tt-form > .form-actions-right");
    const panel = document.querySelector("#tt-form-modal > .modal-panel");
    const r = bar.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    const cs = getComputedStyle(bar), fade = getComputedStyle(bar, "::before");
    const save = getComputedStyle(document.querySelector("#tt-save"));
    const filled = save.backgroundColor !== "rgba(0, 0, 0, 0)" && save.backgroundColor !== "transparent";
    const btns = [...document.querySelectorAll("#tt-form > .form-actions-right > button.btn-primary, #tt-upc-panel .btn-primary")].filter((b) => b.offsetParent && getComputedStyle(b).backgroundColor !== "rgba(0, 0, 0, 0)");
    return { sticky: cs.position === "sticky", onScreen: r.bottom <= Math.min(innerHeight, pr.bottom) + 1 && r.top >= pr.top, rule: cs.borderTopWidth === "1px", fadeH: fade.content !== "none" ? fade.height : "none", saveFilled: filled, filledCount: btns.length };
  });
  /** Question buttons (Confirm card / send-ask) end at or above the pinned bar's rule. */
  const aboveRule = (page) => page.evaluate(() => {
    const rule = document.querySelector("#tt-form > .form-actions-right").getBoundingClientRect().top;
    const bottom = Math.max(...[...document.querySelectorAll(".tt-upc-confirm .tt-upc-actions .btn")].map((b) => b.getBoundingClientRect().bottom));
    return { bottom: Math.round(bottom), rule: Math.round(rule), ok: bottom <= rule + 0.5 };
  });
  const QSIZES = new Set(["320x700", "390x844", "1000x420"]);
  const barOk = (f) => f.sticky && f.onScreen && f.rule && f.fadeH === "24px";
  for (const [w, h] of [[320, 700], [390, 844], [466, 1000], [1000, 720], [1000, 420]]) {
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
    const ml = await page.evaluate(() => { const m = document.querySelector(".tt-upc-msg"), cs = getComputedStyle(m); return { px: cs.fontSize, color: cs.color, gap: Math.round(m.getBoundingClientRect().top - document.querySelector("#tt-upc-go").getBoundingClientRect().bottom) }; });
    check(`${tag} match line 14px body ink; 12px under Look up barcode`, ml.px === "14px" && ml.color === "rgb(44, 36, 28)" && ml.gap === 12, JSON.stringify(ml));
    const fm = await barFacts(page);
    check(`${tag} match: pinned bar with rule + fade, Save filled`, barOk(fm) && fm.saveFilled, JSON.stringify(fm));
    let c = await clearOfBar(page);
    check(`${tag} match: buttons clear the bar, >=44px`, !c.bad.length && !c.small.length, JSON.stringify(c));
    await page.fill("#tt-barcode", "222222222224");
    await page.click("#tt-upc-go");
    await page.waitForSelector(".tt-upc-list");
    await shot(page, `on-suggestions-${tag}`);
    let f = await barFacts(page);
    check(`${tag} suggestions: pinned bar on screen, 1px rule, 24px fade, Save filled`, barOk(f) && f.saveFilled, JSON.stringify(f));
    const none = await page.$eval("[data-upc-none]", (b) => { const cs = getComputedStyle(b); const last = document.querySelector(".tt-upc-list").getBoundingClientRect(); return { border: cs.borderTopWidth, bg: cs.backgroundColor, under: b.getBoundingClientRect().top >= last.bottom, deco: cs.textDecorationLine, h: b.getBoundingClientRect().height }; });
    check(`${tag} "None of these": text button under the list (no border/fill, underlined, >=44px)`, none.border === "0px" && none.bg === "rgba(0, 0, 0, 0)" && none.under && none.deco === "underline" && none.h >= 44, JSON.stringify(none));
    await page.$eval("[data-upc-none]", (e) => e.scrollIntoView({ block: "nearest" }));
    const tap = await page.$eval("[data-upc-none]", (b) => { const r = b.getBoundingClientRect(), x = r.left + r.width / 2; const hit = (y) => b.contains(document.elementFromPoint(x, y)); return { h: r.height, top: hit(r.top + 1), bottom: hit(r.bottom - 1) }; });
    check(`${tag} "None of these": tap target >= 44px tall, whole height hits the button`, tap.h >= 44 && tap.top && tap.bottom, JSON.stringify(tap));
    await shot(page, `on-suggestions-none-of-these-${tag}`);
    const gap24 = await page.evaluate(() => Math.round(document.querySelector('label[for="tt-coverUrl"]').getBoundingClientRect().top - document.querySelector("#tt-upc-panel").getBoundingClientRect().bottom));
    check(`${tag} suggestions: 24px from the panel to the next label`, gap24 === 24, String(gap24));
    c = await clearOfBar(page);
    check(`${tag} suggestions: rows clear the bar when focused/scrolled, >=44px`, !c.bad.length && !c.small.length, JSON.stringify({ ...c, bad: c.bad.slice(0, 3) }));
    await page.$eval("#tt-upc-h", (e) => e.scrollIntoView({ block: "start" }));
    await page.click('[data-upc-pick="0"]');
    await page.waitForTimeout(700); // smooth scroll settles
    if (QSIZES.has(tag)) { const q = await aboveRule(page); check(`${tag} Confirm card opens with its buttons above the bar rule`, q.ok, JSON.stringify(q)); }
    await shot(page, `on-confirm-${tag}`);
    f = await barFacts(page);
    check(`${tag} confirm: bar pinned; Save is an outline, one filled button on screen`, barOk(f) && !f.saveFilled && f.filledCount === 1, JSON.stringify(f));
    c = await clearOfBar(page);
    check(`${tag} confirm: Confirm/Cancel clear the bar, >=44px`, !c.bad.length && !c.small.length, JSON.stringify(c));
    await page.click("[data-upc-confirm]");
    await page.waitForTimeout(300); // .btn background transition (0.15s)
    await shot(page, `on-picked-${tag}`);
    f = await barFacts(page);
    check(`${tag} after Confirm: Save filled again`, barOk(f) && f.saveFilled, JSON.stringify(f));
    await page.fill("#tt-barcode", "333333333331");
    await page.click("#tt-upc-go");
    await page.waitForSelector("text=No match for this barcode");
    await shot(page, `on-nodata-${tag}`);
    f = await barFacts(page);
    check(`${tag} no data: pinned bar on screen with rule + fade, Save filled`, barOk(f) && f.saveFilled, JSON.stringify(f));
    await page.fill("#tt-title", "Shot game");
    await page.fill("#tt-bggId", "174430");
    await page.click("#tt-save");
    await page.waitForSelector('[data-upc-send="send"]');
    await page.waitForTimeout(700);
    if (QSIZES.has(tag)) { const q = await aboveRule(page); check(`${tag} send-ask opens with its buttons above the bar rule`, q.ok, JSON.stringify(q)); }
    await shot(page, `on-send-ask-${tag}`);
    f = await barFacts(page);
    check(`${tag} send ask: bar pinned; Save is an outline, one filled button on screen`, barOk(f) && !f.saveFilled && f.filledCount === 1, JSON.stringify(f));
    const ask = await page.evaluate(() => {
      const row = document.querySelector("#tt-upc-what");
      const sub = row.querySelector(".tt-upc-cand-year"), nw = row.querySelector(".tt-upc-nowrap");
      const hs = parseFloat(getComputedStyle(document.querySelector("#tt-upc-h")).fontSize);
      const texts = [...document.querySelectorAll(".tt-upc-confirm p, .tt-upc-confirm .tt-upc-cand-name")].map((e) => parseFloat(getComputedStyle(e).fontSize));
      const tops = [...document.querySelectorAll(".tt-upc-actions .btn")].map((b) => Math.round(b.getBoundingClientRect().top));
      return { bordered: getComputedStyle(row).borderTopWidth === "1px" && row.classList.contains("tt-upc-cand"), title: row.querySelector(".tt-upc-cand-name").textContent, sub: sub.textContent, subPx: getComputedStyle(sub).fontSize, muted: getComputedStyle(sub).color, nowrap: getComputedStyle(nw).whiteSpace, notBigger: texts.every((x) => x <= hs), oneRow: new Set(tops).size === 1, n: tops.length };
    });
    check(`${tag} send ask: bordered row, title then "BGG id · Barcode upc" 13px muted, barcode nowrap, text not bigger than heading`, ask.bordered && ask.title === "Shot game" && ask.sub === "BGG 174430 · Barcode 333333333331" && ask.subPx === "13px" && ask.muted === "rgb(92, 83, 72)" && ask.nowrap === "nowrap" && ask.notBigger, JSON.stringify(ask));
    const dev = await page.evaluate(() => { const r = document.querySelector("#tt-upc-what"), d = r.querySelector(".tt-upc-device"); return { text: d && d.textContent, px: d && getComputedStyle(d).fontSize, color: d && getComputedStyle(d).color, aria: r.getAttribute("aria-label"), belowSub: d && d.getBoundingClientRect().top >= r.querySelector(".tt-upc-cand-year").getBoundingClientRect().bottom - 1 }; });
    check(`${tag} send ask: muted device line under BGG/Barcode, and in the row's aria-label`, dev.text === "Sent with a random id for this device." && dev.px === "13px" && dev.color === "rgb(92, 83, 72)" && dev.belowSub && dev.aria === "Shot game, BGG id 174430, barcode 333333333331. Sent with a random id for this device.", JSON.stringify(dev));
    check(`${tag} send ask: the three buttons on one row`, ask.oneRow && ask.n === 3, JSON.stringify(ask));
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

  check("never contacted the live Worker (all lookups via the local test relay)", liveReqs.length === 0, liveReqs.join(" "));

  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
