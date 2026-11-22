// Offline tests: fake GCD built from responses recorded live on 2026-10-05
// (price fields removed) plus synthetic cases; fake Metron (shapes as Metron answered on
// 2026-10-10, price/UPC kept in the fakes to prove they are dropped). No network.
import { readFileSync } from "node:fs";
import { makeKv } from "./kv-shim.mjs";

const REC = JSON.parse(readFileSync(new URL("./fixtures/gcd-recorded.json", import.meta.url)));
const ORIGIN = "https://freerangeice.github.io";
let n = 0;
// A fresh module = a fresh isolate (empty budget). `kv` is the GCD_CACHE binding (shared
// between isolates, like real KV); null = no binding.
const fresh = async (kv = null, extraEnv = {}) => {
  const mod = (await import("../worker.js?v=" + ++n)).default;
  const env = { ...(kv ? { GCD_CACHE: kv } : {}), ...extraEnv };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  return { fetch: (r) => mod.fetch(r, env, ctx), waits };
};
const kvTtls = (kv) => [...kv.store.values()].map((e) => e.ttl);
const kvKeys = (kv, kind) => [...kv.store.keys()].filter((k) => k.startsWith("v6:" + kind + ":"));
const req = (path, origin = ORIGIN, method = "GET") =>
  new Request("https://frm-gcd.example.workers.dev" + path, { method, headers: origin ? { Origin: origin } : {} });
let fails = 0;
const ok = (c, name) => { console.log((c ? "PASS " : "FAIL ") + name); if (!c) fails++; };
const J = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

function fakeSeries(sid, extraRows = []) {
  const rows = new Map();
  for (const v of [...Object.values(REC), { results: extraRows }]) {
    if (!v || !Array.isArray(v.results)) continue;
    for (const r of v.results) if (r.series && r.series.includes("/series/" + sid + "/")) rows.set(r.api_url, r);
  }
  const list = [...rows.values()];
  return { api_url: "https://www.comics.org/api/series/" + sid + "/?format=json", name: "Fake", active_issues: list.map((r) => r.api_url), issue_descriptors: list.map((r) => r.descriptor), price: "never" };
}
function fakeGcd(extra = {}, metronFake = null) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.hostname === "metron.cloud") {
      (fakeGcd.metron = fakeGcd.metron || []).push({ path: u.pathname + u.search, auth: init?.headers?.Authorization, ua: init?.headers?.["User-Agent"] });
      if (metronFake) return metronFake(u);
      return J({ count: 0, next: null, previous: null, results: [] });
    }
    if (u.hostname !== "www.comics.org") throw new Error("unexpected host " + u.hostname);
    seen.push({ path: u.pathname, ua: init?.headers?.["User-Agent"], format: u.searchParams.get("format"), auth: init?.headers?.Authorization });
    if (extra[u.pathname]) return extra[u.pathname](u);
    if (REC[u.pathname]) return J(REC[u.pathname]);
    // Series record: every recorded search row of that series, in recorded order (stands in
    // for GCD's active_issues + issue_descriptors).
    const sm = u.pathname.match(/^\/api\/series\/(\d+)\/$/);
    if (sm) return J(fakeSeries(Number(sm[1])));
    const m = u.pathname.match(/^\/api\/issue\/(\d+)\/$/);
    if (m) return J({ api_url: "https://www.comics.org/api/issue/" + m[1] + "/?format=json", series_name: "Absolute Batman (2024 series)", number: "1", variant_name: "Synthetic " + m[1], variant_of: "https://www.comics.org/api/issue/2663120/?format=json", title: "", price: "4.99 USD", key_date: "2024-12-00", story_set: [], cover: "https://files1.comics.org//img/gcd/covers_by_id/1/w400/" + m[1] + ".jpg" });
    return J({ count: 0, next: null, previous: null, results: [] });
  };
  return seen;
}

// 1. Saga #1 (recorded)
{
  const kv = makeKv();
  const seen = fakeGcd();
  const w = await fresh(kv);
  const res = await w.fetch(req("/comic?series=Saga&issue=1&year=2012"));
  const text = await res.text();
  const b = JSON.parse(text);
  ok(res.status === 200 && !/price/i.test(text), "saga: 200, no price anywhere");
  ok(b.match.sourceId === "gcd-issue-911609" && b.match.series === "Saga" && b.match.year === 2012, "saga: picks Image 1st printing base");
  ok(b.match.publisher === "Image Comics Inc." && b.match.writer.join() === "Brian K. Vaughan" && b.match.artist.join() === "Fiona Staples", "saga: publisher + credits cleaned");
  ok(b.match.sourceUrl === "https://www.comics.org/issue/911609/" && b.match.sourceName === "Grand Comics Database", "saga: source");
  ok(b.total === 5 && b.variants.length === 5 && b.variants[0].label === "1st Printing" && b.variants[0].variant === false && !b.variants.some((v) => v.sourceId === "gcd-issue-2120035"), "saga: all 5 records of this base, base first with its own name (other base's printing excluded)");
  ok(b.variants.slice(1).every((v) => v.variant) && b.variants[1].label === "Fiona Staples Retailer Incentive Cover", "saga: variant labels from GCD descriptors");
  ok(b.covers.length === 0 && !/comics\.org\/\/?img|files1/.test(text) && !b.variants.some((v) => "image" in v) && !("imagesFrom" in b), "saga: no GCD cover URL anywhere; no Metron token -> names only, no imagesFrom");
  ok(seen.length === 3 && seen[2].path === "/api/series/63051/" && res.headers.get("X-Relay-Upstream") === "3" && res.headers.get("X-Relay-Cache") === "miss" && res.headers.get("X-Relay-Metron") === "off", "saga: cold lookup = 1 search + 1 base detail + 1 series list (X-Relay-Upstream 3), Metron off without a token");
  ok(!b.partial, "saga: complete answer, not partial");
  ok(seen.every((s) => s.ua.startsWith("FreeRangeMedia-relay/1.0") && s.format === "json" && !s.auth), "upstream: UA, format=json, anonymous");
  ok(b.candidates.length === 5 && b.candidates[0].sourceId === "gcd-issue-1015888", "saga: candidates exact-name first");
  const ttlOf = (kind) => kv.store.get(kvKeys(kv, kind)[0]).ttl;
  ok(kv.store.size === 4 && kvKeys(kv, "issue").length === 1 && kvKeys(kv, "search").length === 1 && kvKeys(kv, "variants").length === 1 && kvKeys(kv, "comic").length === 1 && ttlOf("issue") === 604800 && ttlOf("search") === 604800 && ttlOf("variants") === 604800, "kv: search skeleton + base issue + series variant list, each 7 days");
  ok(ttlOf("comic") === 86400, "kv: a whole answer without a Metron picture is stored only 1 day (TTL_METRON_MISS_S)");
  ok(![...kv.store.values()].some((e) => /price/i.test(e.value)), "kv: no price stored anywhere");
  const again = await w.fetch(req("/comic?series=SAGA&issue=%23001&year=2012"));
  const againBody = await again.text();
  ok(again.headers.get("X-Relay-Cache") === "hit" && again.headers.get("X-Relay-Upstream") === "0" && seen.length === 3 && againBody === text, "kv: repeat (case, #, leading zeros) is a hit, 0 upstream, same answer");
  // another isolate (fresh module, empty budget) sharing the namespace: still a hit
  const w2 = await fresh(kv);
  const other = await w2.fetch(req("/comic?series=Saga&issue=1&year=2012"));
  ok(other.headers.get("X-Relay-Cache") === "hit" && seen.length === 3, "kv: another isolate gets the hit too (cache is not per isolate)");
  // /comic-covers: kept for old app builds, answers at once with no covers and no upstream call
  const ids = b.variants.map((v) => v.sourceId).join(",");
  const cv = await w.fetch(req("/comic-covers?ids=" + ids));
  const cvText = await cv.text();
  ok(cv.status === 200 && cvText === '{"covers":[]}' && seen.length === 3 && cv.headers.get("X-Relay-Upstream") === "0" && cv.headers.get("X-Relay-Metron-Calls") === "0", "covers: no covers, 0 upstream calls (GCD scans unusable; Metron pictures come with /comic)");
}
// 2. Absolute Batman: credits with notes, 18 records
{
  const seen = fakeGcd();
  const w = await fresh(makeKv());
  const b = await (await w.fetch(req("/comic?series=Absolute%20Batman&issue=1&year=2024"))).json();
  ok(b.match.writer.join() === "Scott Snyder" && b.match.artist.join() === "Nick Dragotta" && b.match.publisher === "DC Comics", "abs batman: '(credited) (signed as ..)' stripped, deduped");
  ok(b.total === 18 && b.variants[0].label === "Nick Dragotta Cover" && b.variants[2].label === "Wes Craig Cardstock Variant Cover", "abs batman: 18 variants listed with GCD labels");
  ok(b.covers.length === 0 && seen.length === 3, "abs batman: no GCD covers, 3 calls (search, base, series list); all 18 names listed");
}
// 3. budget runs out partway -> partial + Retry-After; the skeleton is kept, so a retry
// needs no search; with nothing cached and no budget -> 503
{
  const kv = makeKv();
  const seen = fakeGcd();
  const w = await fresh(kv);
  // burn 24 of 25 on misses: the Saga search is the 25th call, its base detail is over budget
  for (let i = 0; i < 24; i++) await w.fetch(req("/comic?series=zz" + i + "&issue=1"));
  const r = await w.fetch(req("/comic?series=Saga&issue=1&year=2012"));
  const b = await r.json();
  ok(seen.length === 25 && b.partial === true && Number(r.headers.get("Retry-After")) > 3000, "budget: partial:true with Retry-After");
  ok(b.match && b.match.sourceId === "gcd-issue-911609" && b.match.year === 2012 && b.match.publisher === null && b.total === 5 && b.variants.length === 5, "budget: partial still returns match (year from the search) + every variant name");
  ok(kvKeys(kv, "comic").filter((k) => /saga/.test(k)).length === 0 && kvKeys(kv, "search").length === 1, "kv: partial answer not stored whole; its search skeleton is (7 days)");
  const r2 = await w.fetch(req("/comic?series=Saga&issue=1&year=2012"));
  const b2 = await r2.json();
  ok(r2.status === 200 && b2.partial === true && seen.length === 25 && r2.headers.get("X-Relay-Upstream") === "0", "budget: retry while over budget = same partial from KV, 0 upstream calls (no new search)");
  // later, a new isolate with budget: only the missing detail is fetched, then stored whole
  const w2 = await fresh(kv);
  const r2b = await w2.fetch(req("/comic?series=Saga&issue=1&year=2012"));
  const b2b = await r2b.json();
  ok(r2b.status === 200 && !b2b.partial && b2b.match.publisher === "Image Comics Inc." && seen.length === 27 && seen[26].path === "/api/series/63051/" && kvKeys(kv, "comic").length >= 1, "kv: next isolate fetches only the missing base detail + series list, answer now complete and stored");
  const r2c = await w.fetch(req("/comic?series=Batman&issue=1&year=1940"));
  ok(r2c.status === 503 && (await r2c.json()).error === "busy" && r2c.headers.get("Retry-After"), "budget: nothing cached + over budget -> 503 busy");
  const r3 = await w.fetch(req("/comic-covers?ids=gcd-issue-911609,gcd-issue-953800"));
  ok(r3.status === 200 && (await r3.text()) === '{"covers":[]}' && seen.length === 27, "covers: over budget still answers at once, no upstream");
}
// 4. upstream 429 / 503 back-off
{
  const seen = fakeGcd({ "/api/series/name/x1/issue/1/": () => J({ detail: "Request was throttled." }, 429, { "Retry-After": "1234" }) });
  const w = await fresh(makeKv());
  const r = await w.fetch(req("/comic?series=x1&issue=1"));
  ok(r.status === 503 && r.headers.get("Retry-After") === "1234", "429: 503 honoring Retry-After");
  const r2 = await w.fetch(req("/comic?series=other&issue=1"));
  ok(r2.status === 503 && seen.length === 1, "429: paused, no more upstream");
}
{
  fakeGcd({ "/api/series/name/x2/issue/1/": () => new Response("down", { status: 503 }) });
  const w = await fresh(makeKv());
  const r = await w.fetch(req("/comic?series=x2&issue=1"));
  ok(r.status === 503 && r.headers.get("Retry-After") === "600", "503 without Retry-After: pause 600s");
}
// 5. misses, truncated results, no-scan covers
{
  const kv = makeKv();
  fakeGcd();
  const w = await fresh(kv);
  const b = await (await w.fetch(req("/comic?series=Qwzxv&issue=1"))).json();
  ok(b.match === null && b.total === 0 && kv.store.size === 1 && kvTtls(kv)[0] === 86400, "miss: null, cached 1 day");
}
{
  const kv = makeKv();
  const rows = Array.from({ length: 50 }, (_, i) => ({ api_url: "https://www.comics.org/api/issue/" + (100 + i) + "/?format=json", series_name: "Batman Saga " + i + " (1990 series)", descriptor: "1", variant_of: null, series: "https://www.comics.org/api/series/" + (500 + i) + "/?format=json", publication_date: "1990" }));
  const seen = fakeGcd({ "/api/series/name/Batman/issue/1/": () => J({ count: 900, next: "https://www.comics.org/api/series/name/Batman/issue/1/?format=json&page=2", results: rows }) });
  const w = await fresh(kv);
  const b = await (await w.fetch(req("/comic?series=Batman&issue=1"))).json();
  ok(b.match === null && b.reason === "add-year" && b.candidates.length === 5 && seen.length === 1, "many results, no exact on page 1: add-year, 1 call, no paging");
  ok(kv.store.size === 1 && kvTtls(kv)[0] === 86400, "kv: add-year miss stored 1 day");
}
{
  fakeGcd({
    "/api/series/name/Nocov/issue/1/": () => J({ count: 1, next: null, results: [{ api_url: "https://www.comics.org/api/issue/77/?format=json", series_name: "Nocov (2001 series)", descriptor: "1", variant_of: null, series: "https://www.comics.org/api/series/9/?format=json", publication_date: "May 2001" }] }),
    "/api/issue/77/": () => J({ series_name: "Nocov (2001 series)", number: "1", variant_name: "", variant_of: null, cover: "", title: "Hello", story_set: [{ type: "comic story", script: "A. Writer ?; ?; B. Writer [as Bee]", pencils: "None", inks: "C. Inker (signed)" }] }),
  });
  const w = await fresh(makeKv());
  const b = await (await w.fetch(req("/comic?series=Nocov&issue=01"))).json();
  ok(b.match.title === "Hello" && b.covers.length === 0 && b.variants[0].label === "Cover A", "no scan: skipped; base without name = Cover A");
  ok(b.match.writer.join("|") === "A. Writer|B. Writer" && b.match.artist.join() === "C. Inker", "credits: '?', [notes], None handled");
}
// 5b. search route errors are errors, never misses, never cached
for (const [label, make] of [
  ["404 on search route", () => new Response(JSON.stringify({ detail: "Not found." }), { status: 404, headers: { "Content-Type": "application/json" } })],
  ["200 {items:[]}", () => J({ items: [] })],
  ["200 results not an array", () => J({ count: 0, results: null })],
]) {
  const kv = makeKv();
  const store = kv.store;
  const seen = fakeGcd({ "/api/series/name/Broken/issue/1/": make });
  const w = await fresh(kv);
  const r1 = await w.fetch(req("/comic?series=Broken&issue=1"));
  const b1 = await r1.json();
  ok(r1.status === 502 && b1.error === "GCD lookup failed" && !("match" in b1), label + ": error response, not a miss");
  ok(store.size === 0, label + ": nothing cached");
  const r2 = await w.fetch(req("/comic?series=Broken&issue=1"));
  ok(r2.status === 502 && seen.length === 2 && r2.headers.get("X-Relay-Cache") !== "hit", label + ": second call goes upstream again");
}
{
  // nonsense series: 200 with an empty results array is a real, cached miss
  const kv = makeKv();
  const store = kv.store;
  const seen = fakeGcd({ "/api/series/name/Qwzxv%20Plumbtrandle%20Fnorp/issue/1/": () => J({ count: 0, next: null, previous: null, results: [] }) });
  const w = await fresh(kv);
  const r1 = await w.fetch(req("/comic?series=Qwzxv%20Plumbtrandle%20Fnorp&issue=1"));
  const b1 = await r1.json();
  ok(r1.status === 200 && b1.match === null && b1.total === 0, "nonsense: real miss");
  ok(store.size === 1 && [...store.values()][0].ttl === 86400, "nonsense: miss cached 1 day");
  const r2 = await w.fetch(req("/comic?series=Qwzxv%20Plumbtrandle%20Fnorp&issue=1"));
  ok(r2.headers.get("X-Relay-Cache") === "hit" && seen.length === 1, "nonsense: repeat served from cache");
}
{
  // a 404 on the base issue detail is skipped, not turned into a miss
  const kv = makeKv();
  fakeGcd({ "/api/issue/911609/": () => new Response("{}", { status: 404 }) });
  const w = await fresh(kv);
  const b = await (await w.fetch(req("/comic?series=Saga&issue=1&year=2012"))).json();
  ok(b.match && b.match.sourceId === "gcd-issue-911609" && b.match.series === "Saga" && b.match.title === null && b.total === 5 && b.variants.length === 5 && !b.partial, "issue-detail 404: skipped, match kept from the search, every name listed");
  const miss = [...kv.store.entries()].find(([k]) => k === "v6:issue:911609");
  ok(miss && miss[1].ttl === 86400 && JSON.parse(miss[1].value).missing === true && kvKeys(kv, "comic").length === 1, "kv: missing issue stored 1 day; answer with a missing detail still stored whole");
}
{
  // a 500 on one issue detail is an error: never stored, and the answer is partial (not stored whole)
  const kv = makeKv();
  fakeGcd({ "/api/issue/911609/": () => new Response("{}", { status: 500 }) });
  const w = await fresh(kv);
  const r = await w.fetch(req("/comic?series=Saga&issue=1&year=2012"));
  const b = await r.json();
  ok(b.partial === true && b.match.sourceId === "gcd-issue-911609" && !kv.store.has("v6:issue:911609") && kvKeys(kv, "comic").length === 0 && r.headers.get("Retry-After") === "60", "issue-detail 500: error never stored, answer partial with Retry-After 60");
}
{
  // no KV binding: still answers (uncached); KV read/write failures never break an answer
  const seen = fakeGcd();
  const w = await fresh(null);
  const r1 = await w.fetch(req("/comic?series=Saga&issue=1&year=2012"));
  const r2 = await w.fetch(req("/comic?series=Saga&issue=1&year=2012"));
  ok(r1.status === 200 && r2.status === 200 && seen.length === 6 && r2.headers.get("X-Relay-Cache") === "miss", "no KV binding: works uncached");
  for (const opts of [{ failGet: true }, { failPut: true }]) {
    const seen2 = fakeGcd();
    const kv = makeKv(opts);
    const wf = await fresh(kv);
    const rf = await wf.fetch(req("/comic?series=Saga&issue=1&year=2012"));
    const bf = await rf.json();
    ok(rf.status === 200 && bf.match.sourceId === "gcd-issue-911609" && seen2.length === 3, "KV " + Object.keys(opts)[0] + " throwing: answer still served");
  }
}
{
  // the longest allowed non-Latin series name still fits KV's key limit (longer keys would be hashed)
  const kv = makeKv();
  fakeGcd();
  const w = await fresh(kv);
  const r = await w.fetch(req("/comic?series=" + encodeURIComponent("漫".repeat(120)) + "&issue=1"));
  ok(r.status === 200 && kv.store.size === 1 && [...kv.store.keys()].every((k) => new TextEncoder().encode(k).length <= 512), "kv: a 120-character non-Latin series still makes a key within KV's 512-byte limit");
}
{
  // unchanged paths: non-JSON is an error, not a miss
  const kv = makeKv();
  const store = kv.store;
  fakeGcd({ "/api/series/name/Html/issue/1/": () => new Response("<html>Just a moment...</html>", { status: 200, headers: { "Content-Type": "text/html" } }) });
  const w = await fresh(kv);
  const r = await w.fetch(req("/comic?series=Html&issue=1"));
  ok(r.status === 502 && store.size === 0, "non-JSON search answer: 502, not cached");
}
// 6. validation, origin, barcode, methods, timeout
{
  const seen = fakeGcd();
  const w = await fresh(makeKv());
  const st = async (p, o, m) => (await w.fetch(req(p, o, m))).status;
  ok((await st("/comic?series=" + "x".repeat(121) + "&issue=1")) === 400, "validate: series > 120");
  ok((await st("/comic?series=xx&issue=12345678901")) === 400, "validate: issue > 10");
  ok((await st("/comic?series=xx&issue=1/2")) === 400 && (await st("/comic?series=xx&issue=1,2")) === 400, "validate: issue chars");
  ok((await st("/comic?series=xx&issue=1&year=12")) === 400, "validate: year");
  ok((await st("/comic-covers?ids=" + Array.from({ length: 14 }, (_, i) => "gcd-issue-" + (i + 1)).join(","))) === 400, "validate: >13 ids");
  ok((await st("/comic-covers?ids=gcd-issue-1,cv-issue-2")) === 400 && (await st("/comic-covers?ids=")) === 400, "validate: id format");
  ok((await st("/comic-barcode?upc=1234567")) === 400 && (await st("/comic-barcode?upc=12345678a")) === 400, "validate: upc");
  const bc = await w.fetch(req("/comic-barcode?upc=76194138584600111"));
  ok(JSON.stringify(await bc.json()) === '{"match":null,"reason":"barcode-unsupported"}' && seen.length === 0, "barcode: unsupported, no upstream");
  const bad = await w.fetch(req("/comic?series=Saga&issue=1", "https://evil.example"));
  ok(bad.status === 403 && !bad.headers.get("Access-Control-Allow-Origin"), "origin: disallowed 403, no CORS");
  ok((await st("/comic-covers?ids=gcd-issue-1", "https://evil.example")) === 403, "origin: covers endpoint guarded too");
  ok((await st("/comic", "https://evil.example", "OPTIONS")) === 403 && (await st("/comic", "http://127.0.0.1:8790", "OPTIONS")) === 204, "origin: preflight");
  ok((await st("/comic?series=xx&issue=1", "https://58aad959.media-shelf-review.pages.dev", "OPTIONS")) === 204, "origin: media-shelf-review preview allowed");
  ok((await st("/comic?series=xx&issue=1&upc=123")) === 400, "validate: upc on /comic must be 8-17 digits");
  ok((await st("/comic?series=xx&issue=1", ORIGIN, "POST")) === 404, "method: POST refused");
  ok(seen.length === 0, "no upstream on rejected requests");
}
{
  globalThis.fetch = (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted " + url))));
  const w = await fresh(makeKv());
  const t0 = Date.now();
  const r = await w.fetch(req("/comic?series=slow&issue=1"));
  const dt = Date.now() - t0;
  const t = await r.text();
  ok(r.status === 502 && dt >= 7900 && dt < 9500 && !t.includes("comics.org"), "timeout: 502 after ~8s (" + dt + "ms), no URL leaked");
}
// 7. Metron cover links (fake Metron; Batman #608 GCD records are synthetic stand-ins
// shaped like GCD's, base id 123992 as on GCD)
{
  const TOKEN = { METRON_API_TOKEN: "test-token-not-real" };
  const IMG = "https://static.metron.cloud/media/issue/2021/07/18/batman-608.jpg";
  const BAT_ROWS = [
    [123992, "608 [Direct Sales]", null], [9901001, "608 [Newsstand]", 123992], [9901002, "608 [2nd Printing]", 123992],
    [9901003, "608 [New York Post Exclusive]", 123992], [9901004, "608 [Special Promotional Cover]", 123992],
  ];
  const batSearch = () => J({ count: 6, next: null, previous: null, results: [
    ...BAT_ROWS.map(([id, descriptor, of]) => ({ api_url: "https://www.comics.org/api/issue/" + id + "/?format=json", series_name: "Batman (1940 series)", descriptor, publication_date: "December 2002", variant_of: of ? "https://www.comics.org/api/issue/" + of + "/?format=json" : null, series: "https://www.comics.org/api/series/141/?format=json" })),
    { api_url: "https://www.comics.org/api/issue/555/?format=json", series_name: "Batman Adventures (2002 series)", descriptor: "608", publication_date: "2002", variant_of: null, series: "https://www.comics.org/api/series/999/?format=json" },
  ] });
  const batBase = () => J({ series_name: "Batman (1940 series)", number: "608", variant_name: "Direct Sales", variant_of: null, title: "Hush Chapter One: The Ride", price: "2.25 USD", key_date: "2002-12-00", indicia_publisher: "DC Comics", story_set: [{ type: "comic story", script: "Jeph Loeb", pencils: "Jim Lee", inks: "Scott Williams" }], cover: "https://files1.comics.org//img/gcd/covers_by_id/100/w400/123992.jpg" });
  const GCDX = { "/api/series/name/Batman/issue/608/year/2002/": batSearch, "/api/issue/123992/": batBase };
  const listRow = (o = {}) => ({ id: 34702, series: { id: 2481, name: "Batman", volume: 1, year_began: 1940 }, number: "608", issue: "Batman (1940) #608", cover_date: "2002-12-01", store_date: null, image: IMG, cover_hash: "eaf0055e36223c3f", modified: "2024-12-20T15:54:50-05:00", ...o });
  const detail = (o = {}) => ({ id: 34702, publisher: { id: 2, name: "DC Comics" }, series: { id: 2481, name: "Batman", volume: 1, year_began: 1940 }, number: "608", cover_date: "2002-12-01", price: "2.25", upc: "76194120005760811", image: IMG, variants: [], gcd_id: 123992, cv_id: 124939, ...o });
  const list = (rows) => J({ count: rows.length, next: null, previous: null, results: rows });
  // routes: { gcd: [rows] | fn, series: [rows] | fn, detail: obj | fn }
  const metronFake = (r) => (u) => {
    const pick = (v) => (typeof v === "function" ? v(u) : v);
    if (u.pathname === "/api/issue/" && u.searchParams.has("gcd_id")) return r.gcd ? (Array.isArray(r.gcd) ? list(r.gcd) : pick(r.gcd)) : list([]);
    if (u.pathname === "/api/issue/" && u.searchParams.has("upc")) return r.upc ? (Array.isArray(r.upc) ? list(r.upc) : pick(r.upc)) : list([]);
    if (u.pathname === "/api/issue/" && u.searchParams.has("upc_starts_with")) return r.upcStarts ? (Array.isArray(r.upcStarts) ? list(r.upcStarts) : pick(r.upcStarts)) : list([]);
    if (u.pathname === "/api/issue/" && u.searchParams.has("series_name")) return r.series ? (Array.isArray(r.series) ? list(r.series) : pick(r.series)) : list([]);
    if (/^\/api\/issue\/\d+\/$/.test(u.pathname)) return r.detail ? (r.detail instanceof Function ? r.detail(u) : J(r.detail)) : new Response("{}", { status: 404 });
    return new Response("{}", { status: 404 });
  };
  const run = async (routes, { kv = makeKv(), w = null, path = "/comic?series=Batman&issue=608&year=2002" } = {}) => {
    fakeGcd.metron = [];
    const seen = fakeGcd(GCDX, metronFake(routes));
    const worker = w || (await fresh(kv, TOKEN));
    const res = await worker.fetch(req(path));
    const text = await res.text();
    return { res, text, b: JSON.parse(text), seen, m: fakeGcd.metron, kv, w: worker };
  };
  const imgs = (b) => b.variants.map((v) => v.image || "-").join("|");

  // gcd_id match: exactly one image, on the GCD base row
  {
    const t = await run({ gcd: [listRow()], detail: detail() });
    ok(t.res.status === 200 && t.b.total === 5 && t.b.variants.length === 5 && t.b.variants[0].label === "Direct Sales" && t.b.variants[0].image === IMG && t.b.variants.slice(1).every((v) => !("image" in v)), "metron gcd_id: 5 GCD names, exactly one image, on the base row (Direct Sales)");
    ok(t.b.covers.length === 1 && t.b.covers[0].sourceId === "gcd-issue-123992" && t.b.covers[0].url === IMG && t.b.covers[0].label === "Direct Sales" && t.b.covers[0].variant === false && t.b.imagesFrom === "metron" && !t.b.imagesPending, "metron gcd_id: covers = GCD id + GCD label + Metron URL; imagesFrom metron");
    ok(t.b.match.sourceId === "gcd-issue-123992" && t.b.match.title === "Hush Chapter One: The Ride" && t.b.match.year === 2002 && t.b.match.sourceName === "Grand Comics Database", "metron gcd_id: match details stay GCD's");
    ok(!/price|2\.25|76194120005760811|upc|files1|cv_id/i.test(t.text), "metron gcd_id: no price, UPC, cv_id or files1 URL in the answer");
    ok(t.m.length === 2 && t.m[0].path === "/api/issue/?gcd_id=123992" && t.m[1].path === "/api/issue/34702/" && t.m.every((x) => x.auth === "Bearer test-token-not-real" && x.ua.startsWith("FreeRangeMedia-relay/")) && t.res.headers.get("X-Relay-Metron-Calls") === "2" && t.res.headers.get("X-Relay-Metron") === "fetched", "metron gcd_id: 2 calls (gcd_id list + detail for variants), Bearer token, relay UA");
    const mk = kvKeys(t.kv, "metron");
    const stored = mk.length === 1 ? t.kv.store.get(mk[0]) : null;
    ok(stored && stored.ttl === 604800 && !/price|upc|76194120005760811|cv_id/i.test(stored.value) && JSON.parse(stored.value).image === IMG, "kv: Metron issue stored 7 days, link only (no price/UPC)");
    ok(![...t.kv.store.values()].some((e) => /files1|price/i.test(e.value)), "kv: nothing stored holds a files1 URL or price");
    const again = await run({ gcd: [listRow()], detail: detail() }, { kv: t.kv, w: t.w });
    ok(again.res.headers.get("X-Relay-Cache") === "hit" && again.m.length === 0 && again.seen.length === 0 && again.text === t.text, "metron: repeat = whole answer from KV, 0 GCD and 0 Metron calls");
    t.kv.store.delete(kvKeys(t.kv, "comic")[0]);
    const viaKv = await run({ gcd: [listRow()], detail: detail() }, { kv: t.kv, w: await fresh(t.kv, TOKEN) });
    ok(viaKv.res.headers.get("X-Relay-Metron") === "hit" && viaKv.m.length === 0 && viaKv.seen.length === 0 && imgs(viaKv.b) === imgs(t.b), "metron: Metron issue from KV in another isolate, 0 Metron calls");
  }
  // ±1 cover year on a gcd_id hit is accepted (tolerance only when exact year fails)
  {
    const t = await run({ gcd: [listRow({ cover_date: "2003-12-01" })], detail: detail({ cover_date: "2003-12-01" }) });
    ok(t.b.covers.length === 1 && t.b.covers[0].url === IMG && t.b.imagesFrom === "metron" && t.m[0].path === "/api/issue/?gcd_id=123992", "metron year ±1 (2003 vs GCD 2002): unique gcd_id hit is used");
  }
  // year off by more than 1 on the gcd_id hit: no picture from it; fall back to name search
  {
    const t = await run({
      gcd: [listRow({ cover_date: "2005-12-01" })],
      series: [listRow()],
      detail: detail(),
    });
    ok(t.b.covers.length === 1 && t.b.imagesFrom === "metron" && t.m.some((x) => /series_name=Batman&number=608&cover_year=2002/.test(x.path)), "metron year +3 on gcd_id: falls back to exact-year name search and uses the agreeing issue");
    const miss = await run({ gcd: [listRow({ cover_date: "2005-12-01" })], series: [] });
    ok(miss.b.covers.length === 0 && !("imagesFrom" in miss.b) && miss.m.some((x) => /series_name=Batman&number=608$/.test(x.path) || /series_name=Batman&number=608&/.test(x.path)), "metron year +3, no name-search hit: no picture (tolerant search still asked)");
  }
  // tolerant name search: exact-year search empty, unique ±1 result used; two ±1 results are ambiguous
  {
    const off = listRow({ cover_date: "2003-12-01" });
    const t = await run({
      gcd: [],
      series: (u) => u.searchParams.has("cover_year") ? list([]) : list([off]),
      detail: detail({ cover_date: "2003-12-01", gcd_id: null }),
    });
    ok(t.b.covers.length === 1 && t.b.imagesFrom === "metron" && t.m.filter((x) => x.path.startsWith("/api/issue/?series_name=")).length === 2, "metron tolerant name search: exact year empty, unique ±1 year used");
    const two = await run({
      gcd: [],
      series: (u) => u.searchParams.has("cover_year") ? list([]) : list([off, listRow({ id: 9, cover_date: "2001-12-01" })]),
    });
    ok(two.b.covers.length === 0 && !("imagesFrom" in two.b), "metron tolerant name search: two ±1 hits are ambiguous, no picture");
  }
  // name search (no gcd_id link): wrong series ignored, the agreeing issue used; its detail gcd_id checked
  {
    const t = await run({ gcd: [], series: [listRow({ id: 1, series: { name: "Batman Beyond" } }), listRow()], detail: detail({ gcd_id: null }) });
    ok(imgs(t.b).startsWith(IMG + "|-") && t.b.covers.length === 1 && t.m.length === 3 && /series_name=Batman&number=608&cover_year=2002/.test(t.m[1].path) && t.m[2].path === "/api/issue/34702/", "metron by name: 'Batman Beyond' ignored, 'Batman' #608 2002 used (3 calls: gcd_id, name, detail)");
    const v = await run({ gcd: [], series: [listRow()], detail: detail({ gcd_id: 777 }) });
    ok(v.b.covers.length === 0 && !("imagesFrom" in v.b), "metron by name: detail says gcd_id 777 (not GCD's 123992) -> vetoed, no picture");
    const two = await run({ gcd: [], series: [listRow(), listRow({ id: 2 })] });
    ok(two.b.covers.length === 0 && two.m.length === 3, "metron by name: two agreeing issues = ambiguous, no picture (strict then tolerant name search)");
  }
  // wrong series only: miss, cached 1 day
  {
    const t = await run({ gcd: [], series: [listRow({ series: { name: "Batman: Gotham Knights" } }), listRow({ series: { name: "Batman" }, number: "609" })] });
    const mk = kvKeys(t.kv, "metron");
    ok(t.b.covers.length === 0 && mk.length === 1 && t.kv.store.get(mk[0]).ttl === 86400 && JSON.parse(t.kv.store.get(mk[0]).value).none === true, "metron wrong series / wrong number: no picture, miss cached 1 day");
  }
  // ambiguous gcd_id, non-Metron image host
  {
    const t = await run({ gcd: [listRow(), listRow({ id: 9 })] });
    ok(t.b.covers.length === 0 && t.m[0].path === "/api/issue/?gcd_id=123992" && t.m.length >= 2, "metron: two issues for one gcd_id = ambiguous, name-search fallback also finds no unique picture");
    const h = await run({ gcd: [listRow({ image: "https://files1.comics.org/x.jpg" })], detail: detail({ image: "https://files1.comics.org/x.jpg" }) });
    ok(h.b.covers.length === 0 && !/files1/.test(h.text), "metron: an image not on static.metron.cloud is never passed on");
  }
  // variants: unique exact name (case/punctuation-insensitive) only
  {
    const V = (name, k) => ({ name, price: "3.99", sku: "X", upc: "1", image: "https://static.metron.cloud/media/variants/v" + k + ".jpg" });
    const t = await run({ gcd: [listRow()], detail: detail({ variants: [V("NEWSSTAND", 1), V("2nd printing!", 2), V("New York Post Exclusive Variant", 3), V("Special Promotional Cover", 4), V("Special promotional cover", 5), { name: "Direct Sales", image: "https://static.metron.cloud/media/variants/v6.jpg" }] }) });
    ok(imgs(t.b) === IMG + "|https://static.metron.cloud/media/variants/v1.jpg|https://static.metron.cloud/media/variants/v2.jpg|-|-", "metron variants: 'NEWSSTAND' and '2nd printing!' match; 'New York Post Exclusive Variant' (not exact) and a duplicated name don't", imgs(t.b));
    ok(t.b.covers.length === 3 && t.b.covers.map((c) => c.sourceId).join() === "gcd-issue-123992,gcd-issue-9901001,gcd-issue-9901002" && t.b.covers[1].label === "Newsstand", "metron variants: covers keep GCD ids and GCD labels");
    ok(!/3\.99|"sku"|"upc"/.test(t.text), "metron variants: no variant price/SKU/UPC passed on");
  }
  // 401: names only, never an error, not stored whole; paused, so the next call makes no Metron call
  {
    const t = await run({ gcd: () => J({ detail: "Invalid token." }, 401) });
    ok(t.res.status === 200 && t.b.total === 5 && t.b.covers.length === 0 && !("imagesPending" in t.b) && t.res.headers.get("X-Relay-Metron") === "auth" && kvKeys(t.kv, "comic").length === 0 && kvKeys(t.kv, "metron").length === 0, "metron 401: 200 with GCD names, no images, nothing about Metron stored, answer not stored whole");
    const again = await run({ gcd: [listRow()] }, { kv: t.kv, w: t.w });
    ok(again.m.length === 0 && again.seen.length === 0 && again.b.covers.length === 0 && again.res.headers.get("X-Relay-Metron") === "busy", "metron 401: paused in this isolate; next lookup 0 GCD + 0 Metron calls, names only");
  }
  // 429: names + imagesPending; paused; a later isolate gets the picture and stores whole
  {
    const t = await run({ gcd: () => J({ detail: "Request was throttled." }, 429, { "Retry-After": "30" }) });
    ok(t.res.status === 200 && t.b.covers.length === 0 && t.b.imagesPending === true && !t.b.partial && kvKeys(t.kv, "comic").length === 0, "metron 429: 200 GCD names, imagesPending, not partial, not stored whole");
    const again = await run({ gcd: [listRow()], detail: detail() }, { kv: t.kv, w: t.w });
    ok(again.m.length === 0 && again.b.imagesPending === true, "metron 429: honours Retry-After (no Metron call in this isolate)");
    const later = await run({ gcd: [listRow()], detail: detail() }, { kv: t.kv });
    ok(later.seen.length === 0 && later.m.length === 2 && later.b.covers.length === 1 && !later.b.imagesPending && kvKeys(t.kv, "comic").length === 1, "metron after 429: next isolate gets the picture (GCD parts from KV) and stores the answer whole");
  }
  // network error / bot-check page / 500: names + imagesPending, never an error
  for (const [label, make] of [["network error", () => { throw new TypeError("fetch failed"); }], ["HTML page", () => new Response("<html>check</html>", { status: 200, headers: { "Content-Type": "text/html" } })], ["500", () => new Response("x", { status: 500 })]]) {
    const t = await run({ gcd: make });
    ok(t.res.status === 200 && t.b.match && t.b.covers.length === 0 && t.b.imagesPending === true && kvKeys(t.kv, "metron").length === 0, "metron " + label + ": names, imagesPending, nothing stored");
  }
  // no token: Metron never asked
  {
    fakeGcd.metron = [];
    fakeGcd(GCDX, metronFake({ gcd: [listRow()] }));
    const w = await fresh(makeKv());
    const r = await w.fetch(req("/comic?series=Batman&issue=608&year=2002"));
    const b = await r.json();
    ok(fakeGcd.metron.length === 0 && b.covers.length === 0 && r.headers.get("X-Relay-Metron") === "off", "no METRON_API_TOKEN: Metron never asked, names only");
  }
  // per-isolate budget 15/min (GCD parts pre-seeded in KV so each lookup is one Metron call)
  {
    const kv = makeKv();
    for (let k = 0; k < 17; k++) {
      const id = 5000 + k;
      await kv.put("v6:search:budget " + k + "|1|2001", JSON.stringify({ best: { id, name: "Budget " + k, year: 2001, variants: [{ sourceId: "gcd-issue-" + id, label: "Cover A", variant: false }] }, candidates: [], truncated: false }), { expirationTtl: 3600 });
      await kv.put("v6:issue:" + id, JSON.stringify({ id, label: "Cover A", variant: false, series: "Budget " + k, number: "1", title: null, publisher: null, year: 2001, writer: [], artist: [] }), { expirationTtl: 3600 });
    }
    fakeGcd.metron = [];
    const seen = fakeGcd({}, metronFake({ gcd: [] , series: [] }));
    const w = await fresh(kv, TOKEN);
    const st = [];
    for (let k = 0; k < 17; k++) {
      const r = await w.fetch(req("/comic?series=Budget%20" + k + "&issue=1&year=2001"));
      st.push(r.headers.get("X-Relay-Metron"));
    }
    ok(seen.length === 0 && fakeGcd.metron.length === 15 && st.filter((x) => x === "busy").length >= 1, "metron budget: at most 15 Metron calls per isolate per minute, then busy (names only)", fakeGcd.metron.length + " " + st.join(","));
  }
  // UPC fallback on /comic when gcd_id and name search find no picture
  {
    const UPC = "76194120005760811";
    const t = await run({ gcd: [], series: [], upc: [listRow()], detail: detail({ gcd_id: 123992 }) }, { path: "/comic?series=Batman&issue=608&year=2002&upc=" + UPC });
    ok(t.b.covers.length === 1 && t.b.imagesFrom === "metron" && t.m[0].path === "/api/issue/?gcd_id=123992" && t.m.some((x) => x.path === "/api/issue/?upc=" + UPC) && !t.m.some((x) => /upc_starts_with/.test(x.path)), "metron upc: exact UPC used after gcd_id and name searches miss");
    ok(!/76194120005760811|"upc"/.test(t.text), "metron upc: the UPC itself is never passed on");
    const start = await run({ gcd: [], series: [], upc: [], upcStarts: [listRow()], detail: detail({ gcd_id: 123992 }) }, { path: "/comic?series=Batman&issue=608&year=2002&upc=" + UPC });
    ok(start.b.covers.length === 1 && start.m.some((x) => x.path === "/api/issue/?upc=" + UPC) && start.m.some((x) => x.path === "/api/issue/?upc_starts_with=761941200057"), "metron upc_starts_with: exact miss, 12-digit prefix of a 17-digit code finds the issue");
    const amb = await run({ gcd: [], series: [], upc: [listRow(), listRow({ id: 9 })] }, { path: "/comic?series=Batman&issue=608&year=2002&upc=" + UPC });
    ok(amb.b.covers.length === 0 && !amb.m.some((x) => /upc_starts_with/.test(x.path)), "metron upc: two exact hits are ambiguous, no starts_with, no picture");
  }
  // /comic-barcode: Metron UPC then GCD issue by Metron's gcd_id; trouble is never an error
  {
    fakeGcd.metron = [];
    const seen = fakeGcd({ "/api/issue/123992/": batBase }, metronFake({ upc: [listRow()], detail: detail() }));
    const w = await fresh(makeKv(), TOKEN);
    const bc = await w.fetch(req("/comic-barcode?upc=76194120005760811"));
    const text = await bc.text();
    const b = JSON.parse(text);
    ok(bc.status === 200 && b.match && b.match.sourceId === "gcd-issue-123992" && b.match.title === "Hush Chapter One: The Ride" && b.covers.length === 1 && b.covers[0].url === IMG && b.imagesFrom === "metron", "barcode: Metron exact UPC plus GCD details, Metron picture");
    ok(!/price|2\.25|76194120005760811|"upc"|files1/i.test(text), "barcode: no price, UPC or files1 URL in the answer");
    ok(fakeGcd.metron[0].path === "/api/issue/?upc=76194120005760811" && seen.some((u) => u.path === "/api/issue/123992/"), "barcode: Metron upc first, then GCD issue 123992");
    const again = await w.fetch(req("/comic-barcode?upc=76194120005760811"));
    ok(again.headers.get("X-Relay-Cache") === "hit" && (await again.json()).covers.length === 1, "barcode: repeat is served from KV");
    fakeGcd.metron = [];
    fakeGcd({}, metronFake({ upc: () => J({ detail: "Request was throttled." }, 429, { "Retry-After": "15" }) }));
    const busy = await (await fresh(makeKv(), TOKEN)).fetch(req("/comic-barcode?upc=76194120005760811"));
    const bb = await busy.json();
    ok(busy.status === 200 && bb.match === null && bb.imagesPending === true && busy.headers.get("X-Relay-Metron") === "busy", "barcode: Metron 429 is never an error (imagesPending, no match)");
    fakeGcd.metron = [];
    fakeGcd({}, metronFake({ upc: [], upcStarts: [] }));
    const miss = await (await fresh(makeKv(), TOKEN)).fetch(req("/comic-barcode?upc=76194120005760811"));
    const mb = await miss.json();
    ok(miss.status === 200 && mb.match === null && !mb.reason && fakeGcd.metron.length === 2 && fakeGcd.metron[1].path === "/api/issue/?upc_starts_with=761941200057", "barcode: exact then starts_with, miss has no match");
  }
}
// 8. Variant list from the base's series record (Batman #608: GCD's year/2002 search leaves
// out New York Post Exclusive, whose key_date is later; comics.org lists 5). Synthetic rows
// shaped like GCD's, ids as on GCD where known (9901003 stands in for the NY Post record).
{
  const TOKEN = { METRON_API_TOKEN: "test-token-not-real" };
  const IMG = "https://static.metron.cloud/media/issue/2021/07/18/batman-608.jpg";
  const SID = 141;
  const R = (id, descriptor, of, pub = "December 2002", sid = SID, sname = "Batman (1940 series)") => ({ api_url: "https://www.comics.org/api/issue/" + id + "/?format=json", series_name: sname, descriptor, publication_date: pub, variant_of: of ? "https://www.comics.org/api/issue/" + of + "/?format=json" : null, series: "https://www.comics.org/api/series/" + sid + "/?format=json" });
  const DS = R(123992, "608 [Direct Sales]", null), NS = R(1676845, "608 [Newsstand]", 123992), P2 = R(879365, "608 [2nd Printing]", 123992),
    NY = R(9901003, "608 [New York Post Exclusive]", 123992, "2009"), SP = R(1777140, "608 [Special Promotional Cover]", 123992);
  const page = (rows) => J({ count: rows.length, next: null, previous: null, results: rows });
  const searchYear = () => page([DS, NS, P2, SP, R(555, "608", null, "2002", 999, "Batman Adventures (2002 series)")]);
  const searchAll = () => page([DS, NS, P2, NY, SP]);
  // series record: neighbours, the 5 records of #608 in GCD order, a #6080-like neighbour
  const seriesRec = (o = {}) => J({ api_url: "https://www.comics.org/api/series/141/?format=json", name: "Batman", price: "never",
    active_issues: [R(123990, "607", null), DS, NS, P2, NY, SP, R(124000, "609", null), R(124001, "608.5 [Special]", null)].map((r) => r.api_url),
    issue_descriptors: ["607", "608 [Direct Sales]", "608 [Newsstand]", "608 [2nd Printing]", "608 [New York Post Exclusive]", "608 [Special Promotional Cover]", "609", "608.5 [Special]"], ...o });
  const base = () => J({ series_name: "Batman (1940 series)", number: "608", variant_name: "Direct Sales", variant_of: null, title: "Hush Chapter One: The Ride", price: "2.25 USD", key_date: "2002-12-00", indicia_publisher: "DC Comics", story_set: [] });
  const routes = (o = {}) => ({ "/api/series/name/Batman/issue/608/year/2002/": searchYear, "/api/series/name/Batman/issue/608/": searchAll, "/api/issue/123992/": base, ["/api/series/" + SID + "/"]: () => seriesRec(), ...o });
  const metron = (u) => {
    if (u.searchParams.has("gcd_id")) return page([{ id: 34702, series: { id: 2481, name: "Batman", volume: 1, year_began: 1940 }, number: "608", cover_date: "2002-12-01", image: IMG }]);
    if (u.pathname === "/api/issue/34702/") return J({ id: 34702, series: { id: 2481, name: "Batman", volume: 1, year_began: 1940 }, number: "608", cover_date: "2002-12-01", price: "2.25", image: IMG, variants: [], gcd_id: 123992 });
    return page([]);
  };
  const go = async (path, { kv = makeKv(), extra = {}, token = TOKEN, w = null } = {}) => {
    fakeGcd.metron = [];
    const seen = fakeGcd(routes(extra), metron);
    const worker = w || (await fresh(kv, token));
    const res = await worker.fetch(req(path));
    const text = await res.text();
    return { res, b: JSON.parse(text), text, seen, m: fakeGcd.metron, kv, w: worker };
  };
  const WANT = "gcd-issue-123992 Direct Sales|gcd-issue-1676845 Newsstand|gcd-issue-879365 2nd Printing|gcd-issue-9901003 New York Post Exclusive|gcd-issue-1777140 Special Promotional Cover";
  const rowsOf = (b) => b.variants.map((v) => v.sourceId + " " + v.label).join("|");
  const y = await go("/comic?series=Batman&issue=608&year=2002");
  ok(y.b.total === 5 && rowsOf(y.b) === WANT && y.b.variants[0].variant === false && y.b.variants.slice(1).every((v) => v.variant), "variants: year-filtered lookup lists all 5 records from the series record (NY Post Exclusive included), base first, GCD order", rowsOf(y.b));
  ok(y.seen.map((s) => s.path).join(" ") === "/api/series/name/Batman/issue/608/year/2002/ /api/issue/123992/ /api/series/141/" && y.res.headers.get("X-Relay-Upstream") === "3", "variants: cold lookup = 3 GCD calls (search, base detail, series record)");
  ok(y.b.variants[0].image === IMG && y.b.variants.slice(1).every((v) => !("image" in v)) && y.b.covers.length === 1 && y.b.imagesFrom === "metron", "variants: Metron rule unchanged, the image only on Direct Sales");
  ok(!/price|never|2\.25/.test(y.text) && ![...y.kv.store.values()].some((e) => /price|never/.test(e.value)), "variants: nothing from the series record but ids and names (no price) in the answer or KV");
  const vk = kvKeys(y.kv, "variants");
  ok(vk.length === 1 && y.kv.store.get(vk[0]).ttl === 604800 && JSON.parse(y.kv.store.get(vk[0]).value).list.length === 4, "kv: the base's variant list stored 7 days (4 records besides the base)");
  ok(y.kv.store.get(kvKeys(y.kv, "comic")[0]).ttl === 604800, "kv: a whole answer WITH a Metron picture keeps the 7-day TTL");
  const a = await go("/comic?series=Batman&issue=608", { kv: y.kv, w: y.w });
  ok(rowsOf(a.b) === rowsOf(y.b) && a.b.total === 5, "variants: an unfiltered lookup returns the same variant list as the year-filtered one", rowsOf(a.b));
  ok(a.seen.map((s) => s.path).join(" ") === "/api/series/name/Batman/issue/608/", "variants: the unfiltered lookup reuses the base detail and the variant list from KV (1 search call only)");
  const a2 = await go("/comic?series=Batman&issue=608");
  ok(rowsOf(a2.b) === WANT, "variants: unfiltered lookup on a cold cache gives the same list too", rowsOf(a2.b));
  // no Metron picture -> whole answer stored 1 day (TTL_METRON_MISS_S)
  const n = await go("/comic?series=Batman&issue=608&year=2002", { token: {} });
  ok(n.b.covers.length === 0 && n.kv.store.get(kvKeys(n.kv, "comic")[0]).ttl === 86400 && n.b.total === 5, "kv: a whole answer without a Metron picture is stored for TTL_METRON_MISS_S (1 day), not 7 days");
  // the series record can't be read / doesn't list the base: the search hits are used
  const e404 = await go("/comic?series=Batman&issue=608&year=2002", { extra: { ["/api/series/" + SID + "/"]: () => new Response("{}", { status: 404 }) } });
  ok(e404.b.total === 4 && !e404.b.partial && JSON.parse(e404.kv.store.get(kvKeys(e404.kv, "variants")[0]).value).none === true && e404.kv.store.get(kvKeys(e404.kv, "variants")[0]).ttl === 86400, "variants: series record 404 -> the 4 search hits, 'no list' kept 1 day, answer complete");
  const odd = await go("/comic?series=Batman&issue=608&year=2002", { extra: { ["/api/series/" + SID + "/"]: () => seriesRec({ issue_descriptors: ["607"] }) } });
  ok(odd.b.total === 4, "variants: active_issues and issue_descriptors of different lengths -> not trusted, the search hits are used");
  const e500 = await go("/comic?series=Batman&issue=608&year=2002", { extra: { ["/api/series/" + SID + "/"]: () => new Response("x", { status: 500 }) } });
  ok(e500.b.partial === true && e500.b.total === 4 && kvKeys(e500.kv, "variants").length === 0 && kvKeys(e500.kv, "comic").length === 0 && e500.res.headers.get("Retry-After") === "60", "variants: series record 500 -> search hits, partial, error never stored, answer not stored whole");
  // another base #608 in the same series among the hits: the series list would be ambiguous -> not asked
  const amb = await go("/comic?series=Batman&issue=608&year=2002", { extra: { "/api/series/name/Batman/issue/608/year/2002/": () => page([DS, NS, P2, SP, R(7777, "608 [Second base]", null, "December 2002")]) } });
  ok(!amb.seen.some((s) => s.path === "/api/series/141/") && amb.b.total === 4, "variants: another base with the same number in that series -> series record not asked, search hits only");
  // budget: the series call is the one over budget -> partial, skeleton + base kept, retried later
  {
    const kv = makeKv();
    const seen = fakeGcd(routes(), metron);
    const w = await fresh(kv);
    for (let i = 0; i < 23; i++) await w.fetch(req("/comic?series=zz" + i + "&issue=1"));
    const r = await w.fetch(req("/comic?series=Batman&issue=608&year=2002"));
    const b = await r.json();
    ok(seen.length === 25 && b.partial === true && b.total === 4 && b.match.publisher === "DC Comics" && Number(r.headers.get("Retry-After")) > 0 && kvKeys(kv, "comic").filter((k) => /batman/.test(k)).length === 0, "budget: series record over BUDGET_PER_HOUR -> partial with the 4 search hits, not stored whole");
    const w2 = await fresh(kv);
    const r2 = await w2.fetch(req("/comic?series=Batman&issue=608&year=2002"));
    const b2 = await r2.json();
    ok(!b2.partial && b2.total === 5 && seen.length === 26 && seen[25].path === "/api/series/141/", "budget: next isolate asks only for the series record (search + base from KV), 5 rows");
  }
}
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
