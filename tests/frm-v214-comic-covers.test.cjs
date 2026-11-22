// V2.14: Metron fallback/UPC is on the relay; the app adds Open Library trade covers,
// a Take a photo tile in the cover picker, and a review-worker override.
"use strict";
const { strict: assert } = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { chromium } = require("/workspace/pw-tools/node_modules/playwright-core");

const root = path.join(__dirname, "..");
const SHOTS = process.env.SHOTS || "";
const RELAY = "https://frm-gcd.freerangeice.workers.dev";
const REVIEW_RELAY = "https://frm-gcd-review.freerangeice.workers.dev";
const METRON = "https://static.metron.cloud/media/issue/2019/12/10/saga-1.jpg";
const ISBN = "9781632159038"; // Saga Volume 1 (trade) — used only as an ISBN string in fixtures
const OL = `https://covers.openlibrary.org/b/isbn/${ISBN}-M.jpg?default=false`;
const T0 = "2026-11-15T00:00:00.000Z";
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function rgbPng(w, h, r, g, b) {
  const raw = Buffer.alloc((1 + w * 3) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const o = row + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const chunk = (tag, data) => {
    const crc = zlib.crc32(Buffer.concat([tag, data]));
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    tag.copy(out, 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc, 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk(Buffer.from("IHDR"), ihdr),
    chunk(Buffer.from("IDAT"), zlib.deflateSync(raw)),
    chunk(Buffer.from("IEND"), Buffer.alloc(0)),
  ]);
}
const PHOTO_PNG = rgbPng(800, 1200, 0x8b, 0x5e, 0x3c);
const OL_PNG = rgbPng(200, 300, 0x2e, 0x5a, 0x88);
const METRON_PNG = rgbPng(48, 72, 0xb5, 0x4a, 0x3c);

let passed = 0;
const check = (name, ok, detail = "") => {
  assert.ok(ok, `${name} ${detail}`);
  passed += 1;
  console.log("PASS", name);
};

check("APP_VERSION 2.16.1 and cache media-shelf-v2.16.1", /const APP_VERSION = "2\.16.1";/.test(app) && /const CACHE = "media-shelf-v2\.16.1";/.test(sw));
check("production relay stays frm-gcd; review host or ?comicRelay=review uses the review worker",
  /const COMIC_RELAY_URL = "https:\/\/frm-gcd\.freerangeice\.workers\.dev"/.test(app) &&
  app.includes('COMIC_REVIEW_RELAY_URL = "https://frm-gcd-review.freerangeice.workers.dev"') &&
  app.includes('function comicRelayUrl()') &&
  app.includes('q === "review"') &&
  /media-shelf-review\\.pages\\.dev/.test(app) &&
  /frm-gcd-review/.test(sw));
check("Take a photo is in the cover picker: file input, accept=image/*, capture=environment",
  html.includes('id="btn-comic-take-photo"') &&
  html.includes('id="comic-take-photo-input"') &&
  /id="comic-take-photo-input"[^>]*accept="image\/\*"[^>]*capture="environment"/.test(html) &&
  html.indexOf('id="btn-comic-take-photo"') > html.indexOf('id="btn-comic-no-cover"') &&
  html.indexOf('id="btn-comic-take-photo"') < html.indexOf('id="field-comic-cover-url"'));
check("Take a photo matches the No cover tile layout (48×72 frame, label to the right, same radius, border and padding, ≥44px target)",
  /\.comic-take-photo\s*\{[^}]*min-height:\s*76px/.test(css) &&
  /\.comic-take-photo\s*\{[^}]*padding:\s*2px var\(--space-3\) 2px 2px/.test(css) &&
  /\.comic-take-photo\s*\{[^}]*border:\s*1px solid #5c5348/.test(css) &&
  /\.comic-take-photo\s*\{[^}]*border-radius:\s*var\(--radius-sm\)/.test(css) &&
  /\.comic-take-photo\s*\{[^}]*background:\s*#fffdf8/.test(css) &&
  /\.comic-no-cover[\s\S]{0,400}min-height:\s*76px/.test(css) &&
  /\.comic-no-cover[\s\S]{0,400}padding:\s*2px var\(--space-3\) 2px 2px/.test(css) &&
  /\.comic-no-cover[\s\S]{0,800}border-radius:\s*var\(--radius-sm\)/.test(css) &&
  /\.item-form label\.comic-take-photo/.test(css) &&
  /label\.comic-take-photo,\s*\n\.comic-take-photo\s*\{[\s\S]{0,200}flex-direction:\s*row/.test(css));
check("Take a photo has a decorative camera glyph in the 48×72 frame; the label stays the accessible name",
  /id="btn-comic-take-photo"[\s\S]{0,600}comic-cover-thumb comic-cover-blank" aria-hidden="true"/.test(html) &&
  /comic-cover-blank" aria-hidden="true">\s*<svg class="comic-take-photo-icon"[\s\S]{0,400}aria-hidden="true"/.test(html) &&
  /<span class="comic-cover-label">Take a photo<\/span>/.test(html) &&
  !/<svg[^>]*aria-label=/.test(html.match(/comic-take-photo-icon[\s\S]{0,800}/)[0]));
check("library footer padding-bottom is the nav height plus the safe area (--frm-nav-h), so credits clear the nav",
  /--frm-nav-h:\s*calc\(64px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(css) &&
  /\.site-footer\s*\{\s*padding-bottom:\s*var\(--frm-nav-h\);/.test(css));
check("photos are downscaled to a 600px long edge as JPEG at quality 0.8",
  /COVER_PHOTO_MAX_EDGE = 600/.test(app) && /COVER_PHOTO_QUALITY = 0\.8/.test(app) &&
  /toDataURL\("image\/jpeg", COVER_PHOTO_QUALITY\)/.test(app));
check("Open Library trade covers use covers.openlibrary.org /b/isbn/…-M.jpg?default=false",
  app.includes("function openLibraryIsbnCoverUrl") &&
  app.includes('covers.openlibrary.org/b/isbn/') &&
  app.includes("?default=false") &&
  app.includes('key: "openlibrary"') &&
  /covers\\.openlibrary\\.org/.test(sw));
check("Covers from Open Library credit is in the footer and Settings; Metron CC BY-SA stays in the credits",
  html.includes('id="footer-openlibrary-credit"') &&
  html.includes('id="openlibrary-cover-credit"') &&
  /Covers from[\s\S]{0,80}Open Library/.test(app) &&
  /Cover pictures found through[\s\S]{0,200}Metron[\s\S]{0,200}CC BY-SA 4\.0/.test(app) &&
  html.includes('id="footer-comic-credit"') &&
  html.includes('id="comic-lookup-credit"'));
check("the app can pass a UPC to /comic and uses the relay barcode route",
  /query\.upc = q\.barcode/.test(app) && /barcodeRoute:\s*true/.test(app) &&
  /path: "\/comic-barcode"/.test(app));
check("GCD image hosts are still never requested or stored",
  /COMIC_IMAGE_HOST_RE = \/\^files\\d\*\\.comics\\.org\$/i.test(app) &&
  /NEVER_HANDLE_HOSTS = \/\(\^\\|\\.\)comics\\.org\$/i.test(sw));

function startServer() {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
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

const SHELF = {
  version: 1,
  items: [{
    id: "c-harbor", type: "comic", title: "", series: "Harbor Patrol", issue: "1",
    status: "owned", barcode: "", coverUrl: "", coverSource: "", dateAdded: T0, dateUpdated: T0,
  }],
};

const TRADE = {
  version: 1,
  items: [{
    id: "c-saga-vol1", type: "comic", title: "Saga Volume 1", series: "Saga", issue: "1",
    status: "owned", edition: "collected", comicFormat: "Trade Paperback",
    barcode: ISBN, coverUrl: "", coverSource: "", dateAdded: T0, dateUpdated: T0,
  }],
};

async function openPage(browser, base, width, { shelf, pathSuffix = "", extraRoutes } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 1200 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await ctx.addInitScript((data) => {
    if (sessionStorage.getItem("t")) return;
    sessionStorage.setItem("t", "1");
    localStorage.clear();
    localStorage.setItem("media-shelf-seeded", "2026-01-01T00:00:00Z");
    localStorage.setItem("media-shelf-last-backup", new Date().toISOString());
    localStorage.setItem("media-tracker-v1", JSON.stringify(data));
  }, shelf);
  const calls = [];
  await ctx.route("**/*", async (r) => {
    const req = r.request(), u = new URL(req.url());
    if (u.origin === base) return r.continue();
    if (extraRoutes) {
      const hit = await extraRoutes(r, u, req);
      if (hit) return;
    }
    if (u.hostname === "covers.openlibrary.org") {
      return r.fulfill({ status: 200, contentType: "image/png", body: OL_PNG });
    }
    if (u.hostname === "static.metron.cloud") {
      return r.fulfill({ status: 200, contentType: "image/png", body: METRON_PNG });
    }
    if (u.hostname === "frm-gcd.freerangeice.workers.dev" || u.hostname === "frm-gcd-review.freerangeice.workers.dev") {
      calls.push({ host: u.hostname, path: u.pathname, query: Object.fromEntries(u.searchParams) });
      const series = u.searchParams.get("series") || "Saga";
      const issue = u.searchParams.get("issue") || "1";
      const body = {
        match: { series, issue, title: "", publisher: "Image Comics Inc.", year: 2012, writer: ["Brian K. Vaughan"], artist: ["Fiona Staples"], sourceId: "gcd-issue-911609", sourceName: "Grand Comics Database", sourceUrl: "https://www.comics.org/issue/911609/" },
        candidates: [],
        covers: [{ sourceId: "gcd-issue-911609", url: METRON, label: "Cover A", variant: false }],
        variants: [{ sourceId: "gcd-issue-911609", label: "Cover A", variant: false, image: METRON }],
        total: 1,
        imagesFrom: "metron",
      };
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    }
    if ((/^files\d*\.comics\.org$/i).test(u.hostname) || /(^|\.)comics\.org$/.test(u.hostname)) {
      calls.push({ host: u.hostname, path: u.pathname, blocked: true });
      return r.fulfill({ status: 403, body: "no" });
    }
    return r.fulfill({ status: 404, body: "" });
  });
  const page = await ctx.newPage();
  await page.goto(base + "/" + pathSuffix, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(200);
  return { ctx, page, calls };
}

(async () => {
  const { server, base } = await startServer();
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const width of [344, 411]) {
      const { page, ctx, calls } = await openPage(browser, base, width, { shelf: SHELF });
      // Open Harbor Patrol, Lookup to get the picker
      await page.waitForSelector(".item-card");
      await page.click(".item-card");
      await page.waitForSelector("#item-detail-modal:not([hidden])");
      await page.click("#item-detail-edit");
      await page.waitForSelector("#modal", { state: "visible" });
      await page.click("#btn-lookup");
      await page.waitForSelector("#comic-picker:not([hidden])");
      {
        const confirm = page.locator("#confirm:not([hidden])");
        if (await confirm.count()) {
          await page.click("#confirm-cancel");
          await page.waitForSelector("#confirm", { state: "hidden" });
        }
      }
      const take = page.locator("#btn-comic-take-photo");
      check(`${width}: Take a photo is visible in the picker`, await take.isVisible());
      const box = await take.boundingBox();
      check(`${width}: Take a photo is at least 44px tall`, box && box.height >= 44);
      const input = page.locator("#comic-take-photo-input");
      check(`${width}: the file input has accept and capture=environment`,
        (await input.getAttribute("accept")) === "image/*" && (await input.getAttribute("capture")) === "environment");

      // Credits on the form / picker
      const pickerCredit = await page.locator("#comic-picker-credit").innerHTML();
      check(`${width}: picker shows Metron CC BY-SA`, /Metron/.test(pickerCredit) && /CC BY-SA 4\.0/.test(pickerCredit));

      if (SHOTS) {
        await page.screenshot({ path: path.join(SHOTS, `picker-take-photo-${width}.png`), fullPage: true });
      }

      // Take a photo (upload the 800×1200 fixture) and save
      const tmp = path.join("/tmp", `v214-photo-${width}.png`);
      fs.writeFileSync(tmp, PHOTO_PNG);
      await input.setInputFiles(tmp);
      await page.waitForTimeout(400);
      const stored = await page.evaluate(() => ({
        src: document.getElementById("field-cover-source").value,
        photo: (document.getElementById("field-cover-photo").value || "").slice(0, 30),
        choice: document.querySelector("#btn-comic-take-photo").classList.contains("is-selected"),
      }));
      check(`${width}: a taken photo is stored as a JPEG data URL with coverSource photo`,
        stored.src === "photo" && stored.photo.startsWith("data:image/jpeg") && stored.choice);
      const dim = await page.evaluate(() => new Promise((resolve) => {
        const url = document.getElementById("field-cover-photo").value;
        const img = new Image();
        img.onload = () => resolve({ w: img.width, h: img.height, len: url.length });
        img.onerror = () => resolve(null);
        img.src = url;
      }));
      check(`${width}: the saved photo is scaled to a 600px long edge`, dim && dim.w === 400 && dim.h === 600);

      await page.click("#btn-save");
      await page.waitForSelector("#modal", { state: "hidden" });
      await page.waitForTimeout(200);
      const card = await page.evaluate(() => {
        const img = document.querySelector(".item-card .item-cover");
        if (!img) return null;
        const cs = getComputedStyle(img);
        return { src: (img.getAttribute("src") || "").slice(0, 22), fit: cs.objectFit, w: img.clientWidth, h: img.clientHeight };
      });
      check(`${width}: the library card shows the photo with object-fit contain`,
        card && card.src.startsWith("data:image/jpeg") && card.fit === "contain" && card.w > 0 && card.h > 0);
      if (SHOTS) {
        await page.evaluate(() => { const t = document.querySelector(".toast"); if (t) t.remove(); });
        await page.screenshot({ path: path.join(SHOTS, `library-photo-card-${width}.png`), fullPage: true });
      }
      check(`${width}: no request was made to comics.org`, !calls.some((c) => c.blocked || /comics\.org/.test(c.host || "")));
      await ctx.close();

      // Trade with ISBN: Open Library cover on the card and in the picker
      const trade = await openPage(browser, base, width, { shelf: TRADE });
      const olCard = await trade.page.evaluate(() => {
        const img = document.querySelector(".item-card .item-cover");
        return img ? img.getAttribute("src") : "";
      });
      check(`${width}: a collected edition with an ISBN shows the Open Library cover (default=false)`,
        olCard === OL);
      await trade.page.waitForSelector(".item-card");
      await trade.page.click(".item-card");
      await trade.page.waitForSelector("#item-detail-modal:not([hidden])");
      await trade.page.click("#item-detail-edit");
      await trade.page.waitForSelector("#modal", { state: "visible" });
      await trade.page.click("#btn-lookup");
      await trade.page.waitForSelector("#comic-picker:not([hidden])");
      {
        const confirm = trade.page.locator("#confirm:not([hidden])");
        if (await confirm.count()) {
          await trade.page.click("#confirm-cancel");
          await trade.page.waitForSelector("#confirm", { state: "hidden" });
        }
      }
      const olTile = await trade.page.locator(`#comic-cover-list img[src="${OL}"]`).count();
      const olCredit = await trade.page.locator("#comic-picker-credit").innerText();
      check(`${width}: the picker includes the Open Library cover tile and credit`, olTile >= 1 && /Open Library/.test(olCredit));
      // Footer credits are filled on load; close the edit sheet so the library is visible.
      await trade.page.locator("#modal-close").click();
      await trade.page.waitForSelector("#modal", { state: "hidden" });
      const footer = await trade.page.locator("#footer-comic-credit, #footer-openlibrary-credit").allInnerTexts();
      check(`${width}: footer has the Metron CC BY-SA line and Covers from Open Library`,
        footer.some((t) => /Metron/.test(t) && /CC BY-SA/.test(t)) && footer.some((t) => /Open Library/.test(t)));
      if (SHOTS) {
        await trade.page.evaluate(() => { const t = document.querySelector(".toast"); if (t) t.remove(); });
        await trade.page.screenshot({ path: path.join(SHOTS, `library-openlibrary-trade-${width}.png`), fullPage: true });
      }
      // ISBN/UPC is sent to the relay: /comic-barcode first, and /comic also gets upc when series+issue run.
      const relayCalls = trade.calls.filter((c) => c.path === "/comic" || c.path === "/comic-barcode");
      check(`${width}: the ISBN is sent to the relay as upc`,
        relayCalls.some((c) => c.path === "/comic-barcode" && c.query && c.query.upc === ISBN) ||
        relayCalls.some((c) => c.path === "/comic" && c.query && c.query.upc === ISBN && c.query.series === "Saga"));
      await trade.ctx.close();

      // Review relay override
      const rev = await openPage(browser, base, width, { shelf: SHELF, pathSuffix: "?comicRelay=review" });
      await rev.page.waitForSelector(".item-card");
      await rev.page.click(".item-card");
      await rev.page.waitForSelector("#item-detail-modal:not([hidden])");
      await rev.page.click("#item-detail-edit");
      await rev.page.waitForSelector("#modal", { state: "visible" });
      await rev.page.click("#btn-lookup");
      await rev.page.waitForTimeout(400);
      check(`${width}: ?comicRelay=review talks to the review worker, not production frm-gcd`,
        rev.calls.some((c) => c.host === "frm-gcd-review.freerangeice.workers.dev") &&
        !rev.calls.some((c) => c.host === "frm-gcd.freerangeice.workers.dev"));
      await rev.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log("OK", passed, "checks");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
