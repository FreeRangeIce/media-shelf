// V2.11: import enrichment after ANY successful import, the confirmed CLZ Comics mapping, and a
// regression check that every fixture row lands exactly as it did in V2.10 (bae67d0).
// Real app.js in a vm with storage/DOM doubles and a mocked fetch. No network, no browser.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./helpers/import-harness.cjs");
const { landingFor } = require("./helpers/import-landing.cjs");

const FIX = path.join(__dirname, "fixtures");
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const sw = fs.readFileSync(path.join(__dirname, "../sw.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../styles.css"), "utf8");
let passed = 0;
const pending = [];
function check(name, fn) {
  pending.push(async () => {
    await fn();
    passed += 1;
    console.log("PASS", name);
  });
}

/** Independent RFC 4180 reader (not the app's parser) for cross-checking cells. */
function readCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ""));
}

/** Mock fetch: routes are [RegExp, (url) => { status, body, headers }]; every call is logged. */
function mockFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    const u = String(url);
    calls.push(u);
    for (const [re, h] of routes) {
      if (re.test(u)) {
        const r = h(u) || {};
        return new Response(r.body === undefined ? "{}" : JSON.stringify(r.body), { status: r.status || 200, headers: r.headers || { "Content-Type": "application/json" } });
      }
    }
    return new Response("{}", { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

function bootWith(routes, { store, clock } = {}) {
  const fetch = mockFetch(routes);
  const c = clock || H.makeClock();
  const b = H.bootFile(undefined, { fetch, store, clock: c });
  return { ...b, fetch, clock: c };
}

const BASE = { status: "owned", sources: ["clz"], dateAdded: "2026-11-14T00:00:00.000Z", dateUpdated: "2026-11-14T00:00:00.000Z" };
const MB_RELEASE = (id, barcode) => ({ id, title: "OK Computer", barcode, score: 100, date: "1997-06-16", "artist-credit": [{ name: "Radiohead" }], "release-group": { id: "rg-1" } });
const MB_ROUTES = (releases) => [
  [/musicbrainz\.org\/ws\/2\/release\/\?/, () => ({ body: { releases } })],
  [/musicbrainz\.org\/ws\/2\/release-group\//, () => ({ body: { "first-release-date": "1997-05-21" } })],
  [/coverartarchive\.org\/release\//, () => ({ body: { images: [{ front: true, thumbnails: { 500: "https://coverartarchive.org/release/r1/front-500.jpg" } }] } })],
];

async function queueAndRun(b, ids) {
  b.api.enqueueEnrich(ids);
  b.clock.now += 20000; // past the import's Undo window
  await b.api.runEnrich();
  return b.api.readEnrichQueue();
}

/* ---------- 1. CLZ Comics mapping against Micah's real export ---------- */
const REAL = fs.readFileSync(path.join(FIX, "clz-comics-micah.csv"), "utf8");
const REAL_ROWS = readCsv(REAL);

check("Micah's export: headers exactly Series, Issue, Variant Description, Publisher, Release Date, Format, Added Date", () => {
  assert.deepEqual(REAL_ROWS[0], ["Series", "Issue", "Variant Description", "Publisher", "Release Date", "Format", "Added Date"]);
  const { api } = H.bootFile();
  const parsed = api.parseClzCsv(REAL);
  assert.deepEqual([...parsed.headers], REAL_ROWS[0]);
  const m = api.clzAutoMapping("comics", parsed.headers);
  assert.deepEqual({ ...m }, { series: 0, issue: 1, publisher: 3, year: 4, variant: 2, format: 5 });
  assert.equal(Object.values(m).includes(6), false, "Added Date is not imported");
  // The type check still reads it as a Comics export, not another type.
  const scores = ["comics", "games", "movies", "books", "music"].map((k) => api.clzScore(k, parsed.headers));
  assert.ok(scores[0] > Math.max(...scores.slice(1)), String(scores));
});

check("Micah's export: every one of the 744 rows maps (series, issue, variant, publisher, year, format); none skipped", () => {
  const { api } = H.bootFile();
  const land = H.landClz(api, "comics", REAL);
  assert.equal(REAL_ROWS.length - 1, 744);
  assert.equal(land.rows.length, 744);
  assert.equal(land.rows.filter((r) => r.skip).length, 0);
  const counts = { issue: 0, collected: 0, unknown: 0, digital: 0, variant: 0, noYear: 0, issueCut: 0 };
  land.rows.forEach((r, i) => {
    const [series, issue, variant, publisher, release, format] = REAL_ROWS[i + 1];
    const it = r.item;
    const tidy = (s) => s.replace(/\s+/g, " ").trim();
    assert.equal(it.type, "comic");
    assert.equal(it.series, tidy(series), `row ${r.row} series`);
    // The stored issue is CLZ's text (cover letter included), cut at 20 characters as before.
    assert.equal(it.issue, tidy(issue).slice(0, 20), `row ${r.row} issue`);
    if (it.issue !== tidy(issue)) counts.issueCut++;
    assert.equal(it.publisher, tidy(publisher), `row ${r.row} publisher`);
    const y = (release.match(/\b(1[89]\d\d|20\d\d)\b/) || [])[1];
    assert.equal(it.year, y ? Number(y) : null, `row ${r.row} year from "${release}"`);
    if (it.year == null) counts.noYear++;
    assert.equal(it.coverLabel, tidy(variant).slice(0, 120), `row ${r.row} variant`);
    if (it.coverLabel) counts.variant++;
    assert.equal(it.comicFormat, tidy(format) || undefined, `row ${r.row} format label`);
    counts[it.edition || "unknown"]++;
    if (it.format === "digital") counts.digital++;
    assert.equal(it.format, /digital/i.test(format) ? "digital" : "physical", `row ${r.row} physical/digital`);
    assert.equal(it.status, "owned");
    assert.equal(it.enrich, undefined, "nothing is marked at import time");
  });
  console.log("   real export:", JSON.stringify(counts));
  assert.deepEqual(counts, { issue: 687, collected: 53, unknown: 4, digital: 1, variant: 239, noYear: 6, issueCut: 1 });
});

check("Comics fixture (same headers): issues vs collected editions, variants, dates, empty fields", () => {
  const { api } = H.bootFile();
  const land = H.landClz(api, "comics", fs.readFileSync(path.join(FIX, "clz-comics-fixture.csv"), "utf8"));
  const by = (row) => land.rows.find((r) => r.row === row).item;
  const pick = (it) => ({ series: it.series, issue: it.issue, coverLabel: it.coverLabel, coverVariant: it.coverVariant, publisher: it.publisher, year: it.year, comicFormat: it.comicFormat, edition: it.edition, format: it.format });
  assert.deepEqual(pick(by(2)), { series: "52", issue: "26", coverLabel: "", coverVariant: false, publisher: "DC Comics", year: 2006, comicFormat: "Comic", edition: "issue", format: "physical" });
  assert.deepEqual(pick(by(3)), { series: "Action Comics, Vol. 1", issue: "812B", coverLabel: "Second Print", coverVariant: false, publisher: "DC Comics", year: 2004, comicFormat: "Comic", edition: "issue", format: "physical" });
  assert.equal(by(4).coverLabel, "Rafael Albuquerque Regular Cover");
  assert.equal(by(4).coverVariant, false, "a Regular cover is not a variant");
  assert.equal(by(5).coverVariant, true, "1st Print, Variant Cover");
  assert.equal(by(6).issue, "3.1A");
  for (const row of [7, 8, 9, 10, 11, 13, 16]) assert.equal(by(row).edition, "collected", `row ${row}`);
  assert.equal(by(7).comicFormat, "Trade Paperback");
  assert.equal(by(9).comicFormat, "Hardcover");
  assert.equal(by(11).issue, "", "a collected edition with no issue number keeps an empty issue");
  assert.equal(by(12).edition, "issue", "Squarebound is a single issue");
  assert.deepEqual([by(14).format, by(14).edition, by(14).year], ["digital", "issue", null], "Digital Comic, blank Release Date");
  assert.deepEqual([by(15).publisher, by(15).comicFormat, by(15).edition], ["", undefined, undefined], "blank Publisher and Format stay blank");
  // The issue number sent to the comic lookup drops CLZ's cover letter / TP mark; the stored issue doesn't.
  assert.deepEqual(["812B", "1A", "3.1A", "1TP", "HC", "TP-A", "0", ""].map(api.clzComicIssue), ["812", "1", "3.1", "1", "", "", "0", ""]);
});

/* ---------- 2. Regression: rows land the same as V2.10 ---------- */
const BASELINE = JSON.parse(fs.readFileSync(path.join(FIX, "import-baseline-v2.10.json"), "utf8"));
const COMIC_NEW_KEYS = ["coverLabel", "coverVariant", "comicFormat", "edition", "format"];

check("regression: every non-comic CLZ row and every Import games line lands byte-for-byte as in V2.10", () => {
  const now = landingFor(app);
  for (const [file, base] of Object.entries(BASELINE.clz)) {
    if (base.type === "comics") continue;
    assert.deepEqual(now.clz[file], base, file);
  }
  assert.deepEqual(now.gamesPaste, BASELINE.gamesPaste, "Import games paste/CSV");
});

check("regression: comic rows land as in V2.10 plus only the new Variant / Format fields", () => {
  const now = landingFor(app);
  let changedRows = 0;
  for (const [file, base] of Object.entries(BASELINE.clz)) {
    if (base.type !== "comics") continue;
    const cur = now.clz[file];
    assert.deepEqual(cur.headers, base.headers);
    for (const [k, v] of Object.entries(base.mapping)) assert.equal(cur.mapping[k], v, `${file} mapping ${k}`);
    assert.equal(cur.rows.length, base.rows.length);
    cur.rows.forEach((r, i) => {
      const b = base.rows[i];
      assert.equal(r.skip, b.skip, `${file} row ${r.row} skip`);
      const strip = (it) => Object.fromEntries(Object.entries(it).filter(([k]) => !COMIC_NEW_KEYS.includes(k)));
      assert.deepEqual(strip(r.item), strip(b.item), `${file} row ${r.row}`);
      // In V2.10 the new fields were always at their defaults.
      assert.equal(b.item.coverLabel, "");
      assert.equal(b.item.coverVariant, false);
      assert.equal(b.item.format, "physical");
      if (COMIC_NEW_KEYS.some((k) => JSON.stringify(r.item[k]) !== JSON.stringify(b.item[k]))) changedRows++;
    });
  }
  assert.ok(changedRows > 0);
});

check("regression: items without the new fields normalize unchanged (Remove last import fingerprints stay valid)", () => {
  const { api } = H.bootFile();
  for (const raw of [{ id: "b", type: "book", title: "Dune" }, { id: "c", type: "comic", series: "Saga", issue: "1" }, { id: "g", type: "game", title: "Hades", platform: "Steam" }]) {
    const a = api.normalizeItem({ ...raw, dateAdded: "x", dateUpdated: "x" });
    assert.equal("enrich" in a, false);
    assert.equal("comicFormat" in a, false);
    assert.equal("edition" in a, false);
  }
  const marked = api.normalizeItem({ id: "m", type: "book", title: "X", enrich: "pick" });
  assert.equal(marked.enrich, "pick");
  assert.equal(api.normalizeItem({ id: "m", type: "book", title: "X", enrich: "bogus" }).enrich, undefined);
});

/* ---------- 3. Fill only empty fields ---------- */
check("no overwrite: a match fills only empty fields; status, format, barcode, notes and typed values never change", () => {
  const { api } = H.bootFile();
  const data = { title: "Other Title", creator: "Someone Else", year: 1999, coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg", coverSource: "openlibrary", googleBooksUrl: "https://books.google.com/books?id=x" };
  const full = api.normalizeItem({ ...BASE, id: "1", type: "book", title: "Dune", creator: "Frank Herbert", year: 1965, coverUrl: "https://example.com/mine.jpg", coverSource: "manual", barcode: "9780441172719", notes: "mine" });
  assert.deepEqual({ ...api.enrichFillEmpty(full, data) }, { googleBooksUrl: data.googleBooksUrl });
  const empty = api.normalizeItem({ ...BASE, id: "2", type: "book", title: "Dune", barcode: "9780441172719", signed: true });
  const f = api.enrichFillEmpty(empty, data);
  assert.equal(f.title, undefined, "a title from the CSV is kept");
  assert.equal(f.creator, "Someone Else");
  assert.equal(f.year, 1999);
  assert.equal(f.coverUrl, data.coverUrl);
  assert.deepEqual(JSON.parse(JSON.stringify(f.authors)), [{ name: "Someone Else", signed: true }], "the CSV's Signed flag is kept");
  for (const k of ["status", "format", "disc", "barcode", "notes", "tags", "rating", "sources"]) assert.equal(k in f, false, k);
  assert.equal(api.enrichFillEmpty(empty, { coverUrl: "http://insecure.example/x.jpg" }).coverUrl, undefined, "only https covers");
  const game = api.normalizeItem({ ...BASE, id: "3", type: "game", title: "Halo 3", platform: "Xbox 360", year: 2007 });
  const g = api.enrichFillEmpty(game, { title: "Halo 3: ODST", creator: "Bungie", year: 2009, platform: "Xbox One", igdbId: "123", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg", coverSource: "igdb", coverSourceId: "123" });
  assert.deepEqual(Object.keys(g).sort(), ["coverPlatform", "coverSource", "coverSourceId", "coverUrl", "creator", "igdbId"].sort());
});

/* ---------- 4. Single-match rule, Needs a pick, Needs lookup ---------- */
check("music: one release with the barcode auto-fills empty fields only; two releases -> Needs a pick, nothing filled", async () => {
  for (const [releases, expect] of [[[MB_RELEASE("r1", "724385522925")], "enriched"], [[MB_RELEASE("r1", "724385522925"), MB_RELEASE("r2", "0724385522925")], "pick"]]) {
    const b = bootWith(MB_ROUTES(releases));
    b.seed([{ ...BASE, id: "m1", type: "music", title: "OK Computer", barcode: "724385522925", year: 1997, format: "physical", disc: "cd" }]);
    const q = await queueAndRun(b, ["m1"]);
    const it = b.stored()[0];
    if (expect === "enriched") {
      assert.equal(q.enriched, 1);
      assert.equal(it.creator, "Radiohead");
      assert.equal(it.coverUrl, "https://coverartarchive.org/release/r1/front-500.jpg");
      assert.equal(it.year, 1997, "the CSV year stays");
      assert.equal(it.enrich, undefined);
    } else {
      assert.equal(q.pick, 1);
      assert.equal(it.enrich, "pick");
      assert.equal(it.creator, "");
      assert.equal(it.coverUrl, "");
    }
    assert.equal(it.status, "owned");
    assert.equal(it.disc, "cd");
    assert.equal(it.dateUpdated, BASE.dateUpdated, "enrichment never bumps dateUpdated");
  }
});

check("books: an ISBN match fills; a title-only book with exactly one search result is still Needs a pick", async () => {
  const b = bootWith([
    [/openlibrary\.org\/isbn\//, () => ({ body: { title: "Dune", publish_date: "1965", covers: [42], authors: [{ key: "/authors/A1" }] } })],
    [/openlibrary\.org\/authors\//, () => ({ body: { name: "Frank Herbert" } })],
    [/openlibrary\.org\/search\.json/, () => ({ body: { docs: [{ title: "No ISBN Book", author_name: ["Some Author"], first_publish_year: 2001, cover_i: 7 }] } })],
    [/googleapis/, () => ({ body: { items: [] } })],
    [/wikipedia/, () => ({ status: 404 })],
  ]);
  b.seed([
    { ...BASE, id: "b1", type: "book", title: "Dune", barcode: "9780441172719", format: "physical" },
    { ...BASE, id: "b2", type: "book", title: "No ISBN Book", creator: "Some Author", year: 2001, format: "physical" },
  ]);
  const q = await queueAndRun(b, ["b1", "b2"]);
  const [b1, b2] = ["b1", "b2"].map((id) => b.stored().find((i) => i.id === id));
  assert.equal(b1.creator, "Frank Herbert");
  assert.equal(b1.coverUrl, "https://covers.openlibrary.org/b/id/42-L.jpg");
  assert.equal(b1.year, 1965);
  assert.equal(b1.title, "Dune");
  assert.equal(b2.enrich, "pick");
  assert.equal(b2.coverUrl, "", "a title search never fills anything");
  assert.deepEqual([q.enriched, q.pick, q.lookup, q.failed, q.done, q.total, q.ids.length], [1, 1, 0, 0, 2, 2, 0]);
});

check("games: barcode -> one IGDB match on the platform auto-fills; two -> Needs a pick; title-only -> Needs a pick", async () => {
  const igdb = (n) => Array.from({ length: n }, (_, i) => ({ igdbId: 100 + i, title: "Halo 3", creator: "Bungie", year: 2007, platforms: ["Xbox 360"], coverUrl: `https://images.igdb.com/igdb/image/upload/t_cover_big/h${i}.jpg` }));
  for (const [n, expect] of [[1, "enriched"], [2, "pick"]]) {
    const b = bootWith([
      [/query\.wikidata\.org/, () => ({ body: { results: { bindings: [{ itemLabel: { value: "Halo 3" }, platLabel: { value: "Xbox 360" } }] } } })],
      [/\/game\/search\?title=/, () => ({ body: { candidates: igdb(n) } })],
    ]);
    b.seed([{ ...BASE, id: "g1", type: "game", title: "Halo 3", platform: "Xbox 360", barcode: "882224479325", year: 2007, format: "physical" }]);
    const q = await queueAndRun(b, ["g1"]);
    const it = b.stored()[0];
    if (expect === "enriched") {
      assert.equal(q.enriched, 1);
      assert.equal(it.igdbId, "100");
      assert.equal(it.creator, "Bungie");
      assert.match(it.coverUrl, /h0\.jpg$/);
      assert.equal(it.platform, "Xbox 360");
    } else {
      assert.equal(q.pick, 1);
      assert.equal(it.enrich, "pick");
      assert.equal(it.igdbId, "");
    }
    assert.equal(b.fetch.calls.some((u) => /upcitemdb/.test(u)), false, "UPCitemdb only when Wikidata misses");
  }
  const t = bootWith([[/\/game\/search\?title=/, () => ({ body: { candidates: igdb(1) } })]]);
  t.seed([{ ...BASE, id: "g2", type: "game", title: "Halo 3", platform: "Xbox 360", status: "want", sources: ["csv"] }]);
  const q = await queueAndRun(t, ["g2"]);
  assert.equal(q.pick, 1, "a title search with one result is still a pick");
  assert.equal(t.stored()[0].enrich, "pick");
  assert.equal(t.stored()[0].igdbId, "");
  assert.equal(t.stored()[0].status, "want", "Want stays Want (Wishlist)");
});

check("comics: series + issue + year is a title search -> Needs a pick, never auto-filled; no number -> Needs lookup", async () => {
  const b = bootWith([[/frm-gcd\.freerangeice\.workers\.dev\/comic\?/, (u) => ({ body: { match: { series: "Action Comics", issue: "812", year: 2004, publisher: "DC", writer: ["Chuck Austen"], artist: [], sourceId: "gcd-issue-1", sourceName: "Grand Comics Database", sourceUrl: "https://www.comics.org/issue/1/" }, variants: [{ sourceId: "gcd-issue-1", label: "Direct", variant: false, image: "https://static.metron.cloud/x.jpg" }], covers: [{ sourceId: "gcd-issue-1", url: "https://static.metron.cloud/x.jpg", label: "Direct", variant: false }], total: 1 } })]]);
  const { api } = b;
  const land = H.landClz(api, "comics", fs.readFileSync(path.join(FIX, "clz-comics-fixture.csv"), "utf8"));
  const rows = [land.rows[1].item, land.rows[9].item].map((it, i) => ({ ...it, id: `c${i}` })); // 812B, and a HC with no number
  b.seed(rows);
  const q = await queueAndRun(b, ["c0", "c1"]);
  const [c0, c1] = b.stored();
  assert.equal(c0.enrich, "pick");
  assert.equal(c0.coverUrl, "", "even one cover is not attached from a title search");
  assert.equal(c0.writer, "");
  assert.equal(c0.coverLabel, "Second Print", "the CSV variant stays");
  assert.equal(c1.enrich, "lookup");
  const asked = b.fetch.calls.filter((u) => /\/comic\?/.test(u));
  assert.equal(asked.length, 1, "the comic without a number is never sent");
  assert.match(asked[0], /issue=812(&|$)/, "CLZ's cover letter is dropped for the lookup");
  assert.match(asked[0], /year=2004/);
  assert.deepEqual([q.pick, q.lookup], [1, 1]);
});

check("too little data or no source -> Needs lookup with no request; a movie barcode alone is never sent", async () => {
  const b = bootWith([]);
  b.seed([
    { ...BASE, id: "x1", type: "movie", title: "", barcode: "024543546345", format: "physical", disc: "dvd" },
    { ...BASE, id: "x2", type: "comic", series: "Saga", issue: "" },
  ]);
  const q = await queueAndRun(b, ["x1", "x2"]);
  assert.deepEqual(b.stored().map((i) => i.enrich), ["lookup", "lookup"]);
  assert.equal(b.fetch.calls.length, 0);
  assert.equal(q.lookup, 2);
  const src = b.api.enrichSources();
  assert.deepEqual([...src.movie.barcode], []);
  assert.deepEqual([...src.comic.barcode], []);
  assert.deepEqual([...src.tabletop.barcode, ...src.tabletop.title], []);
});

check("errors leave the row as imported: one retry, then failed + Needs lookup; 3 failures in a row pause", async () => {
  const b = bootWith([[/musicbrainz/, () => ({ status: 500 })]]);
  b.seed([1, 2, 3, 4].map((n) => ({ ...BASE, id: `e${n}`, type: "music", title: `Album ${n}`, creator: "Band" })));
  const q = await queueAndRun(b, ["e1", "e2", "e3", "e4"]);
  assert.equal(q.paused, true);
  assert.equal(q.reason, "errors");
  assert.equal(q.failed, 0, "first failures are retried later, not counted yet");
  assert.equal(q.ids.length, 4, "nothing skipped");
  assert.ok(b.stored().every((i) => i.enrich === undefined && i.creator === "Band"));
});

/* ---------- 5. Daily caps: pause, keep the place, resume on the next open ---------- */
check("UPCitemdb local cap (100/day): pause with the item still first, nothing asked, resume after midnight on reopen", async () => {
  const routes = [
    [/query\.wikidata\.org/, () => ({ body: { results: { bindings: [] } } })],
    [/upcitemdb/, () => ({ body: { items: [{ title: "Halo 3 Xbox 360" }] } })],
    [/\/game\/search\?title=/, () => ({ body: { candidates: [{ igdbId: 7, title: "Halo 3", creator: "Bungie", year: 2007, platforms: ["Xbox 360"], coverUrl: "" }] } })],
  ];
  const b = bootWith(routes);
  const today = new Date(b.clock.now);
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  b.store.set("freerangemedia-enrich-caps", JSON.stringify({ day, n: { upcitemdb: 100 } }));
  b.seed([{ ...BASE, id: "u1", type: "game", title: "Halo 3", platform: "Xbox 360", barcode: "882224479325" }, { ...BASE, id: "u2", type: "game", title: "Halo 3", platform: "Xbox 360", barcode: "882224479325" }]);
  const q = await queueAndRun(b, ["u1", "u2"]);
  assert.equal(q.paused, true);
  assert.equal(q.reason, "UPCitemdb");
  assert.deepEqual([...q.ids], ["u1", "u2"], "position kept: the capped item stays first");
  assert.ok(q.until > b.clock.now);
  assert.equal(b.fetch.calls.filter((u) => /upcitemdb/.test(u)).length, 0, "never asked past the cap");
  assert.equal(b.api.enrichSummaryText(q), "", "all zero: no counts line; the pause has its own two lines");
  const [p1, p2] = b.api.enrichPauseLines(q);
  assert.equal(p1, "Paused: UPCitemdb’s daily limit.");
  assert.match(p2, /^2 items will continue when you open the app after (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d{2}\s?(AM|PM)\.$/);
  assert.ok(p2.endsWith(`${b.api.enrichResumeClock(q.until)}.`), "computed from the real resume time");
  // Reopen before the cap ends: still paused, no request.
  const early = bootWith(routes, { store: b.store, clock: { ...H.makeClock(b.clock.now + 60000) } });
  early.api.resumeEnrichOnOpen();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(early.fetch.calls.length, 0);
  // Reopen the next day: resumes from u1 and finishes.
  const next = bootWith(routes, { store: b.store, clock: H.makeClock(q.until + 1000) });
  next.api.resumeEnrichOnOpen();
  for (let i = 0; i < 50 && next.api.readEnrichQueue().ids.length; i++) await new Promise((r) => setTimeout(r, 10));
  const done = next.api.readEnrichQueue();
  assert.equal(done.ids.length, 0);
  assert.equal(done.enriched, 2);
  assert.equal(next.fetch.calls.filter((u) => /upcitemdb/.test(u)).length, 2);
  assert.ok(next.stored().every((i) => i.igdbId === "7"));
});

check("a relay 429 with Retry-After pauses until then; the comic relay's busy answer too; never retried in a loop", async () => {
  const b = bootWith([[/\/game\/search\?title=/, () => ({ status: 429, headers: { "Retry-After": "7200" }, body: { error: "app_daily_limit" } })]]);
  b.seed([{ ...BASE, id: "r1", type: "game", title: "Celeste", platform: "Switch" }, { ...BASE, id: "r2", type: "game", title: "Hades", platform: "Steam" }]);
  const t0 = b.clock.now;
  const q = await queueAndRun(b, ["r1", "r2"]);
  assert.equal(q.paused, true);
  assert.deepEqual([...q.ids], ["r1", "r2"]);
  assert.ok(q.until >= t0 + 7200 * 1000, "Retry-After honoured");
  assert.equal(b.fetch.calls.length, 1, "one request, then stop");
  const c = bootWith([[/\/comic\?/, () => ({ status: 503, headers: { "Retry-After": "120" }, body: { error: "busy" } })]]);
  c.seed([{ ...BASE, id: "k1", type: "comic", series: "Saga", issue: "1" }]);
  const cq = await queueAndRun(c, ["k1"]);
  assert.equal(cq.paused, true);
  assert.deepEqual([...cq.ids], ["k1"]);
  assert.equal(c.stored()[0].enrich, undefined);
});

check("games: a CLZ platform name (Nintendo Switch, PlayStation 5) still matches IGDB's platform for a single barcode match", async () => {
  for (const [plat, igdbPlat] of [["Nintendo Switch", "Nintendo Switch"], ["PlayStation 5", "PlayStation 5"], ["PS Vita", "PlayStation Vita"]]) {
    const b = bootWith([
      [/query\.wikidata\.org/, () => ({ body: { results: { bindings: [] } } })],
      [/upcitemdb/, () => ({ body: { items: [{ title: `Some Game (${igdbPlat})` }] } })],
      [/\/game\/search\?title=/, () => ({ body: { candidates: [{ igdbId: 9, title: "Some Game", creator: "Studio", year: 2020, platforms: [igdbPlat], coverUrl: "" }] } })],
    ]);
    b.seed([{ ...BASE, id: "p1", type: "game", title: "Some Game", platform: plat, barcode: "811949030023", format: "physical" }]);
    const q = await queueAndRun(b, ["p1"]);
    const it = b.stored()[0];
    if (plat === "PS Vita") {
      // No IGDB alias for Vita in gamePlatformMatches: never guessed, the owner picks.
      assert.equal(q.pick, 1, plat);
      assert.equal(it.igdbId, "");
    } else {
      assert.equal(q.enriched, 1, plat);
      assert.equal(it.igdbId, "9", plat);
      assert.equal(it.platform, plat, "the imported platform text is kept");
    }
  }
});

check("a UPCitemdb 429 names UPCitemdb in the pause and keeps every item queued", async () => {
  const b = bootWith([
    [/query\.wikidata\.org/, () => ({ body: { results: { bindings: [] } } })],
    [/upcitemdb/, () => ({ status: 429, headers: { "Retry-After": "86400" }, body: { code: "TOO_FAST" } })],
  ]);
  b.seed([{ ...BASE, id: "q1", type: "game", title: "Halo 3", platform: "Xbox 360", barcode: "882224479325" }, { ...BASE, id: "q2", type: "game", title: "Celeste", platform: "Switch", barcode: "811949030023" }]);
  const q = await queueAndRun(b, ["q1", "q2"]);
  assert.equal(q.paused, true);
  assert.equal(q.reason, "UPCitemdb");
  assert.deepEqual([...q.ids], ["q1", "q2"]);
  assert.equal(b.fetch.calls.filter((u) => /upcitemdb/.test(u)).length, 1, "one request, then stop");
});

check("short busy pauses resume in-session at most 3 times in a row, then wait for Resume or the next open", async () => {
  const c = bootWith([[/\/comic\?/, () => ({ status: 503, headers: { "Retry-After": "60" }, body: { error: "busy" } })]]);
  c.seed([{ ...BASE, id: "k1", type: "comic", series: "Saga", issue: "1" }]);
  c.api.enqueueEnrich(["k1"]);
  for (let i = 0; i < 400; i++) await new Promise((r) => setTimeout(r, 1));
  const asked = c.fetch.calls.filter((u) => /\/comic\?/.test(u)).length;
  assert.ok(asked >= 1 && asked <= 4, `asked ${asked} times`);
  const q = c.api.readEnrichQueue();
  assert.equal(q.paused, true);
  assert.deepEqual([...q.ids], ["k1"], "nothing skipped");
});

/* ---------- 6. Summary ---------- */
check("summary counts: only nonzero counts, on screen and for screen readers", () => {
  const { api } = H.bootFile();
  const q = { ...api.readEnrichQueue(), enriched: 12, pick: 30, lookup: 1, failed: 2, complete: 0, ids: [], paused: false };
  assert.equal(api.enrichSummaryText(q), "12 enriched · 30 need a pick · 1 needs lookup · 2 failed");
  assert.equal(api.enrichSummaryText({ ...q, pick: 1, complete: 3, paused: true, ids: ["a", "b"] }), "12 enriched · 1 needs a pick · 1 needs lookup · 2 failed · 3 already complete");
  assert.equal(api.enrichSummaryText({ ...q, enriched: 4, pick: 4, lookup: 0, failed: 0 }), "4 enriched · 4 need a pick");
  assert.equal(api.enrichSummaryText({ ...q, enriched: 0, pick: 0, lookup: 0, failed: 0 }), "");
  assert.doesNotMatch(app, /paused at cap/, "no 'paused at cap' count");
  // The screen-reader line is built from the same summary text (plus the pause lines), never zeros.
  assert.match(app, /const said = \[line\.replace\(\/\\\.\$\/, ""\), pauseLines \? pauseLines\[1\]\.replace\(\/\\\.\$\/, ""\) : "", enrichSummaryText\(q\)\]\.filter\(Boolean\);/);
  assert.match(app, /counts\.hidden = !countText;/);
});

check("paused: two plain lines from the real resume time; one item reads singular; progress bar hidden", () => {
  const { api } = H.bootFile();
  const until = Date.parse("2026-11-16T09:05:00-08:00");
  const real = Date.now;
  const q = { ...api.readEnrichQueue(), ids: ["a"], total: 8, paused: true, reason: "UPCitemdb", until: Date.now() + 86400000 };
  const lines = api.enrichPauseLines(q);
  assert.equal(lines[0], "Paused: UPCitemdb’s daily limit.");
  assert.match(lines[1], /^1 item will continue when you open the app after /);
  assert.equal(api.enrichResumeClock(until), new Date(until).toLocaleDateString("en-US", { weekday: "short" }) + " " + new Date(until).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
  assert.match(api.enrichResumeClock(until), /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d{2}\s?(AM|PM)$/);
  assert.equal(Date.now, real);
  assert.doesNotMatch(app, /Paused at a daily limit after/, "the 'after 0 of 8' line is gone");
  assert.match(app, /bar\.hidden = !\(showRun && active && !q\.paused\);/);
});

check("progress bar: fills to the shown count, #8B5E3C on #3a3a3a, 4px, rounded ends", () => {
  assert.match(app, /const shown = Math\.max\(1, pos\);/);
  assert.match(app, /line = `Enriching \$\{shown\.toLocaleString\(\)\} of/);
  assert.match(app, /\$\("#enrich-bar-fill"\)\.style\.width = `\$\{q\.total \? Math\.round\(\(Math\.min\(shown, q\.total\) \/ q\.total\) \* 100\) : 0\}%`;/);
  const block = css.slice(css.indexOf("========== V2.11 import enrichment"));
  assert.match(block, /\.enrich-bar \{\s*height: 4px;\s*border-radius: 2px;\s*background: #3a3a3a;/);
  assert.match(block, /\.enrich-bar-fill \{[^}]*border-radius: 2px;[^}]*background: #8B5E3C;/);
  assert.match(block, /\.enrich-actions \{[^}]*gap: 8px;/);
  assert.match(html, /id="btn-enrich-all" hidden>Show all<\/button>/);
});

check("progress UI: role=status, in the page flow above the list, 44px buttons, reduced motion, hidden on Profile", () => {
  assert.match(html, /<section id="enrich-status"[^>]*hidden>/);
  assert.match(html, /id="enrich-sr" class="sr-only" role="status" aria-live="polite"/);
  assert.ok(html.indexOf('id="enrich-status"') < html.indexOf('id="item-list"') || html.indexOf('id="enrich-status"') < html.indexOf("frm-bottom-nav"), "before the list / nav");
  assert.ok(html.indexOf('id="enrich-status"') < html.indexOf("frm-bottom-nav"));
  const block = css.slice(css.indexOf("========== V2.11 import enrichment"));
  assert.doesNotMatch(block, /position:\s*(fixed|sticky|absolute)/, "never floats over the nav or Add");
  assert.match(block, /\.enrich-btn \{[^}]*min-height: var\(--tap\)/);
  assert.match(block, /prefers-reduced-motion: reduce\) \{\s*\.enrich-bar-fill \{ transition: none; \}/);
  assert.match(css, /body\.frm-profile-open #enrich-status/);
  for (const id of ["btn-enrich-pick", "btn-enrich-lookup", "btn-enrich-all", "btn-enrich-resume", "btn-enrich-dismiss"]) assert.match(html, new RegExp(`id="${id}"`));
});

check("Needs a pick / Needs lookup filter keeps the Library / Wishlist split; detail offers the usual Lookup", () => {
  const { api } = H.bootFile();
  assert.match(app, /if \(filterEnrich\) list = list\.filter\(\(i\) => i\.enrich === filterEnrich\);/);
  // The filter runs after the shelf split, so Want items stay on the Wishlist.
  const listFn = app.slice(app.indexOf('if (shelfMode === "wishlist") {\n      list = list.filter((i) => isWantStatus(i.status));'), app.indexOf("if (filterEnrich) list = list.filter"));
  assert.ok(listFn.length > 0 && listFn.length < 1200);
  const d = api.detailHtml(api.normalizeItem({ id: "p1", type: "book", title: "X", enrich: "pick" }));
  assert.match(d, /Needs a pick/);
  assert.match(d, /data-enrich-lookup="p1"/);
  assert.match(d, /class="btn btn-primary enrich-detail-btn" data-enrich-lookup/, "Look up is the filled primary");
  for (const mark of ["pick", "lookup"]) {
    const g = api.detailHtml(api.normalizeItem({ id: "g1", type: "game", title: "Crisis Core", platform: "PSP", enrich: mark }));
    const badges = g.slice(g.indexOf('<div class="tt-detail-badges">'), g.indexOf("</div>"));
    assert.match(badges, /class="card-ref enrich-badge-ref"[^>]*>IGDB<\/a>/, `${mark}: IGDB pill on the badge row`);
    assert.doesNotMatch(g, /<div class="card-refs">/, `${mark}: no lone pill on the right`);
  }
  const plain = api.detailHtml(api.normalizeItem({ id: "g2", type: "game", title: "Crisis Core", platform: "PSP" }));
  assert.match(plain, /<div class="card-refs"><a class="card-ref" [^>]*>IGDB<\/a><\/div>/, "unmarked items unchanged");
  assert.doesNotMatch(plain, /enrich-badge-ref/);
  assert.match(app, /edit\.classList\.toggle\("btn-primary", !marked\);\s*edit\.classList\.toggle\("btn-outline", marked\);/, "Edit outlined only on marked items");
  assert.doesNotMatch(api.detailHtml(api.normalizeItem({ id: "p2", type: "book", title: "X" })), /data-enrich-lookup/);
  assert.match(api.detailHtml(api.normalizeItem({ id: "c", type: "comic", series: "S", issue: "1", comicFormat: "Trade Paperback", edition: "collected" })), /Trade Paperback \(collected edition\)/);
  // Saving from the form answers the mark; manual Lookup code paths are untouched.
  assert.match(app, /delete merged\.enrich;/);
  assert.match(app, /els\.btnLookup\.addEventListener\("click", \(\) => runLookup\(\)\);/);
});

/* ---------- 7. Imports queue; restore never does ---------- */
check("Import CLZ and Import games both queue their new items; a backup restore (Replace or Merge) queues nothing", async () => {
  const b = bootWith([]);
  b.seed([]);
  const item = b.api.normalizeItem({ id: "incoming", type: "comic", series: "Saga", issue: "1", status: "owned", sources: ["clz"] });
  b.api.setClz({ typeKey: "comics", evals: [{ kind: "new", item }], choices: new Map() });
  b.api.commitClz();
  let q = b.api.readEnrichQueue();
  assert.equal(q.ids.length, 1);
  assert.equal(b.stored().length, 1);
  assert.equal(b.stored()[0].series, "Saga", "the import landed before any lookup");
  assert.equal(b.fetch.calls.length, 0, "the import never waits on a lookup");
  assert.match(app, /setImportMessage\(""\);\n    enqueueEnrich\(toAdd\.map\(\(it\) => it\.id\)\);/, "Import games queues too");

  const r = bootWith([]);
  r.seed([]);
  const backup = { app: "freerangemedia", version: 3, exportedAt: "2026-11-01T00:00:00.000Z", items: [{ id: "bk1", type: "book", title: "Dune", barcode: "9780441172719", status: "owned" }, { id: "bk2", type: "game", title: "Hades", status: "want" }] };
  await r.restore("replace", backup);
  assert.equal(r.stored().length, 2);
  q = r.api.readEnrichQueue();
  assert.equal(q.ids.length, 0);
  await r.restore("merge", { ...backup, items: [{ id: "bk3", type: "music", title: "OK Computer", barcode: "724385522925", status: "owned" }] });
  assert.equal(r.api.readEnrichQueue().ids.length, 0);
  r.api.resumeEnrichOnOpen();
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(r.fetch.calls.length, 0, "nothing looked up after a restore");
  assert.ok(r.stored().every((i) => i.enrich === undefined));
});

check("APP_VERSION 2.11 and cache media-shelf-v2.11", () => {
  assert.match(app, /const APP_VERSION = "2\.11";/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.11";/);
});

(async () => {
  for (const t of pending) await t();
  console.log(`${passed}/${passed} passed (v2.11 import enrichment + CLZ Comics mapping + V2.10 landing regression; mocked fetch, no browser)`);
  process.exit(0); // the app's own interval/look-again timers would keep the vm alive
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
