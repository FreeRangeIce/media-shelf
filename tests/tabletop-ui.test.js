// Browser tests + screenshots for the Tabletop tab.
// NODE_PATH=/workspace/frm-comics-test/node_modules TT_ORIGIN=http://127.0.0.1:8823 MAIN_ORIGIN=http://127.0.0.1:8824 \
//   SHOTS=/workspace/frm-tabletop-shots node tests/tabletop-ui.test.js
const { chromium } = require("playwright-core");
const fs = require("fs");
const ORIGIN = process.env.TT_ORIGIN || "http://127.0.0.1:8823";
const MAIN = process.env.MAIN_ORIGIN || ""; // origin/main served, for "Games tab unchanged"
const SHOTS = process.env.SHOTS || "";
const T0 = "2026-10-01T10:00:00.000Z";
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const media = { version: 1, savedAt: T0, items: [
  { id: "g1", type: "game", title: "Existing Game", platform: "Switch", year: 2019, status: "owned", format: "physical", dateAdded: T0, dateUpdated: T0, sources: ["manual"], tags: [], notes: "" },
  { id: "g2", type: "game", title: "Another Game", platform: "PS5", year: 2022, status: "want", format: "digital", dateAdded: T0, dateUpdated: T0, sources: ["manual"], tags: [], notes: "" },
  { id: "bk", type: "book", title: "A Book", creator: "Author", year: 2005, status: "owned", format: "physical", dateAdded: T0, dateUpdated: T0, sources: ["manual"], tags: [], notes: "" },
] };
const E = (o) => ({ status: "owned", dateAdded: T0, dateUpdated: T0, ...o });
const SHELF = [
  E({ id: "b0", title: "Azul", subtype: "board", bggId: "230802", designer: "Michael Kiesling", year: "2017", players: "2–4", playTime: "45" }),
  E({ id: "b2", title: "Wingspan", subtype: "board", bggId: "266192", designer: "Elizabeth Hargrave", year: "2019", players: "1–5", playTime: "70" }),
  E({ id: "w1", title: "Wingspan: European Expansion", subtype: "expansion", parentBggId: "266192", status: "owned" }),
  E({ id: "w2", title: "Wingspan: Oceania Expansion", subtype: "expansion", parentBggId: "266192", status: "want" }),
  E({ id: "b5", title: "Catan", subtype: "board", bggId: "13", designer: "Klaus Teuber", year: "1995", players: "3–4", playTime: "90", status: "want" }),
  ...["Seafarers", "Cities & Knights", "Traders & Barbarians", "Explorers & Pirates", "5–6 Player Extension"].map((t, i) =>
    E({ id: `c${i}`, title: `Catan: ${t}`, subtype: "expansion", parentBggId: "13", status: i === 1 ? "want" : "owned" })),
  E({ id: "lone", title: "Spirit Island: Jagged Earth", subtype: "expansion", parentBggId: "162886", parentTitle: "Spirit Island" }),
  E({ id: "lonew", title: "Root: The Underworld Expansion", subtype: "expansion", parentBggId: "237182", status: "want" }),
  E({ id: "rpg", title: "Mothership Player's Survival Guide", subtype: "rpg", year: "2023" }),
];

async function open(browser, { width = 390, height = 1400, tt = null, store = media, origin = ORIGIN, ctx = null } = {}) {
  ctx = ctx || (await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" }));
  const requests = [];
  await ctx.addInitScript(({ store, tt }) => {
    if (sessionStorage.getItem("__init")) return;
    sessionStorage.setItem("__init", "1");
    if (localStorage.getItem("__ctxinit")) return;
    localStorage.clear();
    localStorage.setItem("__ctxinit", "1");
    localStorage.setItem("media-shelf-seeded", "2026-01-01T00:00:00.000Z");
    
    localStorage.setItem("media-tracker-v1", JSON.stringify(store));
    if (tt) localStorage.setItem("media-tracker-v1:tabletop", JSON.stringify(tt));
  }, { store, tt });
  await ctx.route("**/*", (r) => { const u = r.request().url(); requests.push(u); return u.startsWith(origin) || u.startsWith("data:") || u.startsWith("blob:") ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(origin + "/index.html");
  await page.waitForSelector("#stats .stat-pill");
  return { ctx, page, errors, requests };
}
const tab = (page, t) => page.click(`.type-tabs .chip[data-type="${t}"]`);
const ttStore = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("media-tracker-v1:tabletop") || "[]"));
// v2: viewport-height captures (never full page), so the sticky header can't land on cards.
const SHOT_DIR = SHOTS ? `${SHOTS}/v2` : "";
const footerLog = [];
async function shot(page, name) {
  if (!SHOT_DIR) return;
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false });
  footerLog.push({ name, ...(await page.evaluate(() => { const f = [...document.querySelectorAll(".footer-credit")].find((x) => /Board game data from BoardGameGeek/.test(x.textContent)); if (!f) return { inDom: false }; const r = f.getBoundingClientRect(); return { inDom: true, rendered: r.height > 0, inView: r.bottom > 0 && r.top < innerHeight }; })) });
}
const V3 = SHOTS ? `${SHOTS}/v3` : "";
async function vshot(page, name) { if (!V3) return; fs.mkdirSync(V3, { recursive: true }); await page.waitForTimeout(150); await page.screenshot({ path: `${V3}/${name}.png`, fullPage: false }); }
const T_parent = (list, id) => { const T = require("../tabletop.js"); const r = T.resolveParent(list.map(T.normalize), T.normalize(list.find((e) => e.id === id))); return r && r.id; };
// Relative luminance contrast (WCAG 2.x).
const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
async function addViaForm(page, fields) {
  await page.click("#btn-add");
  await page.waitForSelector("#tt-form-modal:not([hidden])");
  for (const [k, v] of Object.entries(fields)) {
    const el = `#tt-${k}`;
    if (await page.$eval(el, (e) => e.tagName === "SELECT")) await page.selectOption(el, v); else await page.fill(el, v);
  }
  await page.click("#tt-save");
}

(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: true });
  if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });

  // Empty tab + tab strip
  {
    const { page, ctx, errors } = await open(browser);
    await tab(page, "tabletop");
    check("empty Tabletop tab shows its empty state", await page.isVisible("#tabletop-empty") && /No tabletop games yet/.test(await page.textContent("#tabletop-empty")));
    check("media list hidden on Tabletop tab", await page.isHidden("#item-list"));
    const labels = await page.$$eval(".type-tabs .chip", (b) => b.map((x) => x.textContent.trim()));
    check("Tabletop is the last tab, after Comics", labels.join(",") === "All,Books,Games,Movies,Music,Comics,Tabletop", labels.join(","));
    for (const w of [390, 320]) {
      await page.setViewportSize({ width: w, height: 1000 });
      const m = await page.evaluate(() => {
        const n = document.querySelector(".type-tabs"); const c = [...n.querySelectorAll(".chip")];
        return { scroll: n.scrollWidth > n.clientWidth, docW: document.documentElement.scrollWidth, minH: Math.min(...c.map((x) => x.getBoundingClientRect().height)), fs: getComputedStyle(c[0]).fontSize, fade: getComputedStyle(n, "::after").width };
      });
      check(`tabs at ${w}: strip scrolls, page doesn't, 44px targets, 14px type, 32px fade`, m.scroll && m.docW === w && m.minH >= 44 && m.fs === "14px" && m.fade === "32px", JSON.stringify(m));
    }
    // Tab strip: active tab scrolled into view with a 16px inset; a fade on each side with hidden tabs.
    for (const w of [390, 320]) {
      await page.setViewportSize({ width: w, height: 844 });
      await page.waitForTimeout(300);
      const f = await page.evaluate(() => { const n = document.querySelector(".type-tabs"); const a = n.querySelector(".chip.active"); const nr = n.getBoundingClientRect(), ar = a.getBoundingClientRect(); return { start: getComputedStyle(n.querySelector(".type-tabs-fade-start")).opacity, startW: getComputedStyle(n.querySelector(".type-tabs-fade-start")).width, end: getComputedStyle(n, "::after").opacity, gapR: Math.round(nr.right - ar.right), sl: n.scrollLeft, atEnd: n.scrollLeft >= n.scrollWidth - n.clientWidth - 1 }; });
      // Last tab: the strip is scrolled to its end, so it sits flush there (no room for a 16px inset).
      check(`tabs at ${w}: Tabletop (last) active and in view, 32px left fade on, right fade off`, f.start === "1" && f.startW === "32px" && f.end === "0" && f.atEnd && f.gapR >= 0, JSON.stringify(f));
      if (w === 390) await shot(page, "tabstrip-left-fade-390");
    }
    await tab(page, "all");
    await page.waitForTimeout(300);
    const f0 = await page.evaluate(() => { const n = document.querySelector(".type-tabs"); return { sl: n.scrollLeft, start: getComputedStyle(n.querySelector(".type-tabs-fade-start")).opacity, end: getComputedStyle(n, "::after").opacity }; });
    check("tabs at 320: All active shows All, right fade only", f0.sl === 0 && f0.start === "0" && f0.end === "1", JSON.stringify(f0));
    await page.$eval(".type-tabs", (n) => { n.scrollLeft = 60; n.dispatchEvent(new Event("scroll")); });
    await page.waitForTimeout(250);
    const fm = await page.evaluate(() => { const n = document.querySelector(".type-tabs"); return [getComputedStyle(n.querySelector(".type-tabs-fade-start")).opacity, getComputedStyle(n, "::after").opacity]; });
    check("tabs: mid-scroll shows both fades (updated on scroll)", fm.join() === "1,1", fm.join());
    await page.$eval('.type-tabs .chip[data-type="music"]', (b) => b.click()); // DOM click: Playwright would scroll it into view itself
    await page.waitForTimeout(300);
    const ins = await page.evaluate(() => { const n = document.querySelector(".type-tabs"); const a = n.querySelector(".chip.active"); const nr = n.getBoundingClientRect(), ar = a.getBoundingClientRect(); return { l: Math.round(ar.left - nr.left), r: Math.round(nr.right - ar.right) }; });
    check("tabs at 320: a middle tab scrolls into view with ≥16px inset", ins.l >= 15 && ins.r >= 15, JSON.stringify(ins));
    await page.$eval(".type-tabs", (n) => { n.scrollLeft = 0; });
    await page.$eval('.type-tabs .chip[data-type="comic"]', (b) => b.click());
    await page.waitForTimeout(300);
    const ins2 = await page.evaluate(() => { const n = document.querySelector(".type-tabs"); const a = n.querySelector(".chip.active"); const nr = n.getBoundingClientRect(), ar = a.getBoundingClientRect(); return Math.round(nr.right - ar.right); });
    check("tabs at 320: tab hidden on the right comes in with a 16px inset", ins2 >= 15 && ins2 <= 17, String(ins2));
    await tab(page, "tabletop");
    for (const w of [1440, 390, 320]) { await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 844 }); await shot(page, `empty-${w}`); }
    check("no page errors (empty)", !errors.length, errors.join("|"));
    await ctx.close();
  }

  // Add: default Owned, lookup not connected (no network), expansion missing parent, parent later
  {
    const { page, ctx, errors, requests } = await open(browser);
    await tab(page, "tabletop");
    await page.click("#tt-empty-add");
    check("new entry form defaults to Owned", (await page.inputValue("#tt-status")) === "owned");
    const lk = await page.evaluate(() => { const b = document.getElementById("tt-lookup"); const cs = getComputedStyle(b); const d = document.getElementById(b.getAttribute("aria-describedby") || ""); return { ad: b.getAttribute("aria-disabled"), dis: b.disabled, op: cs.opacity, cur: cs.cursor, tab: b.tabIndex, desc: d ? d.textContent : "" }; });
    check("Lookup control: aria-disabled, 50% opacity, default cursor, still focusable and described", lk.ad === "true" && !lk.dis && lk.op === "0.5" && lk.cur === "default" && lk.tab === 0 && /isn’t connected yet/.test(lk.desc), JSON.stringify(lk));
    await page.focus("#tt-lookup");
    check("Lookup control takes keyboard focus", await page.evaluate(() => document.activeElement.id === "tt-lookup"));
    const before = requests.length;
    await page.click("#tt-lookup", { force: true }); // aria-disabled: Playwright would wait for "enabled"
    const msg = await page.textContent("#tt-lookup-status");
    check("Lookup says it isn't connected", /BoardGameGeek lookup isn’t connected yet/.test(msg), msg);
    check("Lookup made no network request", requests.length === before);
    for (const w of [1440, 390, 320]) { await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 844 }); await page.$eval("#tt-lookup-status", (e) => e.scrollIntoView({ block: "center" })); await shot(page, `lookup-not-connected-${w}`); }
    await page.setViewportSize({ width: 390, height: 1400 });
    await page.fill("#tt-title", "Wingspan: European Expansion");
    await page.selectOption("#tt-subtype", "expansion");
    check("Base game picker shows for Expansion", await page.isVisible("#tt-parent"));
    await page.fill("#tt-parentBggId", "266192");
    await page.click("#tt-save");
    await page.waitForSelector("#tt-form-modal[hidden]", { state: "attached" });
    let s = await ttStore(page);
    check("expansion with missing parent saves", s.length === 1 && s[0].status === "owned" && s[0].parentId === "" && s[0].parentBggId === "266192");
    check("lone expansion shows the Expansion label", /Expansion/.test(await page.textContent(".tt-card .tt-kicker")));
    await addViaForm(page, { title: "Wingspan", bggId: "266192" });
    await page.waitForSelector(".tt-exp-row");
    const groups = await page.$$eval("#tabletop-list > li", (l) => l.length);
    check("parent added later pulls its expansion under it", groups === 1 && (await page.textContent(".tt-exp-row")).includes("European"));
    check("tabletop count in the stats", /2 tabletop/.test(await page.textContent("#stats")));
    // Duplicate by BGG id, then by title
    await addViaForm(page, { title: "Wingspan 2nd printing", bggId: "266192", designer: "E. Hargrave" });
    check("duplicate by BGG id offers update", await page.isVisible("#tt-dup") && /BGG id/.test(await page.textContent("#tt-dup-text")));
    await page.click("#tt-dup-update");
    s = await ttStore(page);
    check("update changed the existing entry, no second copy", s.length === 2 && s.find((e) => e.bggId === "266192" && e.subtype === "board").designer === "E. Hargrave");
    await addViaForm(page, { title: "wingspan 2nd printing" });
    check("duplicate by title offers update (no silent merge)", await page.isVisible("#tt-dup") && /share a title/.test(await page.textContent("#tt-dup-text")) && (await ttStore(page)).length === 2);
    await page.click("#tt-dup-add");
    check("title duplicate can still be added as a separate copy", (await ttStore(page)).length === 3);
    // Barcode kept on a manual entry (lookup not connected = miss path)
    await addViaForm(page, { title: "Cascadia", barcode: "0850000000017" });
    check("barcode kept on the entry", (await ttStore(page)).some((e) => e.barcode === "0850000000017"));
    check("no page errors (add)", !errors.length, errors.join("|"));
    await ctx.close();
  }

  // Shelf shots, opened base / expansion, delete base
  {
    const { page, ctx, errors } = await open(browser, { tt: SHELF });
    await tab(page, "tabletop");
    const info = await page.evaluate(() => [...document.querySelectorAll("#tabletop-list > li")].map((li) => ({ t: li.querySelector(".item-title").textContent, rows: li.querySelectorAll(".tt-exp-row").length, more: (li.querySelector(".tt-exp-more") || {}).textContent || "" })));
    const g = (t) => info.find((x) => x.t === t) || {};
    check("base with 0 expansions: no list", g("Azul").rows === 0);
    check("base with 2 expansions: both listed", g("Wingspan").rows === 2);
    check("base with 5 expansions: 3 shown + '+ 2 more'", g("Catan").rows === 3 && g("Catan").more === "+ 2 more", JSON.stringify(g("Catan")));
    check("lone expansions stand alone", !!g("Spirit Island: Jagged Earth").t && !!g("Root: The Underworld Expansion").t);
    const rowStyle = await page.evaluate(() => { const ul = document.querySelector(".tt-exp-list"); const r = ul.querySelector(".tt-exp-row"); const card = ul.previousElementSibling; return { indent: ul.getBoundingClientRect().left - card.getBoundingClientRect().left, fs: getComputedStyle(r.querySelector(".tt-exp-title")).fontSize, h: r.getBoundingClientRect().height, cardInCard: !!ul.closest(".item-card") }; });
    check("expansion rows: 16px indent, 15px title, 44px tall, not inside the card", rowStyle.indent === 16 && rowStyle.fs === "15px" && rowStyle.h >= 44 && !rowStyle.cardInCard, JSON.stringify(rowStyle));
    const wantRow = await page.evaluate(() => [...document.querySelectorAll(".tt-exp-row")].find((r) => /Oceania/.test(r.textContent)).querySelector(".badge").textContent);
    check("Want expansion under an Owned base reads Want", wantRow === "Want");
    const catanBadges = await page.evaluate(() => { const li = [...document.querySelectorAll("#tabletop-list > li")].find((l) => /Catan/.test(l.textContent)); return [li.querySelector(".item-card .badge-status").textContent, li.querySelector(".tt-exp-row .badge").textContent]; });
    check("Owned expansion under a Want base: both read clearly", catanBadges[0] === "Want" && catanBadges[1] === "Owned", catanBadges.join("/"));
    check("Games tab untouched by tabletop entries", (await (async () => { await tab(page, "game"); const n = await page.$$eval("#item-list > li", (l) => l.length); await tab(page, "tabletop"); return n; })()) === 2);
    // Status badges: Owned filled, Want outline, same on card, expansion row and sheet; no blue.
    const badgeCss = (sel) => page.$eval(sel, (b) => { const c = getComputedStyle(b); let bg = "rgb(255, 253, 248)"; for (let n = b; n; n = n.parentElement) { const x = getComputedStyle(n).backgroundColor; if (x !== "rgba(0, 0, 0, 0)" && x !== "transparent") { bg = x; break; } } return { bg: c.backgroundColor, fg: c.color, bw: c.borderTopWidth, bc: c.borderTopColor, under: bg }; });
        // Chrome snaps a 1.5px border to whole device pixels (1px at DPR 1), so the computed width
    // is checked loosely and the authored 1.5px is read from the stylesheet.
    const OWN = { bg: "rgb(140, 29, 90)", fg: "rgb(255, 255, 255)", bc: "rgb(140, 29, 90)" };
    const WANT = { fg: "rgb(140, 29, 90)", bc: "rgb(140, 29, 90)" };
    const same = (got, want) => ["1px", "1.5px"].includes(got.bw) && Object.entries(want).every(([k, v]) => got[k] === v);
    const authored = await page.evaluate(() => { for (const sh of document.styleSheets) for (const r of sh.cssRules) if (r.selectorText === ".badge.tt-status") return r.style.borderWidth || r.style.borderTopWidth; return ""; });
    check("status badge border authored at 1.5px", authored === "1.5px", authored);
    const cardOwned = await badgeCss('article[data-tt-open="b2"] .badge-status');
    const cardWant = await badgeCss('article[data-tt-open="b5"] .badge-status');
    const rowOwned = await badgeCss('.tt-exp-row[data-tt-open="w1"] .badge-status');
    const rowWant = await badgeCss('.tt-exp-row[data-tt-open="w2"] .badge-status');
    await page.click('article[data-tt-open="b2"]');
    const sheetOwned = await badgeCss("#tt-detail-body .tt-detail-badges .badge-status");
    const sheetWantRow = await badgeCss('#tt-detail-body .tt-exp-row[data-tt-open="w2"] .badge-status');
    await page.click("#tt-detail-close");
    await page.click('article[data-tt-open="b5"]');
    const sheetWant = await badgeCss("#tt-detail-body .tt-detail-badges .badge-status");
    await page.click("#tt-detail-close");
    check("Owned badge filled #8c1d5a / white on card, expansion row and sheet", [cardOwned, rowOwned, sheetOwned].every((x) => same(x, OWN)), JSON.stringify([cardOwned, rowOwned, sheetOwned]));
    check("Want badge is a 1.5px #8c1d5a outline with #8c1d5a text, transparent on paper", [cardWant, rowWant, sheetWant, sheetWantRow].every((x) => same(x, WANT)) && [cardWant, sheetWant, sheetWantRow].every((x) => x.bg === "rgba(0, 0, 0, 0)"), JSON.stringify([cardWant, rowWant, sheetWant, sheetWantRow]));
    const blue = [cardOwned, cardWant, rowOwned, rowWant, sheetOwned, sheetWant].some((x) => [x.bg, x.fg, x.bc].some((c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return b > r + 20 && b > g; }));
    check("no blue in Tabletop status badges", !blue);
    const ratios = [["Owned (white on #8c1d5a)", OWN.fg, OWN.bg], ["Want on card paper", cardWant.fg, cardWant.under], ["Want in sheet", sheetWant.fg, sheetWant.under], ["Want on oak row (paper backing)", rowWant.fg, rowWant.bg]].map(([n, a, b]) => [n, contrast(a, b)]);
    console.log("      contrast: " + ratios.map(([n, r]) => `${n} ${r.toFixed(2)}:1`).join(", "));
    check("badge text contrast ≥ 4.5:1 everywhere", ratios.every(([, r]) => r >= 4.5), ratios.map(([n, r]) => `${n} ${r.toFixed(2)}`).join("; "));
    const chip = await page.$eval('article[data-tt-open="b2"] .badge-type', (b) => ({ r: getComputedStyle(b).borderRadius, bg: getComputedStyle(b).backgroundColor }));
    check("subtype chip: 4px radius, pink tint kept", chip.r === "4px" && chip.bg === "rgba(214, 58, 140, 0.28)", JSON.stringify(chip));
    const metaB2 = await page.$eval('article[data-tt-open="b2"] .item-meta', (m) => m.textContent);
    check("non-breaking spaces in '1–5 players' and '70 min'", /1\u2060–\u20605\u00a0players/.test(metaB2) && /70\u00a0min/.test(metaB2), JSON.stringify(metaB2));
    check("lone expansion with no creator/year has no '—' line", (await page.$$eval('article[data-tt-open="lonew"] .item-meta', (m) => m.length)) === 0 && !(await page.textContent('article[data-tt-open="lonew"]')).includes("—"));
    await page.click('article[data-tt-open="lonew"]');
    check("sheet with no creator/year has no '—' line", (await page.$$eval("#tt-detail-body .item-meta", (m) => m.length)) === 0 && !(await page.textContent("#tt-detail-body")).includes("—"));
    await page.click("#tt-detail-close");
    await page.click('article[data-tt-open="b2"]');
    const bggLine = await page.evaluate(() => { const ps = [...document.querySelectorAll("#tt-detail-body > *")]; const i = ps.findIndex((p) => /^BGG id 266192$/.test(p.textContent)); const c = getComputedStyle(ps[i]); return { last: i === ps.length - 1, fs: c.fontSize, color: c.color }; });
    check("sheet: 'BGG id N' last, 13px, muted", bggLine.last && bggLine.fs === "13px" && bggLine.color === "rgb(92, 83, 72)", JSON.stringify(bggLine));
    await page.click("#tt-detail-close");
    for (const w of [1440, 390, 320]) {
      await page.setViewportSize({ width: w, height: 1000 });
      const ov = await page.evaluate(() => document.documentElement.scrollWidth);
      check(`shelf at ${w}: no sideways page scroll`, ov === w, String(ov));
      await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 844 });
      await page.$eval("#tabletop-list", (e) => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 140));
      await shot(page, `shelf-grouped-${w}`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.click('[data-tt-open="b2"]');
      await page.waitForSelector("#tt-detail-modal:not([hidden])");
      await shot(page, `opened-base-2exp-${w}`);
      await page.click("#tt-detail-close");
      await page.click('[data-tt-open="b5"]');
      await shot(page, `opened-base-5exp-${w}`);
      await page.click("#tt-detail-close");
      await page.click('.tt-exp-row[data-tt-open="w2"]');
      await shot(page, `opened-want-expansion-shows-parent-${w}`);
      await page.click("#tt-detail-close");
      await page.click('article[data-tt-open="lone"]');
      await shot(page, `opened-lone-expansion-${w}`);
      await page.click("#tt-detail-close");
      // Footer credit companion: the viewport shots above stop short of the page footer.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await shot(page, `footer-credit-${w}`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.setViewportSize({ width: w, height: 1000 });
    }
    await page.setViewportSize({ width: 390, height: 1400 });
    await page.click('[data-tt-open="b5"]');
    check("opening a base lists all its expansions", (await page.$$eval("#tt-detail-body .tt-exp-row", (r) => r.length)) === 5);
    await page.click("#tt-detail-close");
    await page.click('.tt-exp-row[data-tt-open="w1"]');
    check("opening an expansion shows its parent", (await page.textContent("#tt-detail-body")).includes("Wingspan") && (await page.$$eval("#tt-detail-body .tt-exp-row", (r) => r.length)) === 1);
    await page.click("#tt-detail-close");
    // keyboard focus ring on a card
    await page.focus('article[data-tt-open="b2"]');
    await page.keyboard.press("Tab");
    const fr = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
    check("expansion row shows the copper focus ring", /196, 106, 58/.test(fr), fr);
    // delete a base
    await page.click('[data-tt-open="b2"]');
    await page.click("#tt-detail-delete");
    await page.click("#confirm-ok");
    const s = await ttStore(page);
    check("deleting a base keeps its expansions, standing alone", !s.find((e) => e.id === "b2") && s.filter((e) => /Wingspan/.test(e.title)).length === 2 && (await page.$$eval("#tabletop-list .tt-kicker", (k) => k.length)) === 4);
    check("no page errors (shelf)", !errors.length, errors.join("|"));
    await ctx.close();
  }

  // Backup round trip + old backup + two tabs
  {
    const { page, ctx, errors } = await open(browser, { tt: SHELF });
    await page.click("#btn-settings");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#btn-export")]);
    const text = fs.readFileSync(await dl.path(), "utf8");
    const data = JSON.parse(text);
    await page.click("#settings-close");
    check("export includes the tabletop block", data.tabletop && data.tabletop.entries.length === SHELF.length);
    await page.evaluate(() => localStorage.setItem("media-tracker-v1:tabletop", "[]"));
    await page.setInputFiles("#import-file", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(text) });
    await page.click("#confirm-ok"); // Replace
    let s = await ttStore(page);
    check("restore round-trips tabletop entries", s.length === SHELF.length && s.find((e) => e.id === "w2").status === "want");
    const old = JSON.stringify({ app: "freerangemedia", version: 3, exportedAt: T0, items: media.items });
    await page.setInputFiles("#import-file", { name: "old.json", mimeType: "application/json", buffer: Buffer.from(old) });
    await page.click("#confirm-ok");
    check("old backup without tabletop still restores (media) and leaves tabletop as is", (await page.evaluate(() => JSON.parse(localStorage.getItem("media-tracker-v1")).items.length)) === 3 && (await ttStore(page)).length === SHELF.length);
    // Two tabs: re-read before every write, so neither write is lost.
    const p2 = await ctx.newPage();
    await p2.goto(ORIGIN + "/index.html"); await p2.waitForSelector("#stats .stat-pill");
    await tab(page, "tabletop"); await tab(p2, "tabletop");
    await addViaForm(page, { title: "Tab A Game" });
    await addViaForm(p2, { title: "Tab B Game" });
    s = await ttStore(page);
    check("two tabs: both writes kept (no lost write)", s.some((e) => e.title === "Tab A Game") && s.some((e) => e.title === "Tab B Game"));
    await page.waitForTimeout(200);
    check("two tabs: the other tab re-renders from the storage event", (await page.textContent("#tabletop-list")).includes("Tab B Game"));
    check("no page errors (backup)", !errors.length, errors.join("|"));
    await ctx.close();
  }

  // Restore on a device with 0 media items and 3 games: Merge offered, Replace warns, counts named
  {
    const GAMES = [
      E({ id: "tt-a", title: "Wingspan", subtype: "board", bggId: "266192" }),
      E({ id: "tt-b", title: "Homebrew Quest", subtype: "board" }),
      E({ id: "tt-c", title: "European Expansion", subtype: "expansion", parentId: "tt-a", parentBggId: "266192", status: "want" }),
    ];
    const bk = (n) => Buffer.from(JSON.stringify({ app: "freerangemedia", version: 3, exportedAt: T0, items: [{ ...media.items[2], id: `m${n}` }], tabletop: { v: 1, entries: [E({ id: "tt-x", title: "Homebrew Quest", subtype: "board", status: "want", dateUpdated: "2026-10-05T10:00:00.000Z" })] } }));
    const { page, ctx, errors } = await open(browser, { store: { version: 1, savedAt: T0, items: [] }, tt: GAMES });
    await page.setInputFiles("#import-file", { name: "b.json", mimeType: "application/json", buffer: bk(1) });
    await page.waitForSelector("#confirm-modal:not([hidden]), #confirm-panel", { state: "visible" });
    const desc = await page.textContent("#confirm-desc");
    const altVisible = await page.isVisible("#confirm-alt");
    check("restore (0 items, 3 games): Merge is offered", altVisible && (await page.textContent("#confirm-alt")).trim() === "Merge");
    check("restore (0 items, 3 games): prompt names both counts", /This browser has 0 items and 3 tabletop games\./.test(desc), desc);
    check("restore (0 items, 3 games): Replace warns", (await page.textContent("#confirm-ok")).trim() === "Replace" && /Replace swaps everything here for the backup and can’t be undone/.test(desc), desc);
    await page.click("#confirm-alt"); // Merge
    await page.waitForSelector("#tt-match-modal:not([hidden])");
    check("0-media device: merge asks about the hand-entered match; one match hides 'N of M' and the rest button", (await page.isHidden("#tt-match-progress")) && (await page.isHidden("#tt-match-rest")));
    await page.click("#tt-match-keep");
    let s = await ttStore(page);
    const toast = await page.textContent("#toast");
    check("merge kept all 3 games and kept both hand-entered copies", s.length === 4 && ["tt-a", "tt-b", "tt-c", "tt-x"].every((id) => s.some((e) => e.id === id)), s.map((e) => e.id).join(","));
    check("merge toast counts kept / updated / skipped", /Same-title tabletop games: 1 kept both$/.test(toast), toast);
    await page.setInputFiles("#import-file", { name: "b2.json", mimeType: "application/json", buffer: bk(2) });
    await page.click("#confirm-ok"); // Replace
    const t2 = await page.textContent("#toast");
    check("restore toast counts items and games", /^Restored 1 item and 1 tabletop game$/.test(t2.trim()), t2);
    check("no page errors (restore 0 items)", !errors.length, errors.join("|"));
    await ctx.close();
  }

  // Editing a base's BGG id keeps its BGG-linked expansions
  {
    const { page, ctx, errors } = await open(browser, { tt: SHELF });
    await tab(page, "tabletop");
    await page.click('article[data-tt-open="b2"]');
    await page.click("#tt-detail-edit");
    await page.fill("#tt-bggId", "999999");
    await page.click("#tt-save");
    await page.waitForSelector("#tt-form-modal[hidden]", { state: "attached" });
    const s = await ttStore(page);
    const rows = await page.evaluate(() => { const li = [...document.querySelectorAll("#tabletop-list > li")].find((l) => l.querySelector(".item-title").textContent === "Wingspan"); return li.querySelectorAll(".tt-exp-row").length; });
    check("editing a base's BGG id carries its expansions", rows === 2 && s.filter((e) => e.parentBggId === "999999").length === 2, String(rows));
    check("no page errors (bgg id edit)", !errors.length, errors.join("|"));
    await ctx.close();
  }

  // Same-title prompt: one hand match at a time
  {
    const HERE = [
      E({ id: "h1", title: "Homebrew Quest", subtype: "board", designer: "Me", year: "2020", players: "2–4" }),
      E({ id: "h1x", title: "Homebrew Quest: Caves", subtype: "expansion", parentId: "h1" }),
      E({ id: "h2", title: "Wingspan", subtype: "board" }), // hand-entered here, BGG id in the backup
      E({ id: "h3", title: "Root", subtype: "board", bggId: "237182", designer: "Cole Wehrle" }), // BGG here, hand-entered in the backup
    ];
    const LATER = "2026-10-09T10:00:00.000Z";
    const INC = [
      E({ id: "i1", title: "Homebrew Quest", subtype: "board", designer: "", year: "2021", status: "want", dateUpdated: LATER }),
      E({ id: "i1x", title: "Homebrew Quest: Mines", subtype: "expansion", parentId: "i1" }),
      E({ id: "i2", title: "Wingspan", subtype: "board", bggId: "266192", designer: "Elizabeth Hargrave" }),
      E({ id: "i3", title: "Root", subtype: "board", status: "want" }),
      E({ id: "i3x", title: "Root: Riverfolk", subtype: "expansion", parentId: "i3" }),
    ];
    const bk = (entries, items = []) => Buffer.from(JSON.stringify({ app: "freerangemedia", version: 3, exportedAt: T0, items, tabletop: { v: 1, entries } }));
    const startMerge = async (page, buf) => {
      await page.setInputFiles("#import-file", { name: "m.json", mimeType: "application/json", buffer: buf });
      await page.click("#confirm-alt");
      await page.waitForSelector("#tt-match-modal:not([hidden])");
    };
    const { page, ctx, errors } = await open(browser, { tt: HERE });
    await tab(page, "tabletop");
    const before = { tt: await ttStore(page), items: await page.evaluate(() => localStorage.getItem("media-tracker-v1")) };
    await page.focus("#btn-settings");
    await startMerge(page, bk(INC, [{ ...media.items[2], id: "newbook" }]));
    check("normal first-pass prompt: no 'another tab' note", await page.isHidden("#tt-match-late"));
    check("prompt: focus moves into it (primary)", await page.evaluate(() => document.activeElement.id === "tt-match-keep"));
    const p1 = await page.evaluate(() => ({ prog: document.getElementById("tt-match-progress").textContent, labels: [...document.querySelectorAll(".tt-match-label")].map((x) => x.textContent), rest: !document.getElementById("tt-match-rest").hidden, bold: [...document.querySelectorAll(".tt-match-side b.tt-diff, .tt-match-side .badge.tt-diff")].map((b) => b.textContent), upd: [...document.querySelectorAll(".tt-match-side")].map((x) => (x.querySelector(".tt-match-updated") || {}).textContent || ""), primary: document.getElementById("tt-match-keep").className, outlines: ["tt-match-update", "tt-match-skip"].map((id) => document.getElementById(id).className), nameFs: getComputedStyle(document.querySelector(".tt-match-name")).fontSize, updFs: getComputedStyle(document.querySelector(".tt-match-updated")).fontSize }));
    check("prompt: '1 of 3', shelf then backup, 'Keep both for the rest' shown", p1.prog === "1 of 3" && p1.labels.join("|") === "On this shelf|From backup" && p1.rest, JSON.stringify(p1));
    check("prompt: differing values in bold (year, status), newer copy marked 'Updated <date>' 13px", p1.bold.includes("2020") && p1.bold.includes("2021") && p1.bold.includes("Want") && p1.upd[0] === "" && p1.upd[1] === "Updated Oct 9, 2026" && p1.updFs === "13px" && p1.nameFs === "16px", JSON.stringify(p1));
    check("Skip button reads 'Skip backup copy'", (await page.textContent("#tt-match-skip")).trim() === "Skip backup copy");
    check("prompt: Keep both is the filled primary; Update and Skip are outlines, Skip not danger", /btn-primary/.test(p1.primary) && p1.outlines.every((c) => /btn-outline/.test(c) && !/danger/.test(c)));
    check("nothing written while the prompt is open", JSON.stringify(await ttStore(page)) === JSON.stringify(before.tt) && (await page.evaluate(() => localStorage.getItem("media-tracker-v1"))) === before.items);
    for (const w of [1440, 390, 320]) { await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 844 }); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab"); await vshot(page, `match-1of3-rest-${w}`); await vshot(page, `match-bold-differences-${w}`); }
    const lay = async () => page.evaluate(() => { const s = [...document.querySelectorAll(".tt-match-side")].map((x) => x.getBoundingClientRect()); const b = ["tt-match-keep", "tt-match-update", "tt-match-skip", "tt-match-rest"].map((id) => document.getElementById(id).getBoundingClientRect()); return { cols: Math.abs(s[0].top - s[1].top) < 2, stackedShelfTop: s[0].bottom <= s[1].top, oneRow: Math.abs(b[0].top - b[2].top) < 2, primaryTop: b[0].top < b[1].top && b[1].top < b[2].top, fullW: Math.round(b[0].width) === Math.round(b[2].width), minH: Math.min(...b.map((r) => r.height)), docW: document.documentElement.scrollWidth }; });
    await page.setViewportSize({ width: 1440, height: 900 }); const L1 = await lay();
    const fb = async () => page.evaluate(() => { document.getElementById("tt-match-keep").focus(); const r = ["tt-match-keep", "tt-match-update", "tt-match-skip"].map((id) => document.getElementById(id).getBoundingClientRect()); const cs = getComputedStyle(document.getElementById("tt-match-keep")); return { w: r.map((x) => Math.round(x.width)), h: r.map((x) => Math.round(x.height)), focused: document.activeElement.id, tf: cs.transform, ol: cs.outlineWidth + " " + cs.outlineStyle, off: cs.outlineOffset, sh: cs.boxShadow }; });
    for (const w of [390, 320]) {
      await page.setViewportSize({ width: w, height: 844 });
      const B = await fb();
      check(`${w}: Keep both focused — same width as the others, all 44px, no transform, 2px outline at 2px offset`, B.focused === "tt-match-keep" && new Set(B.w).size === 1 && B.h.every((h) => h === 44) && B.tf === "none" && B.ol === "2px solid" && B.off === "2px" && B.sh === "none", JSON.stringify(B));
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const B14 = await fb();
    check("1440: focused Keep both same height as the others, no transform", new Set(B14.h).size === 1 && B14.tf === "none", JSON.stringify(B14));
    check("1440: two columns, buttons in one row", L1.cols && L1.oneRow, JSON.stringify(L1));
    await page.setViewportSize({ width: 320, height: 844 }); const L3 = await lay();
    check("320: stacked (shelf on top), buttons full width, primary on top, 44px targets, no sideways scroll", L3.stackedShelfTop && L3.primaryTop && L3.fullW && L3.minH >= 44 && L3.docW === 320, JSON.stringify(L3));
    await page.setViewportSize({ width: 390, height: 844 });
    check("390: stacked", (await lay()).stackedShelfTop);
    // answer: 1 update, 2 keep, 3 skip (no auto-advance: each tap moves one)
    await page.click("#tt-match-update");
    check("tap moves to 2 of 3", (await page.textContent("#tt-match-progress")) === "2 of 3");
    check("one-side BGG id (hand here, BGG incoming) is asked", /Wingspan/.test(await page.textContent("#tt-match-pair")));
    await page.click("#tt-match-keep");
    check("3 of 3: 'Keep both for the rest' hidden with one left", (await page.textContent("#tt-match-progress")) === "3 of 3" && (await page.isHidden("#tt-match-rest")));
    check("one-side BGG id (BGG here, hand incoming) is asked", /Root/.test(await page.textContent("#tt-match-pair")));
    await page.click("#tt-match-skip");
    await page.waitForSelector("#tt-match-modal[hidden]", { state: "attached" });
    check("focus returns after the prompt", await page.evaluate(() => document.activeElement && document.activeElement.id !== "tt-match-keep" && document.activeElement !== document.body));
    const s = await ttStore(page); const g = (id) => s.find((e) => e.id === id);
    const toast = await page.textContent("#toast");
    check("Update: h1 updated in place (empty designer kept, year/status from backup), no i1", g("h1").designer === "Me" && g("h1").year === "2021" && g("h1").status === "want" && !g("i1"), JSON.stringify(g("h1")));
    check("after Update: shelf expansion and restored expansion both under the base (local id)", T_parent(s, "h1x") === "h1" && T_parent(s, "i1x") === "h1");
    check("Keep both: two Wingspans", s.filter((e) => e.title === "Wingspan").length === 2);
    check("Skip: one Root, unchanged, restored expansion relinked to it", s.filter((e) => e.title === "Root").length === 1 && g("h3").status === "owned" && T_parent(s, "i3x") === "h3");
    check("final toast: 1 kept both, 1 updated, 1 skipped", /Same-title tabletop games: 1 kept both, 1 updated, 1 skipped$/.test(toast), toast);
    check("media items merged after the last answer", (await page.evaluate(() => JSON.parse(localStorage.getItem("media-tracker-v1")).items.some((i) => i.id === "newbook"))));
    check("no page errors (match prompt)", !errors.length, errors.join("|"));
    await ctx.close();
  }
  // Cancel mid-queue (close button and Escape): nothing written, toast
  for (const how of ["close", "escape", "backdrop"]) {
    const HERE = ["A", "B", "C"].map((t) => E({ id: `h${t}`, title: `Game ${t}`, subtype: "board" }));
    const INC = ["A", "B", "C"].map((t) => E({ id: `i${t}`, title: `Game ${t}`, subtype: "board", status: "want", dateUpdated: "2026-10-09T10:00:00.000Z" }));
    const { page, ctx } = await open(browser, { tt: HERE });
    const before = [await page.evaluate(() => localStorage.getItem("media-tracker-v1")), await page.evaluate(() => localStorage.getItem("media-tracker-v1:tabletop"))];
    await page.setInputFiles("#import-file", { name: "m.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "freerangemedia", version: 3, exportedAt: T0, items: [{ ...media.items[2], id: "zz" }], tabletop: { v: 1, entries: INC } })) });
    await page.click("#confirm-alt");
    await page.waitForSelector("#tt-match-modal:not([hidden])");
    await page.click("#tt-match-update");
    await page.click("#tt-match-skip");
    if (how === "close") await page.click("#tt-match-close");
    else if (how === "escape") await page.keyboard.press("Escape");
    else await page.mouse.click(5, 5);
    await page.waitForSelector("#tt-match-modal[hidden]", { state: "attached" });
    const after = [await page.evaluate(() => localStorage.getItem("media-tracker-v1")), await page.evaluate(() => localStorage.getItem("media-tracker-v1:tabletop"))];
    const toast = await page.textContent("#toast");
    check(`cancel mid-queue (${how}, after 2 answers): items and shelf unchanged, toast`, after[0] === before[0] && after[1] === before[1] && toast.trim() === "Merge cancelled. Nothing was changed.", toast);
    await ctx.close();
  }
  // One match shots + 30 matches with "Keep both for the rest"
  {
    const { page, ctx } = await open(browser, { tt: [E({ id: "h1", title: "Wingspan", subtype: "board", designer: "Elizabeth Hargrave", year: "2019", players: "1–5", playTime: "70" })] });
    await page.setInputFiles("#import-file", { name: "m.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "freerangemedia", version: 3, exportedAt: T0, items: [], tabletop: { v: 1, entries: [E({ id: "i1", title: "Wingspan", subtype: "board", bggId: "266192", designer: "Elizabeth Hargrave", year: "2019", players: "1–5", playTime: "70" })] } })) });
    await page.click("#confirm-alt");
    await page.waitForSelector("#tt-match-modal:not([hidden])");
    for (const w of [1440, 390, 320]) { await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 844 }); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab"); await vshot(page, `match-one-${w}`); }
    await page.click("#tt-match-close");
    await ctx.close();
  }
  {
    const HERE = Array.from({ length: 30 }, (_, i) => E({ id: `h${i}`, title: `Homebrew ${i}`, subtype: "card" }));
    const INC = HERE.map((e) => ({ ...e, id: e.id.replace("h", "i") }));
    const { page, ctx, errors } = await open(browser, { tt: HERE });
    await page.setInputFiles("#import-file", { name: "m.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "freerangemedia", version: 3, exportedAt: T0, items: [], tabletop: { v: 1, entries: INC } })) });
    await page.click("#confirm-alt");
    await page.waitForSelector("#tt-match-modal:not([hidden])");
    check("30 matches: '1 of 30'", (await page.textContent("#tt-match-progress")) === "1 of 30");
    check("2+ matches: 'N of M' visible", await page.isVisible("#tt-match-progress"));
    await page.click("#tt-match-skip");
    await page.click("#tt-match-rest");
    await page.waitForSelector("#tt-match-modal[hidden]", { state: "attached" });
    const toast = await page.textContent("#toast");
    check("30 matches: Skip then 'Keep both for the rest' = 29 kept, 1 skipped", (await ttStore(page)).length === 59 && /Same-title tabletop games: 29 kept both, 1 skipped$/.test(toast), toast);
    check("no page errors (30 matches)", !errors.length, errors.join("|"));
    await ctx.close();
  }

  // Race: another tab adds Azul (also in the backup) while the prompt is open -> Azul is asked too
  {
    const AZ = (id, o = {}) => E({ id, title: "Azul", subtype: "board", ...o });
    const INC = [E({ id: "iA", title: "Game A", subtype: "board" }), AZ("iAz", { status: "want" })];
    const { page, ctx, errors } = await open(browser, { tt: [E({ id: "hA", title: "Game A", subtype: "board" })] });
    await page.setInputFiles("#import-file", { name: "m.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "freerangemedia", version: 3, exportedAt: T0, items: [], tabletop: { v: 1, entries: INC } })) });
    await page.click("#confirm-alt");
    await page.waitForSelector("#tt-match-modal:not([hidden])");
    check("race: starts with 1 match (Game A)", /Game A/.test(await page.textContent("#tt-match-pair")) && (await page.isHidden("#tt-match-progress")));
    check("first-pass match: no 'another tab' note", await page.isHidden("#tt-match-late"));
    await page.evaluate((az) => { const k = "media-tracker-v1:tabletop"; const l = JSON.parse(localStorage.getItem(k)); l.push(az); localStorage.setItem(k, JSON.stringify(l)); }, AZ("hAz"));
    await page.click("#tt-match-keep");
    await page.waitForTimeout(150);
    const reopened = await page.isVisible("#tt-match-modal") && /Azul/.test(await page.textContent("#tt-match-pair"));
    check("race: Azul added mid-prompt is asked before anything is written, '2 of 2'", reopened && (await page.textContent("#tt-match-progress")) === "2 of 2" && !(await ttStore(page)).some((e) => e.id === "iA"));
    const late = await page.evaluate(() => { const n = document.getElementById("tt-match-late"); const u = getComputedStyle(n); const kids = [...document.getElementById("tt-match-panel").querySelectorAll("p, .tt-match-pair")]; return { vis: !n.hidden && n.offsetHeight > 0, text: n.textContent, fs: u.fontSize, color: u.color, before: kids.indexOf(n) < kids.indexOf(document.getElementById("tt-match-pair")) && kids.indexOf(n) >= 0, upd: (() => { const x = document.querySelector(".tt-match-updated"); return x ? getComputedStyle(x).color : u.color; })() }; });
    check("re-asked match: muted 13px note before the pair, same color as 'Updated'", late.vis && late.text === "This one was added to your shelf while you were answering." && late.fs === "13px" && late.color === late.upd && late.color === "rgb(92, 83, 72)" && late.before, JSON.stringify(late));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); for (const w of [375, 1440]) { await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 812 }); await page.waitForTimeout(150); await page.screenshot({ path: `${SHOTS}/azul-reask-late-note-${w}.png`, fullPage: false }); } await page.setViewportSize({ width: 390, height: 1400 }); }
    if (reopened) await page.click("#tt-match-skip");
    await page.waitForSelector("#tt-match-modal[hidden]", { state: "attached" });
    const st = await ttStore(page);
    const toast = (await page.textContent("#toast")).trim();
    check("race: Skip on Azul keeps one Azul (ours); toast from the result", st.filter((e) => e.title === "Azul").map((e) => e.id).join() === "hAz" && toast === "Merged — 1 added. Same-title tabletop games: 1 kept both, 1 skipped", toast);
    check("no page errors (race)", !errors.length, errors.join("|"));
    await ctx.close();
  }
  // Safety net: a match the prompt never asked defaults to Keep both, and the toast counts it
  {
    const { page, ctx, errors } = await open(browser, { tt: [E({ id: "hAz", title: "Azul", subtype: "board" })] });
    await page.evaluate(() => { window.FRMTabletop.previewHandMatches = () => []; }); // force: prompt never sees the match
    await page.setInputFiles("#import-file", { name: "m.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "freerangemedia", version: 3, exportedAt: T0, items: [], tabletop: { v: 1, entries: [E({ id: "iAz", title: "Azul", subtype: "board", status: "want" })] } })) });
    await page.click("#confirm-alt");
    await page.waitForTimeout(200);
    const st = await ttStore(page);
    const toast = (await page.textContent("#toast")).trim();
    check("safety net: unasked match keeps both copies", st.filter((e) => e.title === "Azul").length === 2 && (await page.isHidden("#tt-match-modal")));
    check("safety net: toast counts it as kept both (from the merge result)", toast === "Merged — 1 added. Same-title tabletop games: 1 kept both", toast);
    check("no page errors (safety net)", !errors.length, errors.join("|"));
    await ctx.close();
  }

  // Toast first clause: only non-zero parts
  {
    const { page, ctx } = await open(browser, { tt: [E({ id: "u1", title: "Azul", subtype: "board", bggId: "230802" }), E({ id: "u2", title: "Root", subtype: "board", bggId: "237182" })] });
    const later = "2026-10-09T10:00:00.000Z";
    await page.setInputFiles("#import-file", { name: "m.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "freerangemedia", version: 3, exportedAt: T0, items: [], tabletop: { v: 1, entries: [E({ id: "u1", title: "Azul", subtype: "board", bggId: "230802", status: "want", dateUpdated: later }), E({ id: "u2", title: "Root", subtype: "board", bggId: "237182", status: "want", dateUpdated: later })] } })) });
    await page.click("#confirm-alt"); await page.waitForTimeout(200);
    const t1 = (await page.textContent("#toast")).trim();
    check("toast: updates only -> 'Merged — 2 updated'", t1 === "Merged — 2 updated", t1);
    const books = ["x1", "x2", "x3"].map((id) => ({ ...media.items[2], id, title: `Book ${id}` }));
    await page.setInputFiles("#import-file", { name: "m2.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "freerangemedia", version: 3, exportedAt: T0, items: books })) });
    await page.click("#confirm-alt"); await page.waitForTimeout(200);
    const t2 = (await page.textContent("#toast")).trim();
    check("toast: media only -> 'Merged — 3 added'", t2 === "Merged — 3 added", t2);
    await page.setInputFiles("#import-file", { name: "m3.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "freerangemedia", version: 3, exportedAt: T0, items: books })) });
    await page.click("#confirm-alt"); await page.waitForTimeout(200);
    const t3 = (await page.textContent("#toast")).trim();
    check("toast: nothing new -> 'Merged — already up to date'", t3 === "Merged — already up to date", t3);
    console.log("      toasts: " + [t1, t2, t3].join(" | "));
    await ctx.close();
  }

  // No same-title matches: the toast has no second sentence
  {
    const { page, ctx } = await open(browser, { tt: [E({ id: "h1", title: "Azul", subtype: "board", bggId: "230802" })] });
    await page.setInputFiles("#import-file", { name: "m.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "freerangemedia", version: 3, exportedAt: T0, items: [], tabletop: { v: 1, entries: [E({ id: "i9", title: "Cascadia", subtype: "board" })] } })) });
    await page.click("#confirm-alt");
    await page.waitForTimeout(200);
    const toast = (await page.textContent("#toast")).trim();
    check("no matches: toast has no same-title sentence", toast === "Merged — 1 added" && (await page.isHidden("#tt-match-modal")), toast);
    await ctx.close();
  }

  // Games tab unchanged vs origin/main
  if (MAIN) {
    const out = [];
    for (const o of [MAIN, ORIGIN]) {
      const { page, ctx } = await open(browser, { origin: o });
      await tab(page, "game");
      out.push(await page.$eval("#item-list", (e) => e.innerHTML));
      await ctx.close();
    }
    check("Games tab markup identical to origin/main", out[0] === out[1]);
  }
  if (SHOT_DIR) {
    fs.writeFileSync(`${SHOT_DIR}/footer-check.json`, JSON.stringify(footerLog, null, 1));
    check("footer 'Board game data from BoardGameGeek' rendered on every shot's page", footerLog.every((x) => x.inDom && x.rendered), JSON.stringify(footerLog.filter((x) => !(x.inDom && x.rendered))));
  }
  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
