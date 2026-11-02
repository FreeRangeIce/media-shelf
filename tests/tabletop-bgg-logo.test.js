// BoardGameGeek credit ("Powered by BGG" logo + footer line) — browser tests + shots. LOCAL ONLY.
// Lookup is forced on in this test only: tabletop.js is served with GAMEUPC_LOOKUP rewritten to
// enabled:true, and every relay call is answered here with mock JSON (no GameUPC, no POSTs).
// NODE_PATH=<dir with playwright-core> TT_ORIGIN=http://127.0.0.1:8861 [SHOTS=./shots] node tests/tabletop-bgg-logo.test.js
const { chromium } = require("playwright-core");
const fs = require("fs");
const ORIGIN = process.env.TT_ORIGIN || "http://127.0.0.1:8861";
const RELAY = "http://127.0.0.1:8795";
const SHOTS = process.env.SHOTS || "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const T0 = "2026-10-01T10:00:00.000Z";
const SHELF = [1, 2, 3, 4].map((i) => ({ id: "h" + i, title: ["Azul", "Splendor", "Tiny Towns", "Wingspan"][i - 1], subtype: "board", status: "owned", dateAdded: T0, dateUpdated: T0 }));
const MOCK = {
  "111111111117": { upc: "111111111117", status: "verified", name: "Splendor", searchedFor: "", candidates: [{ bggId: 148228, name: "Splendor", year: "2014", thumbnail: "" }] },
  "222222222224": { upc: "222222222224", status: "choose", name: "Tiny Towns", searchedFor: "Tiny Towns", candidates: [{ bggId: 265736, name: "Tiny Towns", year: "2019", thumbnail: "" }, { bggId: 310792, name: "Greatest Little Cities", year: "2019", thumbnail: "" }] },
  "333333333331": { upc: "333333333331", status: "none", name: "", searchedFor: "", candidates: [] },
};
const FLAG_OFF = 'const GAMEUPC_LOOKUP = { enabled: false, relay: "" };';

async function open(browser, { on, width = 390, height = 844 }) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", isMobile: width <= 600, hasTouch: width <= 600 });
  await ctx.addInitScript((shelf) => {
    if (sessionStorage.getItem("__init")) return;
    sessionStorage.setItem("__init", "1");
    localStorage.clear();
    localStorage.setItem("media-shelf-seeded", "2026-01-01T00:00:00.000Z");
    localStorage.setItem("media-tracker-v1", JSON.stringify({ version: 1, savedAt: "2026-10-01T10:00:00.000Z", items: [] }));
    localStorage.setItem("media-tracker-v1:tabletop", JSON.stringify(shelf));
  }, SHELF);
  const relay = [];
  let flagSeen = false;
  await ctx.route("**/*", async (r) => {
    const u = r.request().url();
    if (u.startsWith(RELAY)) {
      relay.push(r.request().method() + " " + u.slice(RELAY.length));
      if (r.request().method() !== "GET") return r.fulfill({ status: 500, body: "{}" });
      const m = /upc=(\d+)/.exec(u);
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": ORIGIN }, body: JSON.stringify(MOCK[m && m[1]] || MOCK["333333333331"]) });
    }
    if (on && u.startsWith(ORIGIN + "/tabletop.js")) {
      const res = await r.fetch();
      const body = await res.text();
      flagSeen = body.includes(FLAG_OFF);
      return r.fulfill({ response: res, body: body.replace(FLAG_OFF, `const GAMEUPC_LOOKUP = { enabled: true, relay: "${RELAY}" };`) });
    }
    return u.startsWith(ORIGIN) || u.startsWith("data:") ? r.continue() : r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(ORIGIN + "/index.html");
  await page.waitForSelector("#stats .stat-pill");
  await page.click('.type-tabs .chip[data-type="tabletop"]');
  await page.waitForSelector("#tabletop-list .tt-card");
  return { ctx, page, relay, errors, flagSeen: () => flagSeen };
}
async function lookup(page, code) {
  await page.click("#btn-add");
  await page.waitForSelector("#tt-form-modal:not([hidden])");
  await page.fill("#tt-barcode", code);
  await page.click("#tt-upc-go");
  await page.waitForSelector("#tt-upc-panel:not([hidden]) :is(.tt-upc-found, .tt-upc-h)");
  await page.waitForTimeout(150);
}
const logoInfo = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((a) => {
  const i = a.querySelector("img"); const r = i.getBoundingClientRect(); const ar = a.getBoundingClientRect();
  return { href: a.getAttribute("href"), target: a.target, rel: a.rel, alt: i.alt, src: i.getAttribute("src"), w: i.getAttribute("width"), h: i.getAttribute("height"), rh: Math.round(r.height * 10) / 10, rw: Math.round(r.width * 10) / 10, tap: Math.round(ar.height), loaded: i.complete && i.naturalWidth > 0, right: ar.right };
}), sel);
const bggText = (page) => page.evaluate(() => { const h = document.documentElement.outerHTML; return /powered-by-bgg|Powered by BGG|Game data from BoardGameGeek|tt-bgg-/.test(h); });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  // ---- flag off (as shipped): nothing BGG-credit related in the page
  {
    const { page, ctx, errors } = await open(browser, { on: false });
    check("off: no logo, no footer line on the Tabletop list", !(await bggText(page)));
    await page.click("#btn-add");
    await page.waitForSelector("#tt-form-modal:not([hidden])");
    check("off: no logo in the Add sheet, no lookup panel", !(await bggText(page)) && (await page.$("#tt-upc-panel")) === null);
    check("off: no page errors", errors.length === 0, errors.join("; "));
    await ctx.close();
  }
  // ---- flag forced on
  for (const width of [320, 390, 1440]) {
    const H = width <= 600 ? 36 : 40;
    const { page, ctx, errors, relay, flagSeen } = await open(browser, { on: true, width, height: width === 1440 ? 900 : 844 });
    check(`${width}: test forced the shipped flag (tabletop.js still says enabled:false)`, flagSeen());
    // footer
    const foot = await page.evaluate(() => { const p = document.getElementById("tt-bgg-credit"); return p && { text: p.querySelector(".tt-bgg-credit-text").textContent, fs: getComputedStyle(p).fontSize, color: getComputedStyle(p).color, chip: getComputedStyle(p.querySelector(".tt-bgg-logo")).backgroundColor, pad: getComputedStyle(p.querySelector(".tt-bgg-logo")).paddingTop, last: p === document.getElementById("tabletop-view").lastElementChild }; });
    check(`${width}: footer line text exact, 13px, muted`, foot && foot.text === "Game data from BoardGameGeek" && foot.fs === "13px" && foot.color === "rgb(196, 184, 162)", JSON.stringify(foot));
    check(`${width}: footer logo on a white chip, 8px padding (list sits on the oak)`, foot && foot.chip === "rgb(255, 255, 255)" && foot.pad === "8px", JSON.stringify(foot));
    const fl = (await logoInfo(page, "#tt-bgg-credit .tt-bgg-logo"))[0];
    check(`${width}: footer logo linked, alt, ${H}px, >=44 tap, loaded`, fl && fl.href === "https://boardgamegeek.com" && fl.target === "_blank" && fl.rel === "noopener" && fl.alt === "Powered by BGG" && fl.rh === H && fl.tap >= 44 && fl.loaded, JSON.stringify(fl));
    const ov = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    check(`${width}: no horizontal overflow`, ov);
    if (SHOTS) {
      await page.evaluate(() => document.getElementById("tt-bgg-credit").scrollIntoView({ block: "center" }));
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${SHOTS}/bgg-logo-${width}-footer.png` });
    }
    // match (verified)
    await lookup(page, "111111111117");
    const before = await page.evaluate(() => document.getElementById("tt-upc-panel").getBoundingClientRect().height);
    const m = await logoInfo(page, "#tt-upc-panel .tt-bgg-logo");
    check(`${width}: match result shows the linked logo (href, alt, ${H}px, 342:76 attrs)`, m.length === 1 && m[0].href === "https://boardgamegeek.com" && m[0].alt === "Powered by BGG" && m[0].rh === H && m[0].w === "162" && m[0].h === "36" && m[0].src === "icons/powered-by-bgg.svg", JSON.stringify(m));
    check(`${width}: match logo tap target >= 44px, inside the sheet`, m[0] && m[0].tap >= 44 && m[0].right <= width, JSON.stringify(m[0]));
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => document.getElementById("tt-upc-panel").getBoundingClientRect().height);
    check(`${width}: no layout shift once the logo loads`, before === after, `${before} -> ${after}`);
    check(`${width}: logo not in the Save bar`, (await page.$("#tt-form .form-actions-right .tt-bgg-logo")) === null);
    await page.focus("#tt-upc-go");
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => { const a = document.activeElement; return a.matches(".tt-bgg-logo:focus-visible") && getComputedStyle(a).outlineStyle === "solid" && getComputedStyle(a).outlineWidth; });
    check(`${width}: keyboard focus shows a ring`, Boolean(ring), String(ring));
    if (SHOTS) {
      await page.evaluate(() => { document.activeElement.blur(); document.querySelector("#tt-upc-panel .tt-bgg-logo").scrollIntoView({ block: "center" }); });
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${SHOTS}/bgg-logo-${width}-result.png` });
    }
    // suggestions
    await page.fill("#tt-barcode", "222222222224");
    await page.click("#tt-upc-go");
    await page.waitForSelector("#tt-upc-panel [data-upc-pick]");
    check(`${width}: suggestions show the logo once`, (await logoInfo(page, "#tt-upc-panel .tt-bgg-logo")).length === 1);
    // no data
    await page.fill("#tt-barcode", "333333333331");
    await page.click("#tt-upc-go");
    await page.waitForFunction(() => /No match/.test(document.getElementById("tt-upc-panel").textContent));
    check(`${width}: no-data state shows no logo`, (await page.$("#tt-upc-panel .tt-bgg-logo")) === null);
    check(`${width}: no POSTs, no page errors`, !relay.some((x) => x.startsWith("POST")) && errors.length === 0, errors.join("; "));
    await ctx.close();
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
