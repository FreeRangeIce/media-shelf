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

/* ---------- 1. CLZ Comics mapping (synthetic export, same headers as a real CLZ Comics CSV) ---------- */
const COMICS_CSV = fs.readFileSync(path.join(FIX, "clz-comics-fixture.csv"), "utf8");
const COMICS_ROWS = readCsv(COMICS_CSV);

check("CLZ Comics export: headers exactly Series, Issue, Variant Description, Publisher, Release Date, Format, Added Date", () => {
  assert.deepEqual(COMICS_ROWS[0], ["Series", "Issue", "Variant Description", "Publisher", "Release Date", "Format", "Added Date"]);
  const { api } = H.bootFile();
  const parsed = api.parseClzCsv(COMICS_CSV);
  assert.deepEqual([...parsed.headers], COMICS_ROWS[0]);
  const m = api.clzAutoMapping("comics", parsed.headers);
  assert.deepEqual({ ...m }, { series: 0, issue: 1, publisher: 3, year: 4, variant: 2, format: 5 });
  assert.equal(Object.values(m).includes(6), false, "Added Date is not imported");
  // The type check still reads it as a Comics export, not another type.
  const scores = ["comics", "games", "movies", "books", "music"].map((k) => api.clzScore(k, parsed.headers));
  assert.ok(scores[0] > Math.max(...scores.slice(1)), String(scores));
});

check("CLZ Comics export: every one of the 17 rows maps (series, issue, variant, publisher, year, format); none skipped", () => {
  const { api } = H.bootFile();
  const land = H.landClz(api, "comics", COMICS_CSV);
  assert.equal(COMICS_ROWS.length - 1, 17);
  assert.equal(land.rows.length, 17);
  assert.equal(land.rows.filter((r) => r.skip).length, 0);
  const counts = { issue: 0, collected: 0, unknown: 0, digital: 0, variant: 0, noYear: 0, issueCut: 0 };
  land.rows.forEach((r, i) => {
    const [series, issue, variant, publisher, release, format] = COMICS_ROWS[i + 1];
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
  console.log("   export:", JSON.stringify(counts));
  assert.deepEqual(counts, { issue: 9, collected: 7, unknown: 1, digital: 1, variant: 5, noYear: 1, issueCut: 1 });
});

check("Comics fixture (same headers): issues vs collected editions, variants, dates, empty fields", () => {
  const { api } = H.bootFile();
  const land = H.landClz(api, "comics", fs.readFileSync(path.join(FIX, "clz-comics-fixture.csv"), "utf8"));
  const by = (row) => land.rows.find((r) => r.row === row).item;
  const pick = (it) => ({ series: it.series, issue: it.issue, coverLabel: it.coverLabel, coverVariant: it.coverVariant, publisher: it.publisher, year: it.year, comicFormat: it.comicFormat, edition: it.edition, format: it.format });
  assert.deepEqual(pick(by(2)), { series: "77", issue: "26", coverLabel: "", coverVariant: false, publisher: "Northwind Press", year: 2006, comicFormat: "Comic", edition: "issue", format: "physical" });
  assert.deepEqual(pick(by(3)), { series: "Harbor Patrol, Vol. 1", issue: "812B", coverLabel: "Late Reprint", coverVariant: false, publisher: "Northwind Press", year: 2004, comicFormat: "Comic", edition: "issue", format: "physical" });
  assert.equal(by(4).coverLabel, "Ines Varga Regular Cover");
  assert.equal(by(4).coverVariant, false, "a Regular cover is not a variant");
  assert.equal(by(5).coverVariant, true, "Lamplight Variant, Glow Ink");
  assert.equal(by(6).issue, "3.1A");
  for (const row of [7, 8, 9, 10, 11, 13, 16]) assert.equal(by(row).edition, "collected", `row ${row}`);
  assert.equal(by(7).comicFormat, "Trade Paperback");
  assert.equal(by(9).comicFormat, "Hardcover");
  assert.equal(by(11).issue, "", "a collected edition with no issue number keeps an empty issue");
  assert.equal(by(12).edition, "issue", "Squarebound is a single issue");
  assert.deepEqual([by(14).format, by(14).edition, by(14).year], ["digital", "issue", null], "Digital Comic, blank Release Date");
  assert.deepEqual([by(15).publisher, by(15).comicFormat, by(15).edition], ["", undefined, undefined], "blank Publisher and Format stay blank");
  assert.equal(by(17).issue, "7Collector Edition: ", "an issue longer than 20 characters is cut as before");
  assert.deepEqual([by(18).series, by(18).coverLabel, by(18).coverVariant], ['The "Quiet" Hour', "Foil Variant, Moth Edition", true], "quoted quotes and commas");
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
    assert.equal(b.fetch.calls.some((u) => /upcitemdb/.test(u)), false, "UPCitemdb is never asked");
  }
  const t = bootWith([[/\/game\/search\?title=/, () => ({ body: { candidates: igdb(1) } })]]);
  t.seed([{ ...BASE, id: "g2", type: "game", title: "Halo 3", platform: "Xbox 360", status: "want", sources: ["csv"] }]);
  const q = await queueAndRun(t, ["g2"]);
  assert.equal(q.pick, 1, "a title search with one result is still a pick");
  assert.equal(t.stored()[0].enrich, "pick");
  assert.equal(t.stored()[0].igdbId, "");
  assert.equal(t.stored()[0].status, "want", "Want stays Want (Wishlist)");
});

check("comics: a single Metron cover auto-fills empty cover fields; CSV label is kept; no number -> Needs lookup", async () => {
  const b = bootWith([[/frm-gcd\.freerangeice\.workers\.dev\/comic\?/, (u) => ({ body: { match: { series: "Harbor Patrol", issue: "812", year: 2004, publisher: "Northwind Press", writer: ["Ada Quill"], artist: [], sourceId: "gcd-issue-1", sourceName: "Grand Comics Database", sourceUrl: "https://www.comics.org/issue/1/" }, variants: [{ sourceId: "gcd-issue-1", label: "Direct", variant: false, image: "https://static.metron.cloud/x.jpg" }], covers: [{ sourceId: "gcd-issue-1", url: "https://static.metron.cloud/x.jpg", label: "Direct", variant: false }], total: 1, imagesFrom: "metron" } })]]);
  const { api } = b;
  const land = H.landClz(api, "comics", fs.readFileSync(path.join(FIX, "clz-comics-fixture.csv"), "utf8"));
  const rows = [land.rows[1].item, land.rows[9].item].map((it, i) => ({ ...it, id: `c${i}` })); // 812B, and a HC with no number
  b.seed(rows);
  const q = await queueAndRun(b, ["c0", "c1"]);
  const [c0, c1] = b.stored();
  assert.equal(c0.coverUrl, "https://static.metron.cloud/x.jpg", "a single clear cover is attached");
  assert.equal(c0.coverSource, "comiclookup");
  assert.equal(c0.enrich, undefined);
  assert.equal(c0.writer, "", "writer is not a cover field and is not filled");
  assert.equal(c0.coverLabel, "Late Reprint", "an existing CSV variant label is not overwritten");
  assert.equal(c1.enrich, "lookup");
  assert.equal(c1.coverUrl || "", "");
  const asked = b.fetch.calls.filter((u) => /\/comic\?/.test(u));
  assert.equal(asked.length, 1, "the comic without a number is never sent");
  assert.match(asked[0], /issue=812(&|$)/, "CLZ's cover letter is dropped for the lookup");
  assert.match(asked[0], /year=2004/);
  assert.deepEqual([q.enriched, q.lookup], [1, 1]);
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
check("UPCitemdb is never requested; a Wikidata miss falls through to a title search", async () => {
  const routes = [
    [/query\.wikidata\.org/, () => ({ body: { results: { bindings: [] } } })],
    [/upcitemdb/, () => ({ body: { items: [{ title: "Halo 3 Xbox 360" }] } })],
    [/\/game\/search\?title=/, () => ({ body: { candidates: [{ igdbId: 7, title: "Halo 3", creator: "Bungie", year: 2007, platforms: ["Xbox 360"], coverUrl: "" }] } })],
  ];
  const b = bootWith(routes);
  b.seed([{ ...BASE, id: "u1", type: "game", title: "Halo 3", platform: "Xbox 360", barcode: "882224479325" }, { ...BASE, id: "u2", type: "game", title: "Halo 3", platform: "Xbox 360", barcode: "882224479325" }]);
  const q = await queueAndRun(b, ["u1", "u2"]);
  assert.equal(b.fetch.calls.filter((u) => /upcitemdb/.test(u)).length, 0, "UPCitemdb is never asked");
  assert.equal(q.paused, false);
  assert.equal(q.pick, 2, "title search with one result is Needs a pick");
  assert.ok(b.stored().every((i) => i.enrich === "pick" && !i.igdbId));
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
      [/query\.wikidata\.org/, () => ({ body: { results: { bindings: [{ itemLabel: { value: "Some Game" }, platLabel: { value: igdbPlat } }] } } })],
      [/upcitemdb/, () => ({ body: { items: [{ title: `SHOULD NOT BE ASKED (${igdbPlat})` }] } })],
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

check("UPCitemdb is not asked even when Wikidata misses on every queued game", async () => {
  const b = bootWith([
    [/query\.wikidata\.org/, () => ({ body: { results: { bindings: [] } } })],
    [/upcitemdb/, () => ({ status: 429, headers: { "Retry-After": "86400" }, body: { code: "TOO_FAST" } })],
    [/\/game\/search\?title=/, () => ({ body: { candidates: [] } })],
  ]);
  b.seed([{ ...BASE, id: "q1", type: "game", title: "Halo 3", platform: "Xbox 360", barcode: "882224479325" }, { ...BASE, id: "q2", type: "game", title: "Celeste", platform: "Switch", barcode: "811949030023" }]);
  const q = await queueAndRun(b, ["q1", "q2"]);
  assert.equal(b.fetch.calls.filter((u) => /upcitemdb/.test(u)).length, 0, "UPCitemdb is never asked");
  assert.equal(q.paused, false);
  assert.equal(q.lookup, 2, "a title miss is Needs lookup, and the queue was not paused by UPCitemdb");
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
  const q = { ...api.readEnrichQueue(), ids: ["a"], total: 8, paused: true, reason: "Open Library", until: Date.now() + 86400000 };
  const lines = api.enrichPauseLines(q);
  assert.equal(lines[0], "Paused: Open Library’s daily limit.");
  assert.match(lines[1], /^1 item will continue when you open the app after /);
  assert.equal(api.enrichResumeClock(until), new Date(until).toLocaleDateString("en-US", { weekday: "short" }) + " " + new Date(until).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
  assert.match(api.enrichResumeClock(until), /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d{2}\s?(AM|PM)$/);
  assert.equal(Date.now, real);
  assert.doesNotMatch(app, /Paused at a daily limit after/, "the 'after 0 of 8' line is gone");
  assert.match(app, /bar\.hidden = !\(showRun && active && !q\.paused\);/);
});

check("progress bar: fills to work done, #8B5E3C on #3a3a3a, 4px, rounded ends", () => {
  assert.match(app, /line = `Enriching \$\{Math\.max\(1, shown\)\.toLocaleString\(\)\} of/);
  assert.match(app, /\$\("#enrich-bar-fill"\)\.style\.width = `\$\{q\.total \? Math\.round\(\(q\.done \/ q\.total\) \* 100\) : 0\}%`;/);
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
  // V2.11c: in every state the source is muted text on the year line ("2008 · IGDB"), still a link; no pill.
  for (const [mark, it] of [["pick", { type: "game", title: "Crisis Core", platform: "PSP", year: 2008 }], ["lookup", { type: "movie", title: "Heat", year: 1995 }], ["", { type: "book", title: "Dune", creator: "Frank Herbert", year: 1965 }], ["", { type: "game", title: "Celeste", platform: "Switch" }]]) {
    const h = api.detailHtml(api.normalizeItem({ id: "s1", ...it, ...(mark ? { enrich: mark } : {}) }));
    const name = { game: "IGDB", movie: "IMDb", book: "ISFDB" }[it.type];
    const badges = h.slice(h.indexOf('<div class="tt-detail-badges">'), h.indexOf("</div>"));
    assert.doesNotMatch(badges, /card-ref|IGDB|IMDb|ISFDB/, `${it.title}: nothing on the badge row`);
    assert.doesNotMatch(h, /card-refs|class="card-ref/, `${it.title}: no pill anywhere`);
    const line = h.slice(h.indexOf("</div>") + 6, h.indexOf("</p>", h.indexOf("</div>")) + 4);
    const lead = it.year ? `${[it.creator, it.year].filter(Boolean).join("\u00a0· ")}<span class="detail-source-sep">\u00a0· </span>` : "";
    assert.match(line, new RegExp(`^<p class="tt-detail-line">${lead}<a class="detail-source-link" href="https://[^"]+" target="_blank" rel="noopener noreferrer" aria-label="${name} \\(opens in a new tab\\)">${name}</a></p>$`), `${it.title}: ${line}`);
  }
  assert.doesNotMatch(api.detailHtml(api.normalizeItem({ id: "u", type: "music", title: "OK Computer", year: 1997 })), /detail-source/, "music has no source link");
  assert.doesNotMatch(app, /enrich-badge-ref/);
  const dcss = css.slice(css.indexOf(".tt-detail-line .detail-source-link {"));
  assert.match(dcss, /^\.tt-detail-line \.detail-source-link \{[^}]*min-height: 24px;[^}]*color: var\(--text-muted\);[^}]*font-size: inherit;[^}]*text-decoration: underline;/);
  assert.match(css, /\.badge-format \{[^}]*color: var\(--text-muted\);/, "same gray as the format badge");
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

/* ---------- 8. V2.12: multi-platform barcodes (Sonic Frontiers) and restore never restarts ---------- */
const SONIC = "5055277048182";
const SONIC_ROWS = ["PlayStation 5", "Nintendo Switch", "PlayStation 4", "Xbox One", "Xbox Series X and Series S", "Microsoft Windows"].map((p) => ({ itemLabel: { value: "Sonic Frontiers" }, platLabel: { value: p } }));
const SONIC_IGDB = { igdbId: 119133, title: "Sonic Frontiers", creator: "Sonic Team", year: 2022, platforms: ["PlayStation 5", "Nintendo Switch", "PlayStation 4"], coverUrl: "" };

check("V2.12 barcode: Wikidata's platforms are all kept (no 'first one wins'); one platform keeps the old single path", async () => {
  const b = bootWith([[/query\.wikidata\.org/, () => ({ body: { results: { bindings: SONIC_ROWS } } })]]);
  const hit = await b.api.resolveGameBarcode(SONIC, undefined);
  assert.equal(hit.title, "Sonic Frontiers");
  assert.deepEqual([...hit.platforms], ["PS5", "Switch", "PS4", "Xbox One", "Series X|S", "PC"]);
  assert.equal(hit.platform, "", "several platforms: no single barcode platform");
  assert.match(b.fetch.calls[0], /LIMIT%2040/, "enough rows for every platform");
  const one = bootWith([[/query\.wikidata\.org/, () => ({ body: { results: { bindings: [SONIC_ROWS[1]] } } })]]);
  const h1 = await one.api.resolveGameBarcode(SONIC, undefined);
  assert.equal(h1.platform, "Switch");
  assert.deepEqual([...h1.platforms], ["Switch"]);
  const fit = b.api.barcodePlatformFit;
  for (const sel of ["Switch", "PS4", "PS5", "Xbox One", "Series X|S", "PC", "Steam", "PSN", "Switch 2"]) assert.equal(fit(hit, sel), "several", sel);
  for (const sel of ["Wii U", "GameCube", "Xbox 360", "PS3"]) assert.equal(fit(hit, sel), "none", sel);
  assert.equal(fit(h1, "Switch"), "one");
  assert.equal(fit(h1, "Switch 2"), "one", "Switch 2 still accepts a Switch barcode");
  assert.equal(fit(h1, "PS4"), "none");
  assert.notEqual(fit({ platform: "PS4" }, "PSN"), "none", "older hits without a list behave as before (PSN never blocked)");
  assert.equal(fit({ platform: "PS4" }, "PS5"), "none", "older hits without a list: a different platform still blocks");
  assert.equal(fit({ title: "x", platform: "", platforms: [] }, "Switch"), "unknown");
});

check("V2.12 enrichment: Sonic (several platforms) set to Switch -> Needs a pick; never-released platform -> not enriched; single platform -> enriched", async () => {
  const run = async (bindings, platform) => {
    const b = bootWith([
      [/query\.wikidata\.org/, () => ({ body: { results: { bindings } } })],
      [/\/game\/search\?title=/, () => ({ body: { candidates: [SONIC_IGDB] } })],
    ]);
    b.seed([{ ...BASE, id: "s1", type: "game", title: "Sonic Frontiers", platform, barcode: SONIC, format: "physical" }]);
    const q = await queueAndRun(b, ["s1"]);
    return { q, it: b.stored()[0], igdb: b.fetch.calls.filter((u) => /game\/search/.test(u)).length };
  };
  const sw = await run(SONIC_ROWS, "Switch");
  assert.equal(sw.q.pick, 1);
  assert.equal(sw.q.enriched, 0);
  assert.equal(sw.it.enrich, "pick");
  assert.equal(sw.it.igdbId, "", "nothing filled");
  assert.equal(sw.it.platform, "Switch", "platform never changed");
  assert.equal(sw.igdb, 0, "no IGDB request for an ambiguous barcode");
  const wiiu = await run(SONIC_ROWS, "Wii U");
  assert.equal(wiiu.q.enriched, 0, "never-released platform: not enriched");
  assert.equal(wiiu.it.igdbId, "");
  assert.equal(wiiu.it.platform, "Wii U");
  assert.notEqual(wiiu.it.enrich, undefined, "left for the owner (marked), never filled");
  const single = await run([SONIC_ROWS[1]], "Switch");
  assert.equal(single.q.enriched, 1, "one platform: the single match still auto-fills");
  assert.equal(single.it.igdbId, "119133");
  assert.equal(single.it.platform, "Switch");
  const wrong = await run([SONIC_ROWS[1]], "PS4");
  assert.equal(wrong.q.enriched, 0, "single different platform: unchanged rule (pick, nothing filled)");
  assert.equal(wrong.it.enrich, "pick");
});

check("V2.12 restore: Replace or Merge never restarts enrichment or the comic cover fill; data kept; no requests after", async () => {
  for (const mode of ["replace", "merge"]) {
    const b = bootWith([[/./, () => ({ body: {} })]]);
    const comic = { ...BASE, id: "k1", type: "comic", series: "Saga", issue: "1", coverUrl: "" };
    const game = { ...BASE, id: "g1", type: "game", title: "Hades", platform: "Steam", barcode: "811949031150" };
    b.seed([comic, game]);
    // Queues already on this device (an import in progress) ...
    b.api.writeEnrichQueue({ ...b.api.readEnrichQueue(), ids: ["g1"], total: 1, seen: true, dismissed: false });
    b.store.set("freerangemedia-clz-cover-queue", JSON.stringify({ v: 1, ids: ["k1"], filled: 0, none: 0, skipped: 0, paused: false, seen: true }));
    // ... and a backup that carries its own cover queue.
    const backup = { app: "freerangemedia", version: 3, exportedAt: "2026-11-01T00:00:00.000Z", items: [comic, game, { ...BASE, id: "k2", type: "comic", series: "Saga", issue: "2", coverUrl: "" }], coverQueue: { v: 1, ids: ["k1", "k2"] } };
    await b.restore(mode, backup);
    assert.deepEqual([...b.api.readEnrichQueue().ids], [], `${mode}: enrichment queue dropped`);
    assert.deepEqual([...b.api.readCoverQueue().ids], [], `${mode}: cover queue dropped, backup's queue ignored`);
    assert.ok(b.stored().some((i) => i.id === "k2" && i.series === "Saga"), `${mode}: restored data kept`);
    b.clock.now += 120000;
    for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 2));
    b.api.resumeEnrichOnOpen();
    b.api.resumeCoverFillOnOpen();
    b.clock.now += 120000;
    for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 2));
    assert.equal(b.fetch.calls.length, 0, `${mode}: no network request after the restore (${b.fetch.calls.join(", ")})`);
    assert.ok(b.stored().every((i) => !i.coverUrl), `${mode}: cover fill did not write`);
    const queued = b.stored().find((i) => i.id === "g1");
    if (mode === "merge") {
      assert.equal(queued.enrich, "lookup", "merge: unreached queued game is marked Needs lookup");
      assert.ok(b.stored().filter((i) => i.id !== "g1").every((i) => i.enrich === undefined), "merge: items not in the enrich queue stay unmarked");
    } else {
      assert.ok(b.stored().every((i) => i.enrich === undefined), "replace: backup items unmarked");
    }
  }
  // A lookup already in flight when the restore lands: its answer is dropped, not written.
  let release;
  const gate = new Promise((r) => { release = r; });
  const inner = mockFetch([[/query\.wikidata\.org/, () => ({ body: { results: { bindings: [SONIC_ROWS[1]] } } })], [/\/game\/search/, () => ({ body: { candidates: [SONIC_IGDB] } })]]);
  const clock = H.makeClock();
  const f = H.bootFile(undefined, { fetch: async (u) => { await gate; return inner(u); }, clock });
  f.seed([{ ...BASE, id: "s1", type: "game", title: "Sonic Frontiers", platform: "Switch", barcode: SONIC }]);
  f.api.enqueueEnrich(["s1"]);
  clock.now += 20000;
  const running = f.api.runEnrich();
  for (let i = 0; i < 10 && !inner.calls.length; i++) await new Promise((r) => setTimeout(r, 2));
  f.api.enrichAfterRestore(false);
  release();
  await running;
  assert.equal(f.stored()[0].igdbId || "", "", "in-flight answer after a restore is not written");
  assert.equal(f.stored()[0].enrich, "lookup", "in-flight item, answer dropped, marked Needs lookup");
  assert.equal(f.api.readEnrichQueue().ids.length, 0);
  assert.deepEqual(inner.calls.map((u) => new URL(u).hostname), ["query.wikidata.org"], "only the request already sent; no IGDB search after the restore");
  const b = f;
  assert.equal(b.api.readEnrichQueue().ids.length, 0);
});

check("V2.12 Merge restore mid-enrichment: unreached items marked Needs lookup; already enriched kept; Replace and idle restore unchanged", async () => {
  // Merge while an import is still queued: unreached rows are marked; finished rows keep their results.
  const b = bootWith([[/./, () => ({ body: {} })]]);
  const done = { ...BASE, id: "done1", type: "game", title: "Hades", platform: "Steam", barcode: "811949031150", igdbId: "123", coverUrl: "https://images.igdb.com/x.jpg", coverSource: "igdb" };
  const pending = { ...BASE, id: "pend1", type: "game", title: "Celeste", platform: "Switch", barcode: "8123456789012" };
  const pending2 = { ...BASE, id: "pend2", type: "book", title: "Dune", barcode: "9780441172719" };
  const alreadyPick = { ...BASE, id: "pick1", type: "music", title: "OK Computer", enrich: "pick" };
  b.seed([done, pending, pending2, alreadyPick]);
  b.api.writeEnrichQueue({ ...b.api.readEnrichQueue(), ids: ["pend1", "pend2"], total: 4, done: 2, enriched: 1, pick: 1, seen: true, dismissed: false });
  await b.restore("merge", {
    app: "freerangemedia",
    version: 3,
    exportedAt: "2026-11-01T00:00:00.000Z",
    items: [
      { ...BASE, id: "bk-new", type: "movie", title: "Heat", year: 1995 },
      { ...pending, dateUpdated: "2026-11-13T00:00:00.000Z", title: "Old Celeste" },
    ],
  });
  assert.deepEqual([...b.api.readEnrichQueue().ids], [], "queue dropped");
  const byId = Object.fromEntries(b.stored().map((i) => [i.id, i]));
  assert.equal(byId.pend1.enrich, "lookup");
  assert.equal(byId.pend1.title, "Celeste", "local unreached copy kept and marked");
  assert.equal(byId.pend1.dateUpdated, BASE.dateUpdated, "dateUpdated untouched");
  assert.equal(byId.pend2.enrich, "lookup");
  assert.equal(byId.done1.igdbId, "123");
  assert.equal(byId.done1.coverUrl, "https://images.igdb.com/x.jpg");
  assert.equal(byId.done1.enrich, undefined, "already enriched kept, not marked");
  assert.equal(byId.pick1.enrich, "pick", "already-picked result kept");
  assert.equal(byId["bk-new"].enrich, undefined, "backup-only item unmarked");
  assert.equal(byId["bk-new"].title, "Heat");
  b.clock.now += 120000;
  b.api.resumeEnrichOnOpen();
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 2));
  assert.equal(b.fetch.calls.length, 0, "restore sent no requests");

  // Merge: a newer backup copy of a queued id is left as restored, not marked.
  const c = bootWith([[/./, () => ({ body: {} })]]);
  c.seed([{ ...BASE, id: "same", type: "game", title: "Imported", platform: "Switch", dateUpdated: "2026-11-14T00:00:00.000Z" }]);
  c.api.writeEnrichQueue({ ...c.api.readEnrichQueue(), ids: ["same"], total: 1, seen: true, dismissed: false });
  await c.restore("merge", {
    app: "freerangemedia",
    version: 3,
    exportedAt: "2026-11-15T00:00:00.000Z",
    items: [{ ...BASE, id: "same", type: "game", title: "Edited on other device", platform: "Switch", igdbId: "99", dateUpdated: "2026-11-15T00:00:00.000Z" }],
  });
  const got = c.stored().find((i) => i.id === "same");
  assert.equal(got.title, "Edited on other device");
  assert.equal(got.igdbId, "99");
  assert.equal(got.enrich, undefined, "newer backup copy not marked");
  assert.equal(c.fetch.calls.length, 0);

  // Replace while a queue is still running: backup items stay unmarked, as before.
  const r = bootWith([[/./, () => ({ body: {} })]]);
  r.seed([pending, done]);
  r.api.writeEnrichQueue({ ...r.api.readEnrichQueue(), ids: ["pend1"], total: 1, seen: true, dismissed: false });
  await r.restore("replace", {
    app: "freerangemedia",
    version: 3,
    exportedAt: "2026-11-01T00:00:00.000Z",
    items: [pending, done, { ...BASE, id: "extra", type: "book", title: "Neuromancer" }],
  });
  assert.deepEqual([...r.api.readEnrichQueue().ids], []);
  assert.ok(r.stored().every((i) => i.enrich === undefined), "Replace leaves backup items unmarked");
  assert.ok(r.stored().some((i) => i.id === "extra"));
  assert.equal(r.fetch.calls.length, 0);

  // Merge with no import running: nothing is marked, as before.
  const idle = bootWith([[/./, () => ({ body: {} })]]);
  idle.seed([{ ...BASE, id: "shelf", type: "book", title: "Dune" }]);
  await idle.restore("merge", {
    app: "freerangemedia",
    version: 3,
    exportedAt: "2026-11-01T00:00:00.000Z",
    items: [{ ...BASE, id: "other", type: "movie", title: "Heat" }],
  });
  assert.ok(idle.stored().every((i) => i.enrich === undefined));
  assert.equal(idle.api.readEnrichQueue().ids.length, 0);
  assert.equal(idle.fetch.calls.length, 0);
});

check("V2.12 Merge mid-enrichment: a failed marks write shows the storage error, not the success toast, and unreached items do not look finished", async () => {
  const b = bootWith([[/./, () => ({ body: {} })]]);
  const pending = { ...BASE, id: "pend1", type: "game", title: "Celeste", platform: "Switch", barcode: "8123456789012" };
  b.seed([pending]);
  b.api.writeEnrichQueue({ ...b.api.readEnrichQueue(), ids: ["pend1"], total: 1, seen: true, dismissed: false });
  const MEDIA = "media-tracker-v1";
  const orig = b.store.set.bind(b.store);
  b.store.set = (k, v) => {
    if (k === MEDIA) {
      const err = new Error("quota");
      err.name = "QuotaExceededError";
      err.code = 22;
      throw err;
    }
    return orig(k, v);
  };
  await b.restore("merge", {
    app: "freerangemedia",
    version: 3,
    exportedAt: "2026-11-01T00:00:00.000Z",
    items: [{ ...BASE, id: "bk-new", type: "movie", title: "Heat", year: 1995 }],
  });
  assert.ok(b.toasts.some((m) => /didn’t fit in this browser’s storage, so nothing was restored/.test(m)), `storage error shown: ${b.toasts.join(" | ")}`);
  assert.ok(b.toasts.every((m) => !/^Merged/.test(m) && !/^Items merged/.test(m)), `success toast must not appear: ${b.toasts.join(" | ")}`);
  assert.deepEqual(b.stored().map((i) => i.id), ["pend1"], "merge rolled back; backup item not added");
  assert.equal(b.stored()[0].enrich, undefined, "unreached item not left looking finished");
  assert.deepEqual([...b.api.readEnrichQueue().ids], ["pend1"], "queue kept so enrichment can continue");
  assert.equal(b.fetch.calls.length, 0);
});

check("V2.12 enrich write: skip a Needs lookup mark this run did not own, and never overwrite a newer backup copy", () => {
  const data = { igdbId: "19029", title: "Celeste", coverUrl: "https://images.igdb.com/x.jpg", coverSource: "igdb" };
  const item = { ...BASE, id: "s1", type: "game", title: "Celeste", platform: "Switch", barcode: "8123456789012" };

  // Another tab's Merge marked the still-local item Needs lookup while this lookup was in flight.
  const a = bootWith([]);
  a.seed([item]);
  const key = a.api.enrichKey(a.stored()[0]);
  const stamp = a.stored()[0].dateUpdated;
  const env = JSON.parse(a.store.get("media-tracker-v1"));
  env.items = [{ ...a.stored()[0], enrich: "lookup" }];
  env.savedAt = "2026-11-15T17:00:00.000Z";
  a.store.set("media-tracker-v1", JSON.stringify(env));
  const w = a.api.enrichWrite("s1", { kind: "enriched", data }, key, stamp);
  assert.equal(w.state, "dropped", "late fill does not clear another tab's Needs lookup mark");
  assert.equal(a.stored()[0].enrich, "lookup");
  assert.equal(a.stored()[0].igdbId || "", "");
  assert.equal(a.stored()[0].coverUrl || "", "");

  // This run's own "Needs lookup" outcome may still write the mark when the row is unmarked.
  const own = bootWith([]);
  own.seed([item]);
  const wOwn = own.api.enrichWrite("s1", { kind: "mark", mark: "lookup" }, own.api.enrichKey(own.stored()[0]), own.stored()[0].dateUpdated);
  assert.equal(wOwn.state, "written");
  assert.equal(own.stored()[0].enrich, "lookup");

  // A newer backup copy of the same id (same enrich key: title/platform/barcode unchanged) is not overwritten.
  const c = bootWith([]);
  c.seed([item]);
  const keyC = c.api.enrichKey(c.stored()[0]);
  const stampC = c.stored()[0].dateUpdated;
  const newer = c.api.normalizeItem({ ...item, igdbId: "99", notes: "edited on other device", dateUpdated: "2026-11-15T00:00:00.000Z" });
  const envC = JSON.parse(c.store.get("media-tracker-v1"));
  envC.items = [newer];
  envC.savedAt = "2026-11-15T17:00:00.000Z";
  c.store.set("media-tracker-v1", JSON.stringify(envC));
  const wC = c.api.enrichWrite("s1", { kind: "enriched", data }, keyC, stampC);
  assert.equal(wC.state, "dropped", "late fill does not write onto a newer backup copy");
  const got = c.stored()[0];
  assert.equal(got.igdbId, "99");
  assert.equal(got.notes, "edited on other device");
  assert.equal(got.coverUrl || "", "", "empty fields on the newer copy are not filled");
  assert.equal(got.enrich, undefined);
  assert.equal(got.dateUpdated, "2026-11-15T00:00:00.000Z");
});

check("APP_VERSION 2.16.1 and cache media-shelf-v2.16.1", () => {

  assert.match(app, /const APP_VERSION = "2\.16.1";/);
  assert.match(sw, /const CACHE = "media-shelf-v2\.16.1";/);
});

(async () => {
  for (const t of pending) await t();
  console.log(`${passed}/${passed} passed (v2.11 import enrichment + CLZ Comics mapping + V2.10 landing regression; mocked fetch, no browser)`);
  process.exit(0); // the app's own interval/look-again timers would keep the vm alive
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
