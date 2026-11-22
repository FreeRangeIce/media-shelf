// V2.14: enrichment bug fixes (Undo, offline, timeouts, Continue at, Retry-After,
// hand-saves, pick counts, storage wording, progress bar, in-file CLZ repeats,
// unclosed CSV quotes, leftover marks write). UPCitemdb is no longer used.
// Comic single-cover auto-fill; cross-origin 429 without expose falls back to 60s.
// Real app.js in a vm. No network, no browser.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./helpers/import-harness.cjs");

const appSrc = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
let passed = 0;
const pending = [];
function check(name, fn) {
  pending.push(async () => {
    await fn();
    passed += 1;
    console.log("PASS", name);
  });
}
const tick = () => new Promise((r) => setTimeout(r, 15));
async function flush(n = 40) {
  for (let i = 0; i < n; i++) await tick();
}

function mockFetch(routes) {
  const calls = [];
  const fn = async (url, opts) => {
    const u = String(url);
    calls.push(u);
    for (const [re, h] of routes) {
      if (re.test(u)) {
        const r = h(u, opts) || {};
        if (r.throw) throw r.throw;
        if (r.hang) {
          return new Promise((_, reject) => {
            const sig = opts && opts.signal;
            if (!sig) return;
            if (sig.aborted) return reject(Object.assign(new Error("The user aborted a request."), { name: "AbortError" }));
            sig.addEventListener("abort", () => reject(Object.assign(new Error("The user aborted a request."), { name: "AbortError" })));
          });
        }
        return new Response(r.body === undefined ? "{}" : JSON.stringify(r.body), { status: r.status || 200, headers: r.headers || { "Content-Type": "application/json" } });
      }
    }
    return new Response("{}", { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

function bootWith(routes, { store, clock, fetch, Image } = {}) {
  const f = fetch || mockFetch(routes || []);
  const c = clock || H.makeClock();
  const b = H.bootFile(undefined, { fetch: f, store, clock: c, Image });
  return { ...b, fetch: f, clock: c };
}

function imageStub({ width = 200, height = 300, error = false, requests } = {}) {
  return class Image {
    constructor() { this.naturalWidth = 0; this.naturalHeight = 0; this.onload = null; this.onerror = null; this._src = ""; }
    set src(v) {
      this._src = String(v || "");
      if (requests) requests.push(this._src);
      if (error) { if (typeof this.onerror === "function") this.onerror(); return; }
      this.naturalWidth = width;
      this.naturalHeight = height;
      if (typeof this.onload === "function") this.onload();
    }
    get src() { return this._src; }
  };
}

/** Paint a shelf card the way coverMarkup does: request the display URL, and on error call rememberFailedCoverUrl(this.src). */
function paintCard(b, item) {
  const html = b.api.coverMarkup(item);
  const m = /<img class="item-cover" src="([^"]*)"/.exec(html);
  if (!m) return "";
  const url = m[1].replace(/&amp;/g, "&");
  const img = new b.ctx.Image();
  img.style = { display: "" };
  img.nextElementSibling = { hidden: true };
  img.onerror = function () {
    this.style.display = "none";
    if (this.nextElementSibling) this.nextElementSibling.hidden = false;
    b.ctx.rememberFailedCoverUrl(this.src);
  };
  img.src = url;
  return url;
}

const BASE = { status: "owned", sources: ["clz"], dateAdded: "2026-11-14T00:00:00.000Z", dateUpdated: "2026-11-14T00:00:00.000Z" };
const OL_BOOK = [
  [/openlibrary\.org\/isbn\//, () => ({ body: { title: "Dune", publish_date: "1965", covers: [42], authors: [{ key: "/authors/A1" }] } })],
  [/openlibrary\.org\/authors\//, () => ({ body: { name: "Frank Herbert" } })],
  [/googleapis/, () => ({ body: { items: [] } })],
];
const BOOK = { ...BASE, id: "a1", type: "book", title: "Dune", barcode: "9780441172719", format: "physical" };
const GAME_BC = { ...BASE, id: "g1", type: "game", title: "Halo 3", platform: "Xbox 360", barcode: "882224479325", format: "physical" };
const WIKI_MISS = [/query\.wikidata\.org/, () => ({ body: { results: { bindings: [] } } })];
const IGDB_ONE = [/\/game\/search\?title=/, () => ({ body: { candidates: [{ igdbId: 7, title: "Halo 3", creator: "Bungie", year: 2007, platforms: ["Xbox 360"], coverUrl: "" }] } })];

async function queueAndRun(b, ids) {
  // Write the queue directly so we do not start the 11s post-Undo timer (that
  // fake-clock timer would otherwise jump Date.now() mid-run).
  const q0 = b.api.readEnrichQueue();
  b.api.writeEnrichQueue({
    ...q0,
    ids: [...new Set([...(q0.ids || []), ...ids])],
    total: (q0.ids && q0.ids.length ? q0.total : 0) + ids.length,
    seen: true,
    dismissed: false,
    paused: false,
    reason: "",
  });
  b.clock.now += 20000;
  await b.api.runEnrich();
  return b.api.readEnrichQueue();
}

/* ---------- (1) Undo still works if enrichment writes during the 10s window ---------- */
check("Undo: enrichment during the 10s window refreshes the snapshot, so Undo still removes the import", async () => {
  const b = bootWith(OL_BOOK);
  b.seed([BOOK]);
  const imported = b.api.normalizeItem({ ...BASE, id: "b1", type: "book", title: "Imported Book", format: "physical" });
  const list = [...b.api.getItems(), imported];
  const raw = JSON.stringify({ version: 1, items: list });
  b.store.set("media-tracker-v1", raw);
  b.api.setItems(list);
  b.api.setSynced(raw);
  b.api.setImportUndo({ addedIds: new Set(["b1"]), previous: new Map(), raw, until: b.clock.now + 10000 });
  // Enrichment already running from a previous import (its 11s start delay has passed).
  // Do not enqueueEnrich here: that would start an 11s timer and expire this window.
  b.api.writeEnrichQueue({ ...b.api.readEnrichQueue(), ids: ["a1"], total: 1, seen: true, dismissed: false });
  await b.api.runEnrich();
  const after = b.stored().find((i) => i.id === "a1");
  assert.equal(after.creator, "Frank Herbert");
  const u = b.api.getImportUndo();
  assert.ok(u, "the Undo window is still open");
  assert.equal(u.raw, b.store.get("media-tracker-v1"), "raw follows the enrichment write");
  assert.ok(u.until > b.clock.now);
  b.api.undoImport();
  assert.deepEqual(b.stored().map((i) => i.id), ["a1"]);
  assert.equal(b.stored()[0].creator, "Frank Herbert", "the enrichment on the older item is kept");
  assert.ok(b.toasts.some((t) => t === "Import undone"));
});

/* ---------- (2) Offline pauses; online resumes; items are not marked failed ---------- */
check("offline: the queue pauses (not failed), no try is spent, and the online event resumes it", async () => {
  const b = bootWith(OL_BOOK);
  b.seed([BOOK, { ...BOOK, id: "a2", title: "Dune 2", barcode: "9780441172726" }]);
  b.ctx.navigator.onLine = false;
  const q = await queueAndRun(b, ["a1", "a2"]);
  assert.equal(q.paused, true);
  assert.equal(q.reason, "offline");
  assert.deepEqual([...q.ids], ["a1", "a2"]);
  assert.equal(q.failed, 0);
  assert.ok(b.stored().every((i) => i.enrich === undefined));
  assert.equal(b.fetch.calls.length, 0, "nothing is asked while offline");
  assert.equal(Object.keys(q.tries || {}).length, 0, "offline does not consume a try");
  assert.match(b.el("#enrich-line").textContent, /You’re offline|You're offline/);
  b.ctx.navigator.onLine = true;
  b.api.enrichOnOnline();
  await flush(60);
  const done = b.api.readEnrichQueue();
  assert.equal(done.paused, false);
  assert.equal(done.ids.length, 0);
  assert.equal(done.enriched, 2);
});

check("online event does not resume a cap or error pause", async () => {
  const b = bootWith(OL_BOOK);
  b.seed([BOOK]);
  b.api.writeEnrichQueue({ ...b.api.readEnrichQueue(), ids: ["a1"], total: 1, seen: true, dismissed: false, paused: true, reason: "Open Library", until: 0 });
  b.api.enrichOnOnline();
  await tick();
  const q = b.api.readEnrichQueue();
  assert.equal(q.paused, true);
  assert.equal(q.reason, "Open Library");
  assert.equal(b.fetch.calls.length, 0);
});

/* ---------- (3) Book, music and movie lookups time out at 15s ---------- */
check("lookupFetch: books, music and movie lookups time out at 15s and do not stall the queue", async () => {
  assert.equal(bTimeoutMs(), 15000);
  function bTimeoutMs() {
    const m = appSrc.match(/LOOKUP_FETCH_MS\s*=\s*(\d+)/);
    return m ? Number(m[1]) : 0;
  }
  assert.match(appSrc, /async function lookupFetch/);
  assert.match(appSrc, /lookupFetch\(`https:\/\/openlibrary\.org\/isbn/);
  assert.match(appSrc, /googleapis\.com\/books[\s\S]{0,400}lookupFetch|lookupFetch\(url\)[\s\S]{0,80}function fetchGoogleBooks|async function fetchGoogleBooks[\s\S]{0,2500}lookupFetch/);
  assert.match(appSrc, /async function musicBrainzFetch[\s\S]{0,400}return lookupFetch\(url\)/);
  assert.match(appSrc, /lookupFetch\(`https:\/\/www\.omdbapi\.com/);
  const b = bootWith([
    [/openlibrary/, () => ({ hang: true })],
    [/googleapis/, () => ({ hang: true })],
  ]);
  assert.equal(b.api.LOOKUP_FETCH_MS, 15000);
  b.seed([BOOK]);
  const t0 = b.clock.now;
  await queueAndRun(b, ["a1"]);
  const q = b.api.readEnrichQueue();
  assert.ok(b.clock.now - t0 >= 15000, "the 15s abort fired");
  assert.equal(q.paused, false, "a timeout is not an offline / cap pause");
  assert.ok(q.ids.includes("a1") || b.stored()[0].enrich === "lookup", "the item is retried or marked Needs lookup, never hung");
  assert.ok(b.fetch.calls.some((u) => /openlibrary/.test(u)));
});

/* ---------- (4) Continue at is kept after a reload for a short busy wait ---------- */
check("Continue at: a short busy pause still resumes at the promised time after a reload", async () => {
  const routes = [[/\/comic\?/, () => ({ body: { match: { series: "Saga", issue: "1", year: 2012, publisher: "Image", writer: [], artist: [], sourceId: "gcd-1", sourceName: "Grand Comics Database", sourceUrl: "https://www.comics.org/issue/1/" }, variants: [], covers: [{ sourceId: "gcd-1", url: "https://static.metron.cloud/x.jpg", label: "Direct", variant: false }], total: 1 } })]];
  const b = bootWith(routes);
  b.seed([{ ...BASE, id: "k1", type: "comic", series: "Saga", issue: "1" }]);
  const until = b.clock.now + 120000;
  b.api.writeEnrichQueue({ ...b.api.readEnrichQueue(), ids: ["k1"], total: 1, seen: true, dismissed: false, paused: true, reason: "Grand Comics Database", until });
  // Simulate a reload: same store, new boot, resumeEnrichOnOpen must keep the timer.
  const r = bootWith(routes, { store: b.store, clock: { ...H.makeClock(b.clock.now), now: b.clock.now } });
  // Share the same clock object so the timer advances it.
  const clock = r.clock;
  // Re-boot with the exact shared clock from the first snapshot time.
  const c = H.makeClock(b.clock.now);
  const again = bootWith(routes, { store: b.store, clock: c });
  again.api.resumeEnrichOnOpen();
  await flush(80);
  const done = again.api.readEnrichQueue();
  assert.ok(c.now >= until, "the clock waited until the promised time");
  assert.equal(done.ids.length, 0, "the item ran once the promised time passed");
  assert.equal(done.enriched, 1, "a single Metron cover is auto-filled once the pause ends");
  assert.equal(again.stored()[0].coverUrl, "https://static.metron.cloud/x.jpg");
  assert.ok(again.fetch.calls.some((u) => /\/comic\?/.test(u)));
});

/* ---------- (5) Retry-After for Open Library, Google Books, MusicBrainz ---------- */
check("Retry-After: Open Library 429 pauses until the header, not a default 60s", async () => {
  const b = bootWith([
    [/openlibrary\.org\/isbn\//, () => ({ status: 429, headers: { "Retry-After": "120" }, body: {} })],
    [/googleapis/, () => ({ status: 429, headers: { "Retry-After": "10" }, body: {} })],
  ]);
  b.seed([BOOK]);
  const t0 = b.clock.now + 20000;
  const q = await queueAndRun(b, ["a1"]);
  assert.equal(q.paused, true);
  assert.ok(q.until >= t0 + 120000, `until ${q.until} t0 ${t0}`);
  assert.ok(q.until < t0 + 120000 + 5000, "not padded far past the header");
  assert.deepEqual([...q.ids], ["a1"]);
  assert.equal(b.stored()[0].enrich, undefined);
});

check("Retry-After: Google Books 429 (Open Library 404) pauses until the header", async () => {
  const b = bootWith([
    [/openlibrary\.org\/isbn\//, () => ({ status: 404, body: {} })],
    [/googleapis/, () => ({ status: 429, headers: { "Retry-After": "180" }, body: {} })],
  ]);
  b.seed([BOOK]);
  const t0 = b.clock.now + 20000;
  const q = await queueAndRun(b, ["a1"]);
  assert.equal(q.paused, true);
  assert.ok(q.until >= t0 + 180000, "Google Books Retry-After is honoured");
  assert.deepEqual([...q.ids], ["a1"]);
});

check("Retry-After: MusicBrainz 503 pauses until the header", async () => {
  const b = bootWith([[/musicbrainz/, () => ({ status: 503, headers: { "Retry-After": "90" }, body: {} })]]);
  b.seed([{ ...BASE, id: "m1", type: "music", title: "OK Computer", creator: "Radiohead" }]);
  const t0 = b.clock.now + 20000;
  const q = await queueAndRun(b, ["m1"]);
  assert.equal(q.paused, true);
  assert.ok(q.until >= t0 + 90000, "MusicBrainz Retry-After is honoured");
  assert.deepEqual([...q.ids], ["m1"]);
});

/* ---------- (6) Hand-saved items are not re-marked ---------- */
check("hand-saved: an item edited since import is dropped from the queue and never re-marked", async () => {
  const b = bootWith(OL_BOOK);
  b.seed([{ ...BOOK, dateUpdated: "2026-11-14T12:00:00.000Z", title: "My edited Dune" }]);
  const q = await queueAndRun(b, ["a1"]);
  assert.equal(q.ids.length, 0);
  assert.equal(b.stored()[0].enrich, undefined, "no pick / lookup / failed mark");
  assert.equal(b.stored()[0].title, "My edited Dune");
  assert.equal(b.fetch.calls.length, 0);
});

/* ---------- (8) Needs a pick count matches the list (type set to All) ---------- */
check("Needs a pick: the filter switches type to All so the count matches the list", () => {
  assert.match(appSrc, /function setEnrichFilter\(mark\)[\s\S]{0,400}filterType = "all"/);
  const b = bootWith([]);
  b.seed([
    { ...BASE, id: "p1", type: "game", title: "A", enrich: "pick" },
    { ...BASE, id: "p2", type: "book", title: "B", enrich: "pick" },
    { ...BASE, id: "p3", type: "music", title: "C", enrich: "lookup" },
  ]);
  b.api.setEnrichFilter("pick");
  assert.equal(b.api.getFilterEnrich(), "pick");
  assert.equal(b.api.getFilterType(), "all");
  assert.equal(b.api.enrichMarked("pick").length, 2);
  assert.equal(b.el("#btn-enrich-pick").textContent, "Needs a pick (2)");
});

/* ---------- (9) The pick count updates after a pick is saved ---------- */
check("Needs a pick count: renderEnrichUi is current after a mark is cleared (save path still calls render)", () => {
  assert.match(appSrc, /delete merged\.enrich;/);
  assert.match(appSrc, /function render\(\) \{[\s\S]{0,2500}renderEnrichUi\(\)/);
  assert.match(appSrc, /showToast\("Updated"\);[\s\S]{0,500}closeModal\(\);[\s\S]{0,80}render\(\);/);
  const b = bootWith([]);
  const rows = [
    { ...BASE, id: "p1", type: "game", title: "A", enrich: "pick" },
    { ...BASE, id: "p2", type: "book", title: "B", enrich: "pick" },
  ];
  b.seed(rows);
  b.api.renderEnrichUi();
  assert.equal(b.el("#btn-enrich-pick").textContent, "Needs a pick (2)");
  const next = b.stored().map((it) => (it.id === "p1" ? { ...it, enrich: undefined, dateUpdated: "2026-11-14T12:00:00.000Z" } : it));
  const raw = JSON.stringify({ version: 1, items: next });
  b.store.set("media-tracker-v1", raw);
  b.api.setItems(next);
  b.api.setSynced(raw);
  b.api.renderEnrichUi();
  assert.equal(b.el("#btn-enrich-pick").textContent, "Needs a pick (1)");
  assert.equal(b.api.enrichMarked("pick").length, 1);
});

/* ---------- (10) Storage-full wording is not "Lookups aren’t working" ---------- */
check("storage pause: the line repeats the storage-full message, not the lookups-aren't-working copy", () => {
  const b = bootWith([]);
  b.seed([BOOK]);
  b.api.setLastStorageFailureMsg("This change didn’t fit in this browser’s storage, so it wasn’t saved.");
  b.api.writeEnrichQueue({ ...b.api.readEnrichQueue(), ids: ["a1"], total: 5, done: 2, seen: true, dismissed: false, paused: true, reason: "storage" });
  b.api.renderEnrichUi();
  const line = b.el("#enrich-line").textContent;
  assert.match(line, /Paused after 2 of 5/);
  assert.match(line, /didn’t fit in this browser’s storage/);
  assert.ok(!/Lookups aren’t working/.test(line));
});

/* ---------- (11) Progress bar fills to work done, 0% at the start ---------- */
check("progress bar: width is done/total (0% at start, not 100% while the last item is in flight)", () => {
  const b = bootWith([]);
  b.seed([BOOK]);
  b.api.writeEnrichQueue({ ...b.api.readEnrichQueue(), ids: ["a1"], total: 1, done: 0, seen: true, dismissed: false, paused: false });
  b.api.renderEnrichUi();
  assert.equal(b.el("#enrich-bar-fill").style.width, "0%");
  b.api.writeEnrichQueue({ ...b.api.readEnrichQueue(), ids: ["a4"], total: 4, done: 3, seen: true, dismissed: false, paused: false });
  b.api.renderEnrichUi();
  assert.equal(b.el("#enrich-bar-fill").style.width, "75%");
});

/* ---------- (12) Three identical CLZ rows: default Update skips in-file repeats ---------- */
check("CLZ in-file repeats: three identical rows land one copy (default Update skips the repeats)", () => {
  const b = bootWith([]);
  const cells = ["Harbor Patrol", "812", "", "Northwind Press", "2004"];
  b.api.setClz({ typeKey: "comics", rows: [cells, cells, cells], mapping: { series: 0, issue: 1, variant: 2, publisher: 3, year: 4 }, evals: [], choices: new Map() });
  b.api.evaluateClz();
  const c = b.api.clzCounts();
  assert.equal(c.fresh, 1);
  assert.equal(c.dup, 2);
  assert.equal(c.add, 1);
  assert.equal(c.update, 0);
  assert.equal(b.api.clzChoice(0), "add");
  assert.equal(b.api.clzChoice(1), "skip");
  assert.equal(b.api.clzChoice(2), "skip");
  b.api.setClz({ typeKey: "comics", rows: [cells, cells, cells], mapping: { series: 0, issue: 1, variant: 2, publisher: 3, year: 4 }, evals: b.api.clz ? null : undefined, choices: new Map([[1, "add"]]) });
  // evaluate again; keep the explicit Separate copy on row 1
  const ev = b.ctx.__app;
  ev.setClz({ typeKey: "comics", rows: [cells, cells, cells], mapping: { series: 0, issue: 1, variant: 2, publisher: 3, year: 4 }, evals: [], choices: new Map([[1, "add"]]) });
  b.api.evaluateClz();
  assert.equal(b.api.clzChoice(1), "add", "an explicit Separate copy still adds");
  const c2 = b.api.clzCounts();
  assert.equal(c2.add, 2);
});

/* ---------- (13) An unclosed quote does not swallow the next row ---------- */
check("unclosed quote: the record ends at the line break; the next row is not swallowed; the CLZ file is refused", () => {
  const b = bootWith([]);
  const text = "Series,Issue\n\"Saga,1\nWatchmen,1\n";
  const rows = b.api.parseDelimited(text, ",");
  assert.equal(rows.unterminated, true);
  assert.ok(rows.length >= 3, "header, the broken row, and Watchmen each stand alone");
  const last = rows[rows.length - 1];
  assert.equal(last.cells.map((c) => String(c).trim()).join("|"), "Watchmen|1");
  const parsed = b.api.parseClzCsv(text);
  assert.equal(parsed.error, "unparseable");
  assert.ok(!parsed.rows, "no garbage merged row is imported");
});

/* ---------- (14) leftover enrichAfterRestore(false) must not drop the queue if marks fail ---------- */
check("leftover enrichAfterRestore(false): a failed marks write keeps the queue (items are not left looking finished)", () => {
  const b = bootWith([]);
  b.seed([{ ...BASE, id: "s1", type: "book", title: "Kept" }]);
  b.api.writeEnrichQueue({ ...b.api.readEnrichQueue(), ids: ["s1"], total: 1, seen: true, dismissed: false, paused: false });
  const orig = b.store.set.bind(b.store);
  b.store.set = (k, v) => {
    if (k === "media-tracker-v1") {
      const err = new Error("exceeded the quota");
      err.name = "QuotaExceededError";
      throw err;
    }
    return orig(k, v);
  };
  b.api.enrichAfterRestore(false);
  const q = b.api.readEnrichQueue();
  assert.deepEqual([...q.ids], ["s1"], "the queue is not dropped");
  assert.equal(b.stored()[0].enrich, undefined, "the failed marks write did not land");
  assert.ok(b.toasts.some((t) => /storage/i.test(t) || /didn’t fit/i.test(t) || /Couldn’t save/i.test(t)));
});

/* ---------- UPCitemdb is gone: no request is ever made ---------- */
check("UPCitemdb: Wikidata hit never asks UPCitemdb; falls through to IGDB on the title", async () => {
  const b = bootWith([
    [/query\.wikidata\.org/, () => ({ body: { results: { bindings: [{ itemLabel: { value: "Halo 3" }, platLabel: { value: "Xbox 360" } }] } } })],
    [/upcitemdb/, () => ({ body: { items: [{ title: "SHOULD NOT BE ASKED" }] } })],
    IGDB_ONE,
  ]);
  b.seed([GAME_BC]);
  const q = await queueAndRun(b, ["g1"]);
  assert.equal(b.fetch.calls.filter((u) => /upcitemdb/.test(u)).length, 0, "UPCitemdb is never asked");
  assert.equal(q.enriched, 1);
  assert.equal(b.stored()[0].igdbId, "7");
});

check("UPCitemdb: a Wikidata miss never asks UPCitemdb; title search is used instead", async () => {
  const b = bootWith([
    WIKI_MISS,
    [/upcitemdb/, () => ({ body: { items: [{ title: "SHOULD NOT BE ASKED" }] } })],
    IGDB_ONE,
  ]);
  b.seed([GAME_BC]);
  const q = await queueAndRun(b, ["g1"]);
  assert.equal(b.fetch.calls.filter((u) => /upcitemdb/.test(u)).length, 0, "UPCitemdb is never asked");
  assert.ok(b.fetch.calls.some((u) => /query\.wikidata\.org/.test(u)));
  assert.ok(b.fetch.calls.some((u) => /\/game\/search\?title=/.test(u)), "title search runs after a Wikidata miss");
  assert.equal(q.pick, 1, "a title search with one result is still Needs a pick");
  assert.equal(b.stored()[0].enrich, "pick");
  assert.equal(b.stored()[0].igdbId, "");
});

/* ---------- Retry-After: cross-origin 429 without expose falls back to 60s ---------- */
check("Retry-After: a cross-origin 429 WITHOUT Access-Control-Expose-Headers falls back to 60s", async () => {
  // Simulate a browser: the source sent Retry-After: 120, but CORS hid it.
  const fetch = mockFetch([]);
  const hidden = async (url, opts) => {
    const u = String(url);
    fetch.calls.push(u);
    if (/openlibrary\.org\/isbn\//.test(u)) {
      const headers = new Headers({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "https://freerangeice.github.io",
        // No Access-Control-Expose-Headers: Retry-After — the header is on the
        // wire (120s) but not visible to script, the way OL/GB/MB behave.
      });
      return new Response("{}", { status: 429, headers });
    }
    if (/googleapis/.test(u)) return new Response("{}", { status: 404 });
    return new Response("{}", { status: 404 });
  };
  hidden.calls = fetch.calls;
  const b = bootWith([], { fetch: hidden });
  b.seed([BOOK]);
  const t0 = b.clock.now + 20000;
  const q = await queueAndRun(b, ["a1"]);
  assert.equal(q.paused, true);
  assert.equal(q.reason, "Open Library");
  assert.deepEqual([...q.ids], ["a1"]);
  assert.ok(q.until >= t0 + 60000 - 50, `until ${q.until} should be the 60s default (t0=${t0})`);
  assert.ok(q.until < t0 + 120000, "must not honour the hidden 120s Retry-After");
  assert.ok(q.until - t0 < 90000, "60s, not a long hidden wait");
});

/* ---------- Comic cover auto-fill: one clear match fills; several / none stay a pick ---------- */
const METRON = "https://static.metron.cloud/media/issue/2019/12/10/saga-1.jpg";
const TRADE_ISBN = "9781632159038";
const OL_TRADE = "https://covers.openlibrary.org/b/isbn/9781632159038-M.jpg?default=false";
const COMIC_MATCH = {
  series: "Saga", issue: "1", year: 2012, publisher: "Image", writer: ["Brian K. Vaughan"], artist: [],
  sourceId: "gcd-issue-911609", sourceName: "Grand Comics Database", sourceUrl: "https://www.comics.org/issue/911609/",
};
function comicBody(covers, extras = {}) {
  const list = covers.map((c, i) => ({
    sourceId: c.sourceId || `gcd-issue-${911609 + i}`,
    url: c.url || "",
    label: c.label || (i ? `Variant ${i}` : "Direct Sales"),
    variant: c.variant === true,
  }));
  return {
    match: extras.match === undefined ? COMIC_MATCH : extras.match,
    covers: list,
    variants: list.map((c) => ({ sourceId: c.sourceId, label: c.label, variant: c.variant, image: c.url })),
    total: extras.total != null ? extras.total : list.length,
    imagesFrom: list.some((c) => c.url) ? "metron" : "",
    ...extras,
  };
}

check("comics: a single exact Metron cover auto-fills empty cover fields only", async () => {
  const b = bootWith([[/\/comic\?/, () => ({ body: comicBody([{ url: METRON, label: "Direct Sales" }]) })]]);
  b.seed([{ ...BASE, id: "k1", type: "comic", series: "Saga", issue: "1", year: 2012, coverUrl: "", coverLabel: "" }]);
  const q = await queueAndRun(b, ["k1"]);
  const it = b.stored()[0];
  assert.equal(q.enriched, 1);
  assert.equal(it.enrich, undefined);
  assert.equal(it.coverUrl, METRON);
  assert.equal(it.coverSource, "comiclookup");
  assert.equal(it.coverLabel, "Direct Sales");
  assert.equal(it.sourceId, "gcd-issue-911609");
  assert.equal(it.writer, "", "writer is not a cover field and is not filled");
});

check("comics: several covers are Needs a pick; nothing is attached; Take a photo stays available", async () => {
  const b = bootWith([[/\/comic\?/, () => ({ body: comicBody([
    { url: METRON, label: "Direct Sales" },
    { url: "https://static.metron.cloud/media/issue/2019/12/10/saga-1b.jpg", label: "Variant", variant: true },
  ]) })]]);
  b.seed([{ ...BASE, id: "k2", type: "comic", series: "Saga", issue: "1", year: 2012, coverUrl: "" }]);
  const q = await queueAndRun(b, ["k2"]);
  const it = b.stored()[0];
  assert.equal(q.pick, 1);
  assert.equal(it.enrich, "pick");
  assert.equal(it.coverUrl, "", "several covers are never auto-attached");
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /Take a photo/);
  assert.match(html, /comic-take-photo/);
});

check("comics: no match is Needs a pick so Take a photo / the picker can be used", async () => {
  const b = bootWith([[/\/comic\?/, () => ({ body: { match: null, covers: [], variants: [], total: 0 } })]]);
  b.seed([{ ...BASE, id: "k3", type: "comic", series: "Harbor Patrol", issue: "99", coverUrl: "" }]);
  const q = await queueAndRun(b, ["k3"]);
  const it = b.stored()[0];
  assert.equal(q.pick, 1);
  assert.equal(it.enrich, "pick");
  assert.equal(it.coverUrl, "");
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /Take a photo/);
});

check("comics: an existing cover is never overwritten, even by a single Metron match", async () => {
  const kept = "https://static.metron.cloud/media/issue/2019/01/01/mine.jpg";
  const b = bootWith([[/\/comic\?/, () => ({ body: comicBody([{ url: METRON, label: "Direct Sales" }]) })]]);
  b.seed([{ ...BASE, id: "k4", type: "comic", series: "Saga", issue: "1", year: 2012, coverUrl: kept, coverSource: "manual", coverLabel: "My scan" }]);
  const q = await queueAndRun(b, ["k4"]);
  const it = b.stored()[0];
  assert.equal(it.coverUrl, kept, "existing cover stays");
  assert.equal(it.coverSource, "manual");
  assert.equal(it.coverLabel, "My scan");
  assert.equal(it.enrich, undefined);
  assert.equal(q.enriched, 0);
});

check("comics: a trade with an ISBN and no Metron cover auto-fills the Open Library ISBN cover when the image loads", async () => {
  const b = bootWith([[/\/comic\?/, () => ({ body: { match: null, covers: [], variants: [], total: 0 } })]], { Image: imageStub({ width: 250, height: 375 }) });
  b.seed([{ ...BASE, id: "k5", type: "comic", series: "Saga", issue: "1", edition: "collected", comicFormat: "Trade Paperback", barcode: TRADE_ISBN, coverUrl: "" }]);
  const q = await queueAndRun(b, ["k5"]);
  const it = b.stored()[0];
  assert.equal(q.enriched, 1);
  assert.equal(it.coverUrl, OL_TRADE);
  assert.equal(it.coverSource, "openlibrary");
  assert.equal(it.enrich, undefined);
});

check("comics: a trade Open Library cover that fails to load is Needs a pick, and the URL is not saved", async () => {
  const b = bootWith([[/\/comic\?/, () => ({ body: { match: null, covers: [], variants: [], total: 0 } })]], { Image: imageStub({ error: true }) });
  b.seed([{ ...BASE, id: "k5e", type: "comic", series: "Saga", issue: "1", edition: "collected", comicFormat: "Trade Paperback", barcode: TRADE_ISBN, coverUrl: "" }]);
  const q = await queueAndRun(b, ["k5e"]);
  const it = b.stored()[0];
  assert.equal(q.pick, 1);
  assert.equal(it.enrich, "pick");
  assert.equal(it.coverUrl, "", "do not store a cover URL that failed to load");
  assert.equal(it.coverSource || "", "");
});

check("comics: a 1×1 Open Library placeholder is Needs a pick, and the URL is not saved", async () => {
  const b = bootWith([[/\/comic\?/, () => ({ body: { match: null, covers: [], variants: [], total: 0 } })]], { Image: imageStub({ width: 1, height: 1 }) });
  b.seed([{ ...BASE, id: "k5p", type: "comic", series: "Saga", issue: "1", edition: "collected", comicFormat: "Trade Paperback", barcode: TRADE_ISBN, coverUrl: "" }]);
  const q = await queueAndRun(b, ["k5p"]);
  const it = b.stored()[0];
  assert.equal(q.pick, 1);
  assert.equal(it.enrich, "pick");
  assert.equal(it.coverUrl, "", "do not store a 1×1 placeholder as a cover");
  assert.equal(it.coverSource || "", "");
});

check("comics: after a failed Open Library ISBN check, the unsaved URL is requested once; re-renders do not fetch it again", async () => {
  const requests = [];
  const b = bootWith([[/\/comic\?/, () => ({ body: { match: null, covers: [], variants: [], total: 0 } })]], { Image: imageStub({ error: true, requests }) });
  const seeded = b.seed([{ ...BASE, id: "k5r", type: "comic", series: "Saga", issue: "1", edition: "collected", comicFormat: "Trade Paperback", barcode: TRADE_ISBN, coverUrl: "" }]);
  // The card onerror and the detail-cover error handler both remember the failed URL.
  assert.match(b.api.coverMarkup(seeded[0]), /rememberFailedCoverUrl\(this\.src\)/);
  assert.match(fs.readFileSync(path.join(__dirname, "../app.js"), "utf8"), /cov\.addEventListener\("error", function \(\) \{ rememberFailedCoverUrl\(this\.src \|\| cov\.src\);/);
  // First paint, as on the review page, happens before the probe.
  assert.equal(paintCard(b, seeded[0]), OL_TRADE);
  assert.deepEqual(requests.filter((u) => u === OL_TRADE), [OL_TRADE]);
  assert.equal(b.api.itemDisplayCoverUrl(b.stored()[0]), "", "after the card onerror, the unsaved ISBN is not painted again");
  const q = await queueAndRun(b, ["k5r"]);
  const it = b.stored()[0];
  assert.equal(q.pick, 1);
  assert.equal(it.enrich, "pick");
  assert.equal(it.coverUrl, "", "a URL already known to have failed is still a failed probe: Needs a pick, nothing saved");
  assert.equal(it.coverSource || "", "");
  assert.equal(b.api.itemDisplayCoverUrl(it), "", "Needs a pick does not fall back to the unsaved ISBN image");
  // Six list re-renders, as on the review page: paint whatever the card would show.
  for (let i = 0; i < 6; i++) paintCard(b, it);
  const hits = requests.filter((u) => u === OL_TRADE);
  assert.equal(hits.length, 1, "failed ISBN requested once in total (first paint; probe and re-renders skip it): " + JSON.stringify(requests));
});

check("comics: a saved Open Library or Metron cover still displays after the failed-ISBN path exists", async () => {
  const requests = [];
  const b = bootWith([[/\/comic\?/, () => ({ body: comicBody([{ url: METRON, label: "Direct Sales" }]) })]], { Image: imageStub({ requests }) });
  b.seed([{ ...BASE, id: "k5s", type: "comic", series: "Saga", issue: "1", year: 2012, coverUrl: METRON, coverSource: "comiclookup", coverLabel: "Direct Sales" }]);
  assert.equal(b.api.itemDisplayCoverUrl(b.stored()[0]), METRON, "a stored Metron cover is unchanged");
  const olItem = { ...b.stored()[0], id: "k5t", edition: "collected", comicFormat: "Trade Paperback", barcode: TRADE_ISBN, coverUrl: OL_TRADE, coverSource: "openlibrary", enrich: undefined };
  assert.equal(b.api.itemDisplayCoverUrl(olItem), OL_TRADE, "a saved Open Library cover is unchanged");
  const pickButSaved = { ...olItem, enrich: "pick" };
  assert.equal(b.api.itemDisplayCoverUrl(pickButSaved), OL_TRADE, "a stored cover still displays even if the row is Needs a pick");
  assert.equal(requests.length, 0, "displaying a stored URL does not go through the probe");
});

check("comics: several Metron covers on a trade with an ISBN are still Needs a pick, not an Open Library fill", async () => {
  const b = bootWith([[/\/comic\?/, () => ({ body: comicBody([
    { url: METRON, label: "Direct Sales" },
    { url: "https://static.metron.cloud/media/issue/2019/12/10/saga-1b.jpg", label: "Variant", variant: true },
  ]) })]]);
  b.seed([{ ...BASE, id: "k6", type: "comic", series: "Saga", issue: "1", edition: "collected", comicFormat: "Trade Paperback", barcode: TRADE_ISBN, coverUrl: "" }]);
  const q = await queueAndRun(b, ["k6"]);
  const it = b.stored()[0];
  assert.equal(q.pick, 1);
  assert.equal(it.enrich, "pick");
  assert.equal(it.coverUrl, "", "do not guess Open Library when Metron has several covers");
});

(async () => {
  for (const fn of pending) await fn();
  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
