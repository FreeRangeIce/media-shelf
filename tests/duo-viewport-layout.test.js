// LOCAL, mocked visualViewport geometry. No screenshots, real keyboard, provider writes or
// device claim. The visual viewport changes independently of the browser layout viewport.
const { chromium } = require("playwright-core");
const fs = require("fs");
const ORIGIN = process.env.TT_ORIGIN || "http://127.0.0.1:8893";
const origin = new URL(ORIGIN);
if (origin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) throw new Error("Local HTTP origin required");
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : " " + d}`); };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  try {
    for (const [width, height] of [[390, 844], [1000, 720], [1000, 420]]) {
      const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
      const errors = [], writes = [];
      await ctx.addInitScript(() => {
        const vv = new EventTarget();
        Object.assign(vv, { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1 });
        Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
        window.__setVV = (values, event = "resize") => { Object.assign(vv, values); vv.dispatchEvent(new Event(event)); };
        localStorage.setItem("media-shelf-seeded", "2026-01-01T00:00:00.000Z");
        localStorage.setItem("media-tracker-v1", JSON.stringify({ version: 1, items: Array.from({ length: 24 }, (_, i) => ({ id: "b" + i, type: "book", title: "Book " + i, status: "owned", dateAdded: "2026-01-01T00:00:00.000Z" })) }));
      });
      await ctx.route("**/*", async r => {
        const req = r.request(), u = new URL(req.url());
        if (!["GET", "HEAD"].includes(req.method())) { writes.push(req.url()); return r.abort(); }
        if (u.origin !== origin.origin) return r.abort();
        // Optional unmodified v45 application/CSS control; never changes the checkout.
        if (process.env.CONTROL_DIR && ["/app.js", "/styles.css"].includes(u.pathname)) return r.fulfill({ contentType: u.pathname.endsWith(".js") ? "application/javascript" : "text/css", body: fs.readFileSync(process.env.CONTROL_DIR + u.pathname) });
        return r.continue();
      });
      const page = await ctx.newPage(); page.on("pageerror", e => errors.push(String(e)));
      await page.goto(ORIGIN + "/"); await page.waitForSelector("#stats .stat-pill");
      const y = await page.evaluate(() => { scrollTo(0, 400); return scrollY; });
      await page.evaluate(() => document.querySelector("#btn-add").click());
      await page.waitForSelector("#modal:not([hidden])"); await page.waitForTimeout(250);
      const beforeTop = await page.evaluate(() => document.body.style.top);
      const set = (values, event) => page.evaluate(async ({ values, event }) => { window.__setVV(values, event); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }, { values, event });
      const geometry = () => page.evaluate(() => {
        const v = visualViewport, m = document.querySelector("#modal"), b = m.querySelector(".modal-backdrop").getBoundingClientRect(), p = m.querySelector(".modal-panel").getBoundingClientRect();
        const field = document.activeElement.getBoundingClientRect(), actions = m.querySelector(".form-actions"), bar = actions.getBoundingClientRect();
        const fade = parseFloat(getComputedStyle(actions, "::before").height);
        const top = Math.max(v.offsetTop, p.top) + 8;
        let bottom = Math.min(v.offsetTop + v.height, p.bottom) - 8;
        if (bar.bottom > top && bar.top < bottom) bottom = Math.min(bottom, bar.top - fade - 8);
        return { cover: b.left <= .5 && b.top <= .5 && b.right >= Math.max(innerWidth, v.offsetLeft + v.width) - .5 && b.bottom >= Math.max(innerHeight, v.offsetTop + v.height) - .5, b: [b.left,b.top,b.right,b.bottom], vv: [v.offsetLeft,v.offsetTop,v.width,v.height], panelHeight: p.height, fieldVisible: field.top >= top - .5 && field.bottom <= bottom + .5 };
      });
      const baseline = await geometry();
      await set({ height: height - 200 });
      // Option A: the panel must NOT collapse into visualViewport. The focused field,
      // not the entire panel/Save bar, must remain visible above keyboard occlusion.
      let g = await geometry(); check(`${width}x${height}: full canvas covered, Add size stable, focused field visible`, g.cover && Math.abs(g.panelHeight - baseline.panelHeight) < .5 && g.fieldVisible, JSON.stringify(g));
      for (const h of [height - 160, height - 120, height - 80, height - 40, height]) await set({ height: h });
      // Emulate a stale fixed-position/layout viewport: visible height grows independently.
      await set({ height: height + 90 });
      g = await geometry(); check(`${width}x${height}: independently expanded visible bottom covered`, g.cover, JSON.stringify(g));
      await set({ offsetTop: 90 }, "scroll");
      g = await geometry(); check(`${width}x${height}: delayed visual offset covered`, g.cover && Math.abs(g.panelHeight - baseline.panelHeight) < .5 && g.fieldVisible, JSON.stringify(g));
      const pinned = await page.evaluate(() => ({ top: document.body.style.top, pos: document.body.style.position, focus: document.activeElement.id }));
      check(`${width}x${height}: recovery retains original body pin and field focus`, pinned.top === beforeTop && pinned.pos === "fixed" && pinned.focus === "field-title", JSON.stringify(pinned));
      await set({ height, offsetTop: 0 });
      await set({ scale: 2, width: width / 2, height: height / 2, offsetLeft: 30, offsetTop: 30 });
      check(`${width}x${height}: zoom releases explicit geometry without dropping pin`, await page.evaluate(() => document.body.style.getPropertyValue("--sheet-vv-height") === "" && document.body.style.position === "fixed"));
      await set({ scale: 1, width, height, offsetLeft: 0, offsetTop: 0 });
      await page.click("#modal-close"); await page.waitForTimeout(100);
      check(`${width}x${height}: close restores scroll and clears overrides`, await page.evaluate(y => scrollY === y && document.body.style.position === "" && document.body.style.getPropertyValue("--sheet-vv-height") === "", y));
      check(`${width}x${height}: no page errors or attempted writes`, errors.length === 0 && writes.length === 0, JSON.stringify({ errors, writes }));
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(`\n${pass}/${pass + fail} passed`); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
