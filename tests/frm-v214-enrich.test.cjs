// V2.14: enrichment bug fixes (Undo, offline, timeouts, Continue at, Retry-After,
// UPCitemdb pacing / CORS / X-RateLimit-Reset, hand-saves, pick counts, storage wording,
// progress bar, in-file CLZ repeats, unclosed CSV quotes, leftover marks write).
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

function bootWith(routes, { store, clock, fetch } = {}) {
  const f = fetch || mockFetch(routes || []);
  const c = clock || H.makeClock();
  const b = H.bootFile(undefined, { fetch: f, store, clock: c });
  return { ...b, fetch: f, clock: c };
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
const UPC_OK = [/upcitemdb/, () => ({ body: { items: [{ title: "Halo 3 Xbox 360" }] } })];

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
  b.api.writeEnrichQueue({ ...b.api.readEnrichQueue(), ids: ["a1"], total: 1, seen: true, dismissed: false, paused: true, reason: "UPCitemdb", until: 0 });
  b.api.enrichOnOnline();
  await tick();
  const q = b.api.readEnrichQueue();
  assert.equal(q.paused, true);
  assert.equal(q.reason, "UPCitemdb");
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
  assert.equal(done.pick, 1);
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

/* ---------- (6) / (c) UPCitemdb pacing is 10s after a real response ---------- */
check("UPCitemdb: pacing is 10s after a real HTTP response, not 2s", async () => {
  const times = [];
  const b = bootWith([
    WIKI_MISS,
    [/upcitemdb/, () => { times.push(b.clock.now); return { body: { items: [{ title: "Halo 3 Xbox 360" }] } }; }],
    IGDB_ONE,
  ]);
  assert.equal(b.api.ENRICH_UPC_DELAY_MS, 10000);
  b.seed([GAME_BC, { ...GAME_BC, id: "g2", barcode: "811949030023" }]);
  await queueAndRun(b, ["g1", "g2"]);
  assert.equal(times.length, 2);
  assert.ok(times[1] - times[0] >= 10000, `UPC calls at ${times[0]} and ${times[1]}`);
  assert.equal(b.api.readEnrichQueue().ids.length, 0);
});

/* ---------- (7) Hand-saved items are not re-marked ---------- */
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

/* ---------- UPCitemdb (a) CORS / network is a quiet no-match ---------- */
check("UPCitemdb CORS: no cap count, no failed mark, no pause; falls through to title / Needs a pick", async () => {
  const b = bootWith([
    WIKI_MISS,
    [/upcitemdb/, () => ({ throw: new TypeError("Failed to fetch") })],
    IGDB_ONE,
  ]);
  b.seed([GAME_BC]);
  const usedBefore = b.api.enrichCapUsed("upcitemdb");
  const q = await queueAndRun(b, ["g1"]);
  assert.ok(b.fetch.calls.some((u) => /upcitemdb/.test(u)), "UPCitemdb was asked");
  assert.ok(b.fetch.calls.some((u) => /\/game\/search\?title=/.test(u)), "fell through to the title search");
  assert.equal(b.api.enrichCapUsed("upcitemdb"), usedBefore, "CORS does not count against the daily cap");
  assert.equal(q.paused, false);
  assert.equal(q.failed, 0);
  assert.equal(b.stored()[0].enrich, "pick", "a title search is Needs a pick, like no barcode match");
  assert.notEqual(q.reason, "offline");
  // A second item after a CORS miss must not wait 10s: lastUpc was not stamped.
});

check("UPCitemdb CORS: no usable title after a miss is Needs lookup, never failed or capped", async () => {
  const b = bootWith([
    WIKI_MISS,
    [/upcitemdb/, () => ({ throw: new TypeError("Failed to fetch") })],
  ]);
  // "x" is too short to be a usable game title, so there is no title search to fall through to.
  b.seed([{ ...BASE, id: "g0", type: "game", title: "x", platform: "Xbox 360", barcode: "882224479325", format: "physical" }]);
  const q = await queueAndRun(b, ["g0"]);
  assert.equal(q.paused, false);
  assert.equal(q.failed, 0);
  assert.equal(b.stored()[0].enrich, "lookup");
  assert.equal(b.api.enrichCapUsed("upcitemdb"), 0);
  assert.equal(b.fetch.calls.some((u) => /\/game\/search/.test(u)), false);
});

check("UPCitemdb CORS: a miss at 99/100 does not trip the daily cap or stamp 10s pacing", async () => {
  const times = [];
  const b = bootWith([
    WIKI_MISS,
    [/upcitemdb/, () => { times.push(b.clock.now); return { throw: new TypeError("Failed to fetch") }; }],
    IGDB_ONE,
  ]);
  const today = new Date(b.clock.now);
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  b.store.set("freerangemedia-enrich-caps", JSON.stringify({ day, n: { upcitemdb: 99 } }));
  b.seed([GAME_BC, { ...GAME_BC, id: "g2", barcode: "811949030023" }]);
  const q = await queueAndRun(b, ["g1", "g2"]);
  assert.equal(q.paused, false, "99 + a CORS miss must not look like the daily cap");
  assert.equal(b.api.enrichCapUsed("upcitemdb"), 99);
  assert.equal(times.length, 2);
  assert.ok(times[1] - times[0] < 10000, "a CORS miss does not stamp the 10s UPCitemdb gap");
});

/* ---------- UPCitemdb (b) X-RateLimit-Reset wins over a shorter Retry-After ---------- */
check("UPCitemdb 429: a readable X-RateLimit-Reset is the stop time; a shorter Retry-After does not win", async () => {
  const b = bootWith([
    WIKI_MISS,
    [/upcitemdb/, () => {
      const reset = Math.floor((b.clock.now + 3600 * 1000) / 1000);
      return { status: 429, headers: { "Retry-After": "10", "X-RateLimit-Reset": String(reset) }, body: { code: "TOO_FAST" } };
    }],
  ]);
  b.seed([GAME_BC, { ...GAME_BC, id: "g2", barcode: "811949030023" }]);
  const t0 = b.clock.now + 20000;
  const q = await queueAndRun(b, ["g1", "g2"]);
  assert.equal(q.paused, true);
  assert.equal(q.reason, "UPCitemdb");
  assert.deepEqual([...q.ids], ["g1", "g2"]);
  assert.ok(q.until >= t0 + 3600 * 1000 - 1000, `until ${q.until} must be the Reset, not Retry-After 10s (t0=${t0})`);
  assert.ok(q.until - t0 > 60 * 1000, "must not retry after 10s or the 60s default");
  assert.equal(b.fetch.calls.filter((u) => /upcitemdb/.test(u)).length, 1, "one request, then stop");
  assert.equal(b.api.enrichCapUsed("upcitemdb"), 1, "a readable 429 is a real answer and counts");
});

(async () => {
  for (const fn of pending) await fn();
  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
