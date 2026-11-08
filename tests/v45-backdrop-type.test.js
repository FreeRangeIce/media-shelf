// v45: sheet cover fills the screen after a simulated keyboard open/close (Duo), v41 pin
// repro, and the Add sheet's Type "Tabletop game" swap. LOCAL ONLY: the relay is mocked
// in-page (route.fulfill), the live Worker is aborted and counted, no POST is answered 2xx.
// NODE_PATH=<playwright-core> TT_ORIGIN=http://127.0.0.1:8881 [BEFORE_ORIGIN=http://127.0.0.1:8883 (v44)] \
//   [SHOTS=dir] node tests/v45-backdrop-type.test.js
//
// Keyboard simulation (headless Chrome has no soft keyboard): focus #tt-title, then shrink the
// page viewport by the keyboard height (setViewportSize; visualViewport and innerHeight shrink
// with it), scroll the sheet, then blur (the ✓ / Done tap) and restore the original size.
const { chromium } = require("playwright-core");
const fs = require("fs");
const ORIGIN = process.env.TT_ORIGIN || "http://127.0.0.1:8881";
const BEFORE = process.env.BEFORE_ORIGIN || "";
const SHOTS = process.env.SHOTS || "";
const RELAY = "http://127.0.0.1:8795";
for (const value of [ORIGIN, BEFORE, RELAY].filter(Boolean)) {
  const u = new URL(value);
  if (u.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) throw new Error("Local HTTP origins only");
}
const FLAG_ON = 'const GAMEUPC_LOOKUP = { enabled: true, relay: "https://frm-tabletop.freerangeice.workers.dev" };';
const T0 = "2026-10-01T10:00:00.000Z";
const MOCK = { upc: "111111111117", status: "verified", name: "Splendor", searchedFor: "", candidates: [{ bggId: "148228", name: "Splendor", year: "2014", thumbnail: "" }] };
const ITEMS = Array.from({ length: 24 }, (_, i) => ({ id: "m" + i, type: i % 2 ? "game" : "book", title: "Item " + i, status: i === 1 ? "in_progress" : "owned", format: "physical", platform: i % 2 ? "switch" : "", dateAdded: T0, dateUpdated: T0 }));
const live = [], posts = [];
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !d ? "" : "  — " + d}`); };
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

async function open(browser, origin, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", hasTouch: true });
  await ctx.addInitScript(({ relay, items }) => {
    window.__FRM_TT_LOOKUP__ = { relay };
    if (sessionStorage.getItem("__init")) return;
    sessionStorage.setItem("__init", "1");
    localStorage.clear();
    localStorage.setItem("media-shelf-seeded", "2026-01-01T00:00:00.000Z");
    localStorage.setItem("media-tracker-v1", JSON.stringify({ version: 1, savedAt: "2026-10-01T10:00:00.000Z", items }));
    localStorage.setItem("media-tracker-v1:tabletop", "[]");
  }, { relay: RELAY, items: ITEMS });
  await ctx.route("**/*", async (r) => {
    const u = r.request().url();
    if (/^https:\/\/frm-tabletop\.freerangeice\.workers\.dev|gameupc\.com/.test(u)) { live.push(u); return r.abort(); }
    if (new URL(u).origin === new URL(RELAY).origin) {
      if (r.request().method() !== "GET") { posts.push(u); return r.fulfill({ status: 500, headers: { "Access-Control-Allow-Origin": origin }, body: "{}" }); }
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": origin }, body: JSON.stringify(MOCK) });
    }
    if (u.startsWith(origin + "/tabletop.js")) {
      const res = await r.fetch({ maxRedirects: 0 }); const body = await res.text();
      return r.fulfill({ response: res, body: body.replace(FLAG_ON, `const GAMEUPC_LOOKUP = { enabled: true, relay: "${RELAY}" };`) });
    }
    return new URL(u).origin === new URL(origin).origin || u.startsWith("data:") ? r.continue() : r.abort();
  });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(origin + "/index.html");
  await page.waitForSelector("#stats .stat-pill");
  return { ctx, page, errors };
}
const geo = (page, id) => page.evaluate((id) => {
  const m = document.getElementById(id), b = m.querySelector(".modal-backdrop").getBoundingClientRect(), s = m.querySelector(".modal-panel").getBoundingClientRect();
  const vv = window.visualViewport;
  return { W: innerWidth, H: innerHeight, b: [b.left, b.top, b.right, b.bottom], sTop: Math.round(s.top), sH: Math.round(s.height), y: scrollY, vvTop: vv ? vv.offsetTop : 0, open: document.body.classList.contains("modal-open"), pos: document.body.style.position };
}, id);
const covers = (g) => g.b[0] <= 0 && g.b[1] <= 0 && g.b[2] >= g.W && g.b[3] >= g.H;

async function ttLookup(page) {
  await page.click('.type-tabs .chip[data-type="tabletop"]');
  await page.evaluate(() => scrollTo(0, 0));
  await page.click("#btn-add");
  await page.waitForSelector("#tt-form-modal:not([hidden])");
  await page.fill("#tt-barcode", "111111111117");
  await page.click("#tt-upc-go");
  await page.waitForSelector("#tt-upc-panel:not([hidden]) :is(.tt-upc-found, .tt-upc-h)");
  await page.waitForTimeout(250);
}
async function keyboard(page, width, height, kb, sheetSel, shot) {
  await page.focus("#tt-title");
  await page.setViewportSize({ width, height: height - kb });
  await page.waitForTimeout(250);
  await page.evaluate((s) => { const p = document.querySelector(s); p.scrollTop = 200; }, sheetSel);
  await page.waitForTimeout(150);
  const during = await geo(page, "tt-form-modal");
  if (shot) await page.screenshot({ path: shot + "-kbopen.png" });
  await page.evaluate(() => document.activeElement.blur());
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(350);
  return during;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  // Review fixtures are example shelf data; no external calls.
  if (SHOTS) for (const w of [320, 390]) {
    const {ctx, page} = await open(browser, ORIGIN, w, 1000);
    await page.click('.type-tabs .chip[data-type="game"]');
    await page.waitForTimeout(350);
    await page.screenshot({path: `${SHOTS}/v45-games-${w}.png`, fullPage: true});
    await ctx.close();
  }
  // 1. Backdrop after keyboard open -> close (Tabletop Add sheet after a lookup)
  const sizes = [[390, 844, 336], [1000, 720, 300], [1000, 420, 200], [466, 800, 320]];
  for (const [origin, tag] of [[ORIGIN, "v45"], ...(BEFORE ? [[BEFORE, "v44"]] : [])]) {
    for (const [w, h, kb] of sizes) {
      const { ctx, page, errors } = await open(browser, origin, w, h);
      await ttLookup(page);
      const g0 = await geo(page, "tt-form-modal");
      const name = `${tag} ${w}x${h}`;
      const shotBase = SHOTS && ((w === 390) || (w === 1000 && h === 420)) ? `${SHOTS}/${tag}-backdrop-${w === 390 ? "390" : "1000x420"}` : "";
      const during = await keyboard(page, w, h, kb, "#tt-form-modal > .modal-panel", shotBase && tag === "v45" ? shotBase : "");
      const g1 = await geo(page, "tt-form-modal");
      if (shotBase) await page.screenshot({ path: shotBase + "-kbclosed.png" });
      check(`${name}: cover fills the screen with the keyboard up`, covers(during), JSON.stringify(during));
      check(`${name}: cover fills 0,0 to innerWidth x innerHeight after the keyboard closes`, covers(g1), JSON.stringify(g1));
      check(`${name}: sheet height <= innerHeight after close`, g1.sH <= g1.H, JSON.stringify(g1));
      check(`${name}: sheet top / page scroll / vv.offsetTop back where they started`, Math.abs(g1.sTop - g0.sTop) <= 1 && g1.y === g0.y && g1.vvTop === 0, JSON.stringify({ g0, g1 }));
      check(`${name}: page still pinned (modal-open, body fixed)`, g1.open && g1.pos === "fixed", JSON.stringify(g1));
      check(`${name}: no page errors`, errors.length === 0, errors.join(" | "));
      await ctx.close();
    }
  }
  // 2. v41 repro on the media Add sheet: open Add, tap Title, scroll with the keyboard up, close it
  for (const [w, h, kb] of sizes) {
    const { ctx, page } = await open(browser, ORIGIN, w, h);
    const Y = await page.evaluate(() => { scrollTo(0, 400); return scrollY; });
    await page.evaluate(() => document.querySelector("#btn-add").click());
    await page.waitForSelector("#modal:not([hidden])");
    // Let the opening transition settle before comparing restored geometry.
    await page.waitForTimeout(350);
    const g0 = await geo(page, "modal");
    await page.focus("#field-title");
    await page.setViewportSize({ width: w, height: h - kb });
    await page.waitForTimeout(250);
    await page.evaluate(() => { document.querySelector("#modal > .modal-panel").scrollTop = 300; });
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(200);
    const mid = await geo(page, "modal");
    const mediaShot = SHOTS && (w === 390 || (w === 1000 && h === 420)) ? `${SHOTS}/v45-media-backdrop-${w === 390 ? "390" : "1000x420"}` : "";
    if (mediaShot) await page.screenshot({path: mediaShot + "-kbopen.png"});
    await page.evaluate(() => document.activeElement.blur());
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(350);
    await page.evaluate(() => { document.querySelector("#modal > .modal-panel").scrollTop = 0; });
    const g1 = await geo(page, "modal");
    if (mediaShot) await page.screenshot({path: mediaShot + "-kbclosed.png"});
    check(`v41 repro ${w}x${h}: page did not scroll under the sheet`, mid.y === 0 && mid.pos === "fixed", JSON.stringify(mid));
    check(`v41 repro ${w}x${h}: sheet not left shifted up (top as before, scroll 0, vv.offsetTop 0)`, Math.abs(g1.sTop - g0.sTop) <= 1 && g1.y === 0 && g1.vvTop === 0, JSON.stringify({ g0, g1 }));
    check(`v41 repro ${w}x${h}: cover fills the screen`, covers(g1), JSON.stringify(g1));
    await page.click("#modal-close");
    await page.waitForTimeout(250);
    check(`v41 repro ${w}x${h}: page back at Y after close`, (await page.evaluate(() => scrollY)) === Y);
    await ctx.close();
  }
  // 3. Type "Tabletop game"
  {
    const { ctx, page, errors } = await open(browser, ORIGIN, 390, 844);
    await page.click("#btn-add");
    await page.waitForSelector("#modal:not([hidden])");
    const opts = await page.$$eval("#field-type option", (o) => o.map((x) => x.value + ":" + x.textContent));
    check("Type options: Book, Video game, Movie, Music, Comic, Tabletop game", opts.join(",") === "book:Book,game:Video game,movie:Movie,music:Music,comic:Comic,tabletop:Tabletop game", opts.join(","));
    await page.fill("#field-title", "Catan");
    await page.fill("#field-barcode", "029877030712");
    if (SHOTS) {
      await page.evaluate(() => { const s = document.querySelector("#field-type"); s.size = 6; s.style.height = "auto"; s.value = "tabletop"; s.scrollIntoView({ block: "center" }); });
      await page.screenshot({ path: `${SHOTS}/v45-type-tabletop-390.png` });
      await page.evaluate(() => { const s = document.querySelector("#field-type"); s.removeAttribute("size"); s.style.height = ""; s.value = "book"; });
    }
    await page.evaluate(() => {
      window.__drops = 0;
      new MutationObserver(() => { if (!document.body.classList.contains("modal-open")) window.__drops++; }).observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
      window.__posDrops = 0;
      new MutationObserver(() => { if (document.body.style.position !== "fixed") window.__posDrops++; }).observe(document.body, { attributes: true, attributeFilter: ["style"] });
    });
    await page.selectOption("#field-type", "tabletop");
    await page.waitForTimeout(250);
    const st = await page.evaluate(() => ({ media: document.getElementById("modal").hidden, tt: document.getElementById("tt-form-modal").hidden, title: document.getElementById("tt-title").value, bc: document.getElementById("tt-barcode").value, focus: document.activeElement.id, drops: window.__drops, posDrops: window.__posDrops, open: document.body.classList.contains("modal-open"), chip: document.querySelector(".type-tabs .chip[aria-selected=true]").dataset.type }));
    check("picking Tabletop game: media sheet closes, Tabletop sheet opens", st.media && !st.tt, JSON.stringify(st));
    check("Title and Barcode carried over", st.title === "Catan" && st.bc === "029877030712", JSON.stringify(st));
    check("focus on the Tabletop Title", st.focus === "tt-title", st.focus);
    check("body.modal-open never dropped, pin never released", st.drops === 0 && st.posDrops === 0 && st.open, JSON.stringify(st));
    check("shelf filter not switched", st.chip === "all", st.chip);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/v45-type-tabletop-390-sheet.png` });
    const order = [];
    for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); order.push(await page.evaluate(() => document.activeElement.id || document.activeElement.className)); }
    check("Tab order stays in the Tabletop sheet (Title -> upc lookup -> Kind -> ...)", order.every((x) => x) && (await page.evaluate(() => document.getElementById("tt-form-modal").contains(document.activeElement))), order.join(" > "));
    await page.click('#tt-form-modal .btn-icon[data-tt-close]');
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => ({ media: document.getElementById("modal").hidden, tt: document.getElementById("tt-form-modal").hidden, open: document.body.classList.contains("modal-open"), focus: document.activeElement.id }));
    check("Cancel just closes (no bounce back), unpins, focus back to + Add", after.media && after.tt && !after.open && after.focus === "btn-add", JSON.stringify(after));
    // Edit an existing item: no Tabletop option
    await page.click(".item-card, [data-id]");
    await page.waitForSelector("#modal:not([hidden])");
    check("editing a media item: no Tabletop game option", (await page.$('#field-type option[value="tabletop"]')) === null);
    check("no page errors (type)", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  check("zero requests to the live Worker / GameUPC", live.length === 0, live.join(" "));
  check("no relay writes attempted (all non-GETs blocked)", posts.length === 0, posts.join(" "));
  console.log(`\n${pass}/${pass + fail} passed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
