// V2.10: focused fields and cards stay clear of the sticky header, including
// a simulated keyboard-up visual viewport, at 320 / 344 / 411 / 673.
"use strict";
const { strict: assert } = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const pwPath = "/workspace/pw-tools/node_modules/playwright-core";
const { chromium } = require(pwPath);

const WIDTHS = [320, 344, 411, 673];
const KEYBOARD_H = 360; // simulated keyboard-up visual viewport height
const T0 = "2026-11-14T00:00:00.000Z";

function items() {
  return {
    version: 1,
    savedAt: T0,
    items: Array.from({ length: 60 }, (_, i) => ({
      id: "f" + i,
      type: "book",
      title: "Focus Book " + String(i).padStart(2, "0"),
      status: "owned",
      format: "physical",
      dateAdded: T0,
      dateUpdated: T0,
    })),
  };
}

function startServer() {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/index.html";
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}/` });
    });
  });
}

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log("PASS", name);
}

(async () => {
  const { server, base } = await startServer();
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const payload = items();

  try {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width, height: 720 },
        device_scale_factor: 2,
        is_mobile: true,
        has_touch: true,
        service_workers: "block",
      });
      await ctx.addInitScript((data) => {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch (e) {}
        localStorage.setItem("media-shelf-seeded", data.savedAt);
        localStorage.setItem("media-tracker-v1", JSON.stringify(data));
        localStorage.setItem("media-shelf-last-backup", data.savedAt);
      }, payload);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForSelector("#search, #stats", { timeout: 15000 });
      await page.waitForTimeout(300);

      const pad = await page.evaluate(() => {
        const header = document.querySelector(".frm-site-header, .site-header");
        const h = header ? header.getBoundingClientRect().height : 0;
        const cssPad = getComputedStyle(document.documentElement).scrollPaddingTop;
        const varPad = getComputedStyle(document.documentElement).getPropertyValue("--frm-sticky-pad").trim();
        return { h, cssPad, varPad, expected: `${Math.ceil(h) + 8}px` };
      });
      check(`${width}: --frm-sticky-pad equals header height + 8px`, () => {
        assert.equal(pad.varPad, pad.expected, JSON.stringify(pad));
        assert.equal(pad.cssPad, pad.expected, JSON.stringify(pad));
        assert.ok(pad.h > 80, "header should be present, height " + pad.h);
      });

      // Simulate a keyboard-up visual viewport (360px tall), scroll down, then
      // focus Search and let the browser scroll it into view (nearest).
      await page.setViewportSize({ width, height: KEYBOARD_H });
      await page.waitForTimeout(150);
      await page.evaluate(() => window.scrollTo(0, 800));
      await page.waitForTimeout(80);
      await page.focus("#search");
      await page.evaluate(() => {
        const el = document.getElementById("search");
        if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
      await page.waitForTimeout(120);
      const search = await page.evaluate(() => {
        const el = document.getElementById("search");
        const header = document.querySelector(".frm-site-header, .site-header");
        const r = el.getBoundingClientRect();
        const h = header.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
        return {
          top: r.top,
          bottom: r.bottom,
          headerBottom: h.bottom,
          pad,
          hidden: r.bottom <= h.bottom && r.top < h.bottom,
        };
      });
      check(`${width}: focused Search is fully below the header with keyboard up`, () => {
        assert.equal(search.hidden, false, JSON.stringify(search));
        assert.ok(
          search.top >= search.headerBottom - 1 || search.top >= search.pad - 1,
          "Search top " + search.top + " must clear header " + search.headerBottom + " / pad " + search.pad
        );
      });

      // Restore a taller viewport and walk focus up through cards.
      await page.setViewportSize({ width, height: 720 });
      await page.waitForTimeout(150);
      await page.evaluate(() => {
        const cards = [...document.querySelectorAll("#item-list .item-card")];
        if (cards.length) cards[cards.length - 1].focus();
      });
      let cardHidden = 0;
      let cardChecked = 0;
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press("Shift+Tab");
        await page.waitForTimeout(40);
        const r = await page.evaluate(() => {
          const a = document.activeElement;
          if (!a || !a.classList || !a.classList.contains("item-card")) return null;
          const rect = a.getBoundingClientRect();
          const h = document.querySelector(".frm-site-header, .site-header").getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, headerBottom: h.bottom };
        });
        if (!r) continue;
        cardChecked += 1;
        // Fully hidden (bottom at or above header bottom) fails 2.4.11.
        if (r.bottom <= r.headerBottom + 1 && r.top < r.headerBottom) cardHidden += 1;
      }
      check(`${width}: focused cards are not fully hidden under the header (checked ${cardChecked})`, () => {
        assert.ok(cardChecked > 0, "expected to land on cards while Shift+Tabbing");
        assert.equal(cardHidden, 0, "fully hidden cards: " + cardHidden);
      });

      check(`${width}: no page errors`, () => {
        assert.deepEqual(errors, []);
      });
      await ctx.close();
    }
    console.log(`${passed}/${passed} passed (v2.10 focus visibility at 320/344/411/673)`);
  } catch (err) {
    console.error(err);
    console.error(`FAILED after ${passed} passes`);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
