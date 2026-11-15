// V2.13: import-sheet choice contrast, cover-picker readability, No cover, and cover save.
// Real app in headless Chrome; the comic relay and image hosts are mocked (nothing leaves the box).
// SHOTS=<dir> also writes the 344 / 411 captures.
"use strict";
const { strict: assert } = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("/workspace/pw-tools/node_modules/playwright-core");
const T = require("../tabletop.js");

const root = path.join(__dirname, "..");
const SHOTS = process.env.SHOTS || "";
const RELAY = "https://frm-gcd.freerangeice.workers.dev";
const METRON = "https://static.metron.cloud/media/issue/2019/12/10/saga-1.jpg";
const GCD_IMG = "https://files1.comics.org/img/gcd/covers_by_id/fake.jpg";
const T0 = "2026-11-15T00:00:00.000Z";
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000300000004808020000003f11e17c0000005349444154789cedce410d00200c00b109430b86308d0b8e47930ae89cbdbe32f940484848a81e08090909d503212121a17a20242424540f84848484ea81909090503d10121212aa0742424242f5404848e8b10be8737462c27d9c870000000049454e44ae426082",
  "hex"
);

const COMICS = [
  { id: "c1", type: "comic", series: "Harbor Patrol", issue: "1", year: 2004, publisher: "Northwind Press", status: "owned", format: "physical", dateAdded: T0, dateUpdated: T0, coverUrl: "" },
  { id: "c2", type: "comic", series: "Copper Moth", issue: "2", year: 2011, publisher: "Bellweather Comics", status: "owned", format: "physical", dateAdded: T0, dateUpdated: T0, coverUrl: "" },
  { id: "c3", type: "comic", series: "Night Orchard", issue: "3", year: 2012, publisher: "Northwind Press", status: "owned", format: "physical", dateAdded: T0, dateUpdated: T0, coverUrl: "" },
];
const SHELF = { version: 1, savedAt: T0, items: COMICS };
const CLZ_CSV = `Series,Issue,Publisher,Release Date
Harbor Patrol,1,Northwind Press,Apr 2004
Copper Moth,2,Bellweather Comics,2011
Night Orchard,3,Northwind Press,2012
`;
const LOOKUP = {
  match: { series: "Harbor Patrol", issue: "1", title: "", publisher: "Northwind Press", year: 2004, writer: ["Ada Quill"], artist: [], sourceId: "gcd-issue-1001", sourceName: "Grand Comics Database", sourceUrl: "https://www.comics.org/issue/1001/" },
  variants: [
    { sourceId: "gcd-issue-1001", label: "Cover A", variant: false, image: METRON },
    { sourceId: "gcd-issue-1002", label: "Second Printing", variant: true, image: GCD_IMG },
    { sourceId: "gcd-issue-1003", label: "Incentive Cover", variant: true },
  ],
  covers: [
    { sourceId: "gcd-issue-1001", url: METRON, label: "Cover A", variant: false },
    { sourceId: "gcd-issue-1002", url: GCD_IMG, label: "Second Printing", variant: true },
  ],
  total: 3,
  imagesFrom: "metron",
};

const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

let passed = 0;
const check = (name, ok, detail = "") => {
  assert.ok(ok, `${name} ${detail}`);
  passed += 1;
  console.log("PASS", name);
};

function hexRgb(hex) {
  return String(hex).replace("#", "").match(/../g).map((h) => parseInt(h, 16));
}
function parseRgb(s) {
  const m = String(s).match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function contrast(fg, bg) {
  return T.contrastRatioRgb(parseRgb(fg) || fg, parseRgb(bg) || bg);
}

check("APP_VERSION 2.13 and cache media-shelf-v2.13", (() => {
  assert.match(app, /const APP_VERSION = "2\.13";/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.13";/);
  return true;
})() && true);

check("unselected import and cover choices are cream with a dark outline in CSS", /background:\s*#fffdf8/.test(css) && /\.clz-choice-btn\s*\{[^}]*border:\s*1px solid #5c5348/.test(css) && /\.comic-cover\s*\{[^}]*background:\s*#fffdf8/.test(css) && /\.comic-cover\s*\{[^}]*color:\s*#1a1a1a/.test(css));

check("selected import choice is #8B5E3C on white; selected cover uses a #8B5E3C outline", /\.clz-choice-btn\.is-selected[\s\S]{0,180}background:\s*#8B5E3C/.test(css) && /\.clz-choice-btn\.is-selected[\s\S]{0,180}color:\s*#ffffff/.test(css) && /\.comic-cover\.is-selected[\s\S]{0,160}border-color:\s*#8B5E3C/.test(css));

const typo = contrast(hexRgb("#1a1a1a"), hexRgb("#fffdf8"));
const typoHover = contrast(hexRgb("#1a1a1a"), hexRgb("#f7f7f7"));
const selected = contrast(hexRgb("#ffffff"), hexRgb("#8B5E3C"));
check("computed contrast: #1a1a1a on #fffdf8 and #f7f7f7 is ≥ 4.5:1; white on #8B5E3C is ≥ 4.5:1", typo >= 4.5 && typoHover >= 4.5 && selected >= 4.5, `cream ${typo.toFixed(2)} hover ${typoHover.toFixed(2)} selected ${selected.toFixed(2)}`);
console.log(`RATIO cream #1a1a1a on #fffdf8 = ${typo.toFixed(2)}:1`);
console.log(`RATIO hover #1a1a1a on #f7f7f7 = ${typoHover.toFixed(2)}:1`);
console.log(`RATIO selected #ffffff on #8B5E3C = ${selected.toFixed(2)}:1`);

check("picker thumbnails only use comicCoverUrl (Metron / fixture); GCD hosts are never requested", app.includes("function comicPickerImageUrl(u, fixture) {\n    return comicCoverUrl(u, fixture);\n  }"));
check("comicCoverUrl drops files1.comics.org and keeps static.metron.cloud", /files1\.comics\.org is\s+dropped|files1\.comics\.org included/.test(app) && /static\.metron\.cloud/.test(app) && /COMIC_IMAGE_HOST_RE = \/\^files\\d\*\\.comics\\.org\$/i.test(app));
check("service worker still never handles comics.org or Metron (no proxy, no image cache)", /NEVER_HANDLE_HOSTS = \/\(\^\\|\\.\)comics\\.org\$/i.test(sw) && /IMAGE_HOSTS = \/\^static\\.metron\\.cloud/i.test(sw) && /media-shelf-v2\.13/.test(sw));
check("No cover sits under the tile list, before the paste-URL field", (() => {
  const list = html.indexOf('id="comic-cover-list"');
  const none = html.indexOf('id="btn-comic-no-cover"');
  const paste = html.indexOf('id="field-comic-cover-url"');
  return list >= 0 && none > list && paste > none;
})());
check("cover list is click-only (no touchend selection workaround)", !/comicCoverList\.addEventListener\("touchend"/.test(app) && /comicCoverList\.addEventListener\("click"/.test(app));
check("thumbs are 48×72 with a same-size placeholder", /\.comic-cover-thumb\s*\{[^}]*width:\s*48px/.test(css) && /\.comic-cover-thumb\s*\{[^}]*height:\s*72px/.test(css) && /\.comic-cover-blank\s*\{[^}]*width:\s*48px/.test(css) && /\.comic-cover-blank\s*\{[^}]*height:\s*72px/.test(css));
check("empty cover-list placeholders are a plain dashed frame with no words", app.includes('return `<span class="comic-cover-thumb comic-cover-blank" aria-hidden="true"></span>`;') && !/comicBlankTileArt[\s\S]{0,400}"No cover"/.test(app));
check("saved library covers fill the card with object-fit: cover (even a low-res thumb)", /V2\.13b/.test(css) && /\.item-card \.item-cover-fit \.item-cover[\s\S]{0,280}width:\s*100%\s*!important/.test(css) && /\.item-card \.item-cover-fit \.item-cover[\s\S]{0,400}object-fit:\s*cover\s*!important/.test(css));
check("No cover uses the same 8px radius as the cover tiles", /\.comic-no-cover[\s\S]{0,500}border-radius:\s*var\(--radius-sm\)/.test(css) && /\.comic-cover\s*\{[^}]*border-radius:\s*var\(--radius-sm\)/.test(css));

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

async function openPage(browser, base, width, { track = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await ctx.addInitScript((shelf) => {
    if (sessionStorage.getItem("t")) return;
    sessionStorage.setItem("t", "1");
    localStorage.clear();
    localStorage.setItem("media-shelf-seeded", "2026-01-01T00:00:00Z");
    localStorage.setItem("media-shelf-last-backup", new Date().toISOString());
    localStorage.setItem("media-tracker-v1", JSON.stringify(shelf));
  }, SHELF);
  const calls = [];
  const writes = [];
  await ctx.route("**/*", async (r) => {
    const req = r.request(), u = new URL(req.url());
    if (u.origin === base) return r.continue();
    if (!["GET", "HEAD"].includes(req.method())) { writes.push(req.url()); return r.abort(); }
    const hdr = { "Access-Control-Allow-Origin": "*" };
    if (u.origin === RELAY && u.pathname === "/comic") {
      calls.push("relay:" + u.search);
      return r.fulfill({ contentType: "application/json", headers: hdr, body: JSON.stringify(LOOKUP) });
    }
    if (u.hostname === "static.metron.cloud") {
      calls.push("metron");
      return r.fulfill({ contentType: "image/png", headers: hdr, body: PNG });
    }
    if (/(^|\.)comics\.org$/i.test(u.hostname)) {
      calls.push("gcd-host:" + u.hostname + u.pathname);
      return r.abort();
    }
    calls.push("blocked:" + u.hostname);
    return r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/");
  await page.waitForSelector("#stats");
  if (track) track.calls = calls;
  return { ctx, page, calls, writes, errors };
}

async function shot(page, name, locator) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  if (locator) {
    await locator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(120);
  }
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
}

function styleOf() {
  return (sel, picked) => {
    const e = typeof sel === "string" ? document.querySelector(sel) : sel;
    if (!e) return null;
    const c = getComputedStyle(e);
    const b = e.getBoundingClientRect();
    return { text: (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim(), bg: c.backgroundColor, color: c.color, border: c.borderTopColor, h: b.height, w: b.width, selected: e.classList.contains("is-selected"), pressed: e.getAttribute("aria-pressed"), fw: c.fontWeight };
  };
}

(async () => {
  const { server, base } = await startServer();
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const ratios = [];
  try {
    for (const width of [344, 411]) {
      // ----- Import duplicate choices -----
      {
        const { ctx, page, errors } = await openPage(browser, base, width);
        await page.click('[data-nav="profile"]');
        await page.waitForSelector('#frm-profile:not([hidden]) [data-profile-action="settings"]');
        await page.click('[data-profile-action="settings"]');
        await page.waitForSelector("#settings-modal:not([hidden])");
        await page.selectOption("#clz-type", "comics");
        await page.locator("#clz-file").setInputFiles({ name: "dupes.csv", mimeType: "text/csv", buffer: Buffer.from(CLZ_CSV) });
        const apply = page.locator("#btn-clz-mapping-apply");
        if (await page.locator("#clz-mapping:not([hidden])").count()) {
          await apply.click();
        }
        await page.waitForSelector("#clz-dups:not([hidden]) .clz-choice-btn");
        const rows = page.locator("#clz-dup-rows > li.has-choice");
        check(`${width}: three duplicate rows`, (await rows.count()) >= 3, String(await rows.count()));
        await rows.nth(0).locator('.clz-choice-btn[data-choice="update"]').click();
        await rows.nth(1).locator('.clz-choice-btn[data-choice="add"]').click();
        await rows.nth(2).locator('.clz-choice-btn[data-choice="skip"]').click();
        const measured = await page.evaluate(() => {
          const rgb = (el) => {
            const c = getComputedStyle(el);
            return { text: el.textContent.trim(), bg: c.backgroundColor, color: c.color, border: c.borderTopColor, h: el.getBoundingClientRect().height, selected: el.classList.contains("is-selected") };
          };
          const rows = [...document.querySelectorAll("#clz-dup-rows > li.has-choice")].slice(0, 3);
          const of = (row, choice) => rgb(row.querySelector(`.clz-choice-btn[data-choice="${choice}"]`));
          const sel = rows.map((row, i) => of(row, ["update", "add", "skip"][i]));
          const unsel = rows.flatMap((row, i) => {
            const skip = ["update", "add", "skip"][i];
            return [...row.querySelectorAll(".clz-choice-btn")].filter((b) => b.dataset.choice !== skip).map(rgb);
          });
          const drop = document.getElementById("clz-dup-mode");
          const dc = getComputedStyle(drop);
          return { sel, unsel, drop: { bg: dc.backgroundColor, color: dc.color, border: dc.borderTopColor, h: drop.getBoundingClientRect().height, text: drop.options[drop.selectedIndex].text } };
        });
        for (const b of measured.unsel) {
          const r = contrast(b.color, b.bg);
          ratios.push([`${width} unselected ${b.text}`, r, b]);
          check(`${width}: unselected "${b.text}" contrast ≥ 4.5:1`, r >= 4.5 && b.bg === "rgb(255, 253, 248)" && b.color === "rgb(26, 26, 26)" && b.h >= 44, `${r.toFixed(2)} ${JSON.stringify(b)}`);
        }
        for (const b of measured.sel) {
          const r = contrast(b.color, b.bg);
          ratios.push([`${width} selected ${b.text}`, r, b]);
          check(`${width}: selected "${b.text}" is #8B5E3C on white, contrast ≥ 4.5:1`, b.selected && b.bg === "rgb(139, 94, 60)" && b.color === "rgb(255, 255, 255)" && r >= 4.5 && b.h >= 44, `${r.toFixed(2)} ${JSON.stringify(b)}`);
        }
        const dr = contrast(measured.drop.color, measured.drop.bg);
        ratios.push([`${width} duplicates dropdown`, dr, measured.drop]);
        check(`${width}: Duplicates dropdown is cream with dark text, contrast ≥ 4.5:1`, dr >= 4.5 && measured.drop.bg === "rgb(255, 253, 248)" && measured.drop.color === "rgb(26, 26, 26)", `${dr.toFixed(2)} ${JSON.stringify(measured.drop)}`);
        await page.locator("#clz-dups").scrollIntoViewIfNeeded();
        if (!/v2\.13b\/?$/.test(SHOTS.replace(/\\/g, "/"))) {
          await shot(page, `import-dups-${width}.png`, page.locator("#clz-dups"));
          await shot(page, `import-dups-dropdown-closed-${width}.png`, page.locator("#clz-dup-mode"));
          await page.locator("#clz-dup-mode").evaluate((el) => { el.size = el.options.length; el.focus(); });
          await shot(page, `import-dups-dropdown-open-${width}.png`, page.locator("#clz-dup-default, .clz-dup-default"));
          await page.locator("#clz-dup-mode").evaluate((el) => { el.size = 1; });
        }
        check(`${width}: import sheet has no page errors`, errors.length === 0, errors.join(" | "));
        await ctx.close();
      }

      // ----- Cover sheet + library card -----
      {
        const track = {};
        const { ctx, page, calls, errors } = await openPage(browser, base, width, { track });
        await page.click('.item-card[data-id="c1"]');
        await page.waitForSelector("#item-detail-edit");
        await page.click("#item-detail-edit");
        await page.waitForSelector("#modal:not([hidden]) #btn-lookup");
        await page.click("#btn-lookup");
        await page.waitForSelector("#comic-picker:not([hidden]) [data-comic-cover]");
        const tiles = page.locator("[data-comic-cover]");
        check(`${width}: three cover tiles`, (await tiles.count()) === 3, String(await tiles.count()));
        const before = await page.evaluate(() => {
          const save = document.getElementById("btn-save");
          const why = document.getElementById("save-blocked");
          const none = document.getElementById("btn-comic-no-cover");
          const list = [...document.querySelectorAll("[data-comic-cover]")].map((b) => {
            const img = b.querySelector("img.comic-cover-thumb");
            const blank = b.querySelector(".comic-cover-blank");
            const r = (el) => el ? el.getBoundingClientRect() : null;
            const imgR = r(img), blankR = r(blank);
            return {
              label: b.querySelector(".comic-cover-label").textContent.trim(),
              selected: b.classList.contains("is-selected"),
              src: img ? img.getAttribute("src") : "",
              referrerpolicy: img ? img.getAttribute("referrerpolicy") : "",
              hasImg: Boolean(img),
              hasBlank: Boolean(blank),
              blankText: blank ? (blank.textContent || "").trim() : "",
              thumb: imgR ? { w: Math.round(imgR.width), h: Math.round(imgR.height) } : blankR ? { w: Math.round(blankR.width), h: Math.round(blankR.height) } : null,
              bg: getComputedStyle(b).backgroundColor,
              color: getComputedStyle(b).color,
              border: getComputedStyle(b).borderTopColor,
              radius: getComputedStyle(b).borderRadius,
              padding: getComputedStyle(b).padding,
            };
          });
          const nc = getComputedStyle(none);
          return {
            saveDisabled: save.getAttribute("aria-disabled") === "true",
            blocked: why && !why.hidden ? (why.textContent || "") : "",
            noCover: { text: none.innerText.replace(/\s+/g, " ").trim(), visible: !!(none.offsetWidth && none.offsetHeight), pressed: none.getAttribute("aria-pressed"), bg: nc.backgroundColor, color: nc.color, border: nc.borderTopColor, h: none.getBoundingClientRect().height, radius: nc.borderRadius, padding: nc.padding },
            tileChrome: (() => { const b = document.querySelector("[data-comic-cover]"); const c = getComputedStyle(b); return { radius: c.borderRadius, padding: c.padding, border: c.borderTopColor, borderWidth: c.borderTopWidth }; })(),
            list,
            fieldCover: document.getElementById("field-cover").value,
            sources: [...document.querySelectorAll("#comic-picker img")].map((i) => i.getAttribute("src")),
          };
        });
        check(`${width}: Save starts disabled until a cover or No cover is chosen`, before.saveDisabled === true, JSON.stringify({ d: before.saveDisabled, blocked: before.blocked }));
        check(`${width}: No cover is visible under the tiles`, before.noCover.visible && /No cover/.test(before.noCover.text) && before.noCover.h >= 44, JSON.stringify(before.noCover));
        const coverA = before.list.find((t) => t.label === "Cover A");
        const second = before.list.find((t) => t.label === "Second Printing");
        const incentive = before.list.find((t) => t.label === "Incentive Cover");
        check(`${width}: Cover A shows the Metron thumb at 48×72 with no-referrer`, coverA && coverA.hasImg && coverA.src === METRON && coverA.referrerpolicy === "no-referrer" && coverA.thumb.w === 48 && coverA.thumb.h === 72, JSON.stringify(coverA));
        check(`${width}: Second Printing (GCD image URL in the mock relay) uses the 48×72 placeholder, not files1`, second && !second.hasImg && second.hasBlank && second.src === "" && second.thumb.w === 48 && second.thumb.h === 72, JSON.stringify(second));
        check(`${width}: empty placeholders are a plain dashed frame with no words`, second && second.blankText === "" && incentive && incentive.blankText === "", JSON.stringify({ second: second && second.blankText, incentive: incentive && incentive.blankText }));
        check(`${width}: Incentive Cover (no image in the relay) uses the 48×72 placeholder`, incentive && !incentive.hasImg && incentive.hasBlank && incentive.thumb.w === 48 && incentive.thumb.h === 72, JSON.stringify(incentive));
        check(`${width}: No cover matches the tiles' radius, padding and border`, before.noCover.radius === before.tileChrome.radius && before.noCover.padding === before.tileChrome.padding && before.noCover.border === before.tileChrome.border, JSON.stringify({ noCover: before.noCover, tile: before.tileChrome }));
        check(`${width}: no files1.comics.org URL is put in an img`, before.sources.every((s) => !/comics\.org/i.test(s || "")), JSON.stringify(before.sources));
        for (const t of before.list) {
          const r = contrast(t.color, t.bg);
          ratios.push([`${width} tile ${t.label}`, r, t]);
          check(`${width}: tile "${t.label}" cream/dark text contrast ≥ 4.5:1`, r >= 4.5 && t.bg === "rgb(255, 253, 248)" && t.color === "rgb(26, 26, 26)", `${r.toFixed(2)} ${JSON.stringify(t)}`);
        }
        const ncr = contrast(before.noCover.color, before.noCover.bg);
        ratios.push([`${width} No cover`, ncr, before.noCover]);
        check(`${width}: No cover cream/dark text contrast ≥ 4.5:1`, ncr >= 4.5 && before.noCover.bg === "rgb(255, 253, 248)" && before.noCover.color === "rgb(26, 26, 26)", `${ncr.toFixed(2)}`);

        // Regression: tapping a tile selects it and enables Save.
        await page.locator('[data-comic-cover="0"]').click();
        const picked = await page.evaluate(() => {
          const b = document.querySelector('[data-comic-cover="0"]');
          const c = getComputedStyle(b);
          return {
            selected: b.classList.contains("is-selected") && b.getAttribute("aria-pressed") === "true",
            saveDisabled: document.getElementById("btn-save").getAttribute("aria-disabled") === "true",
            cover: document.getElementById("field-cover").value,
            label: document.getElementById("field-cover-label").value,
            border: c.borderTopColor,
            bg: c.backgroundColor,
            color: c.color,
            check: getComputedStyle(b, "::after").content,
          };
        });
        check(`${width}: tapping Cover A selects it, enables Save, and stores the Metron URL`, picked.selected && picked.saveDisabled === false && picked.cover === METRON && picked.label === "Cover A" && picked.border === "rgb(139, 94, 60)", JSON.stringify(picked));
        await page.locator("#comic-picker").scrollIntoViewIfNeeded();
        await shot(page, `cover-selected-${width}.png`, page.locator("#comic-picker"));

        // A names-only tile (GCD-only / no Metron URL) does not write a comics.org cover URL.
        await page.locator('[data-comic-cover="1"]').click();
        const secondPick = await page.evaluate(() => ({
          selected: document.querySelector('[data-comic-cover="1"]').classList.contains("is-selected"),
          saveDisabled: document.getElementById("btn-save").getAttribute("aria-disabled") === "true",
          cover: document.getElementById("field-cover").value,
          label: document.getElementById("field-cover-label").value,
        }));
        check(`${width}: picking Second Printing enables Save but does not store the GCD image URL`, secondPick.selected && secondPick.saveDisabled === false && secondPick.cover === "" && secondPick.label === "Second Printing", JSON.stringify(secondPick));

        // No cover is selectable and enables Save.
        await page.click("#btn-comic-no-cover");
        const none = await page.evaluate(() => {
          const b = document.getElementById("btn-comic-no-cover");
          const c = getComputedStyle(b);
          const tile = document.querySelector("[data-comic-cover]");
          const tc = getComputedStyle(tile);
          const after = (el) => { const s = getComputedStyle(el, "::after"); return { content: s.content, width: s.width, height: s.height, background: s.backgroundColor }; };
          return {
            selected: b.classList.contains("is-selected") && b.getAttribute("aria-pressed") === "true",
            saveDisabled: document.getElementById("btn-save").getAttribute("aria-disabled") === "true",
            cover: document.getElementById("field-cover").value,
            border: c.borderTopColor,
            radius: c.borderRadius,
            padding: c.padding,
            tileRadius: tc.borderRadius,
            tilePadding: tc.padding,
            check: after(b),
            tileCheck: after(tile),
            tileSelected: [...document.querySelectorAll("[data-comic-cover]")].some((t) => t.classList.contains("is-selected")),
          };
        });
        check(`${width}: No cover selects, enables Save, and clears the cover field`, none.selected && none.saveDisabled === false && none.cover === "" && none.border === "rgb(139, 94, 60)" && none.tileSelected === false, JSON.stringify(none));
        check(`${width}: selected No cover uses the same radius, padding and check as the tiles`, none.radius === none.tileRadius && none.padding === none.tilePadding && none.check.width === "22px" && none.check.height === "22px" && none.check.content.includes("✓") && none.check.background === "rgb(139, 94, 60)", JSON.stringify(none));
        await page.locator("#comic-picker").scrollIntoViewIfNeeded();
        await shot(page, `cover-no-cover-${width}.png`, page.locator("#comic-picker"));

        // Save Cover A and confirm the library card shows the Metron picture (not a grey placeholder).
        await page.locator('[data-comic-cover="0"]').click();
        await page.click("#btn-save");
        await page.waitForFunction(() => /Updated/.test((document.querySelector(".toast") || {}).textContent || ""));
        const toast = await page.evaluate(() => (document.querySelector(".toast") || {}).textContent || "");
        check(`${width}: toast says Updated after saving Cover A`, /Updated/.test(toast), toast);
        await page.waitForSelector('.item-card[data-id="c1"] img.item-cover');
        const card = await page.evaluate((metron) => {
          const card = document.querySelector('.item-card[data-id="c1"]');
          const img = card.querySelector("img.item-cover");
          const ph = card.querySelector(".item-cover-placeholder");
          const stored = JSON.parse(localStorage.getItem("media-tracker-v1") || "{}");
          const item = (stored.items || []).find((i) => i.id === "c1") || {};
          const col = card.querySelector(".item-cover-col");
          const cr = col ? col.getBoundingClientRect() : { width: 0, height: 0 };
          const ir = img ? img.getBoundingClientRect() : { width: 0, height: 0 };
          const ic = img ? getComputedStyle(img) : {};
          return {
            src: img ? img.getAttribute("src") : "",
            imgHidden: img ? (img.hidden || getComputedStyle(img).display === "none") : true,
            phHidden: ph ? ph.hidden : true,
            coverUrl: item.coverUrl || "",
            coverLabel: item.coverLabel || "",
            fit: ic.objectFit || "",
            col: { w: Math.round(cr.width), h: Math.round(cr.height) },
            img: { w: Math.round(ir.width), h: Math.round(ir.height) },
          };
        }, METRON);
        check(`${width}: library card shows the saved Metron cover (not the grey placeholder)`, card.src === METRON && card.coverUrl === METRON && card.coverLabel === "Cover A" && card.imgHidden === false, JSON.stringify(card));
        check(`${width}: saved cover fills the card at object-fit cover (not a floating thumb)`, card.fit === "cover" && Math.abs(card.img.w - card.col.w) <= 1 && Math.abs(card.img.h - card.col.h) <= 1 && card.col.w > 80 && card.col.h > 80, JSON.stringify(card));
        check(`${width}: stored cover is not a comics.org URL`, !/comics\.org/i.test(card.coverUrl));
        await page.locator('.item-card[data-id="c1"]').scrollIntoViewIfNeeded();
        await shot(page, `library-card-cover-${width}.png`, page.locator('.item-card[data-id="c1"]'));
        check(`${width}: no request was made to comics.org or files1.comics.org`, !calls.some((c) => String(c).startsWith("gcd-host:")), JSON.stringify(calls));
        check(`${width}: cover sheet has no page errors`, errors.length === 0, errors.join(" | "));
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const lines = ratios.map(([name, r]) => `${name}: ${Number(r).toFixed(2)}:1`);
    fs.writeFileSync(path.join(SHOTS, "contrast-ratios.txt"), lines.join("\n") + "\n");
  }
  console.log(`OK ${passed} checks`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
