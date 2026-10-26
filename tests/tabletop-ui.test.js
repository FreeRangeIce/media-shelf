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
async function shot(page, name) { if (!SHOTS) return; await page.waitForTimeout(150); const modal = await page.$(".modal:not([hidden])"); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: !modal }); }
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
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

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
    for (const w of [1440, 390, 320]) { await page.setViewportSize({ width: w, height: 1000 }); await shot(page, `empty-${w}`); }
    check("no page errors (empty)", !errors.length, errors.join("|"));
    await ctx.close();
  }

  // Add: default Owned, lookup not connected (no network), expansion missing parent, parent later
  {
    const { page, ctx, errors, requests } = await open(browser);
    await tab(page, "tabletop");
    await page.click("#tt-empty-add");
    check("new entry form defaults to Owned", (await page.inputValue("#tt-status")) === "owned");
    const before = requests.length;
    await page.click("#tt-lookup");
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
    for (const w of [1440, 390, 320]) {
      await page.setViewportSize({ width: w, height: 1000 });
      const ov = await page.evaluate(() => document.documentElement.scrollWidth);
      check(`shelf at ${w}: no sideways page scroll`, ov === w, String(ov));
      await shot(page, `shelf-grouped-${w}`);
      await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 844 });
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
    check("restore (0 items, 3 games): prompt names both counts", /This browser has 0 items and 3 games\./.test(desc), desc);
    check("restore (0 items, 3 games): Replace warns", (await page.textContent("#confirm-ok")).trim() === "Replace" && /Replace swaps everything here for the backup and can’t be undone/.test(desc), desc);
    await page.click("#confirm-alt"); // Merge
    let s = await ttStore(page);
    const toast = await page.textContent("#toast");
    check("merge kept all 3 games and kept both hand-entered copies", s.length === 4 && ["tt-a", "tt-b", "tt-c", "tt-x"].every((id) => s.some((e) => e.id === id)), s.map((e) => e.id).join(","));
    check("merge toast names the hand-entered match", /Kept both copies of a hand-entered game you already had: Homebrew Quest/.test(toast), toast);
    await page.setInputFiles("#import-file", { name: "b2.json", mimeType: "application/json", buffer: bk(2) });
    await page.click("#confirm-ok"); // Replace
    const t2 = await page.textContent("#toast");
    check("restore toast counts items and games", /^Restored 1 item and 1 game$/.test(t2.trim()), t2);
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
  await browser.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
