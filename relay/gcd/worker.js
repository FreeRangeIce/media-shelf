// FreeRangeMedia Grand Comics Database (GCD) relay, with Metron cover links.
// GCD's API (https://www.comics.org/api/) needs no key, but it sends no CORS
// headers, so the browser app cannot call it directly. This Worker calls it
// anonymously and answers three things for pages on the allowed origins.
// GCD's image host (files1.comics.org) refuses browsers outside comics.org, so GCD cover
// URLs are never sent. After the GCD match, the relay asks Metron (metron.cloud, token in
// the METRON_API_TOKEN secret) for the same issue and passes on Metron's cover URL for the
// GCD rows it verifiably matches. Image bytes are never fetched, cached or stored here.
//
// The origin check only keeps other websites' pages from using the relay from a
// browser. Anything outside a browser can send any Origin header it likes.

const ALLOWED_ORIGINS = new Set([
  "https://freerangeice.github.io",
  "http://127.0.0.1:8790",
]);
// Review app builds (media-shelf-review) may call a review worker. github.io stays
// allowed so a later production deploy of this file still works for the live app.
function originAllowed(origin) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const u = new URL(origin);
    return u.protocol === "https:" && /^(?:[a-z0-9-]+\.)?media-shelf-review\.pages\.dev$/.test(u.hostname);
  } catch {
    return false;
  }
}

const GCD_API = "https://www.comics.org/api/";
const GCD_SITE = "https://www.comics.org";
const USER_AGENT =
  "FreeRangeMedia-relay/1.0 (personal, non-commercial; +https://freerangeice.github.io/media-shelf/)";
const UPSTREAM_TIMEOUT_MS = 8000;
const HOUR_MS = 60 * 60 * 1000;
// GCD's DRF settings throttle anonymous clients at 30 requests/hour. We stop at
// 25/hour. Counted per isolate, in memory (see README).
const BUDGET_PER_HOUR = 25;
const DEFAULT_BACKOFF_S = 600;
const TTL_MATCH_S = 7 * 24 * 60 * 60;
const TTL_MISS_S = 24 * 60 * 60;
const TTL_ISSUE_S = 7 * 24 * 60 * 60;
const MAX_CANDIDATES = 5;
// GCD detail calls per /comic: the base only (title, publisher, credits, key date), so a
// cold lookup costs at most 2 GCD calls (1 search + 1 detail). Variant details used to be
// fetched for their cover scans only; GCD scans are no longer usable, so they are not asked.
const MAX_DETAILS = 1;
const MAX_COVER_IDS = 13;
// Bump to start every KV entry afresh after a change to what is stored.
const KV_PREFIX = "v6:";

// ---------- Metron ----------
const METRON_API = "https://metron.cloud/api/";
const METRON_TIMEOUT_MS = 6000;
// Metron allows 20 calls/min and 5,000/day per account. We stop at 15/min and 5,000/day
// per isolate, so one isolate cannot exceed Metron's daily cap on its own.
const METRON_BUDGET_PER_MIN = 15;
const METRON_BUDGET_PER_DAY = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;
const METRON_DEFAULT_BACKOFF_S = 60;
const METRON_AUTH_BACKOFF_S = 15 * 60; // 401/403: the token is wrong or revoked
const TTL_METRON_S = 7 * 24 * 60 * 60;
const TTL_METRON_MISS_S = 24 * 60 * 60;
// Only these image hosts are ever passed on (exact URL as Metron sends it).
const METRON_IMAGE_HOST_RE = /^static\.metron\.cloud$/i;
const metronCallTimes = [];
const metronDayTimes = [];
let metronPausedUntil = 0;
let metronCalls = 0;

// Per-isolate state.
const callTimes = [];
let pausedUntil = 0;
let upstreamCalls = 0; // monotonically increasing; the handler reports this request's share

class Busy extends Error {
  constructor(retryAfter) {
    super("busy");
    this.retryAfter = retryAfter;
  }
}
class UpstreamError extends Error {}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept",
    "Access-Control-Expose-Headers": "Retry-After",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, origin, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extra,
      ...(origin ? cors(origin) : {}),
    },
  });
}

const retryHeader = (s) => ({ "Retry-After": String(Math.max(1, Math.ceil(s))) });

// ---------- budget and back-off ----------

function secondsUntilCall(now = Date.now()) {
  if (pausedUntil > now) return (pausedUntil - now) / 1000;
  while (callTimes.length && now - callTimes[0] >= HOUR_MS) callTimes.shift();
  if (callTimes.length < BUDGET_PER_HOUR) return 0;
  return (callTimes[callTimes.length - BUDGET_PER_HOUR] + HOUR_MS - now) / 1000;
}

function parseRetryAfter(value) {
  if (!value) return 0;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return n;
  const when = Date.parse(value);
  return Number.isFinite(when) ? Math.max(0, (when - Date.now()) / 1000) : 0;
}

function pause(seconds) {
  const s = seconds > 0 ? seconds : DEFAULT_BACKOFF_S;
  pausedUntil = Math.max(pausedUntil, Date.now() + s * 1000);
  return s;
}

// ---------- GCD calls ----------

// notFound: "null" (issue detail: skip it) or "error" (search route: a 404
// there means the API is not working as expected, not "no such comic").
async function gcd(path, { notFound = "null" } = {}) {
  const wait = secondsUntilCall();
  if (wait > 0) throw new Busy(wait);
  callTimes.push(Date.now());
  upstreamCalls++;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(GCD_API + path + "?format=json", {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
  } catch {
    throw new UpstreamError("GCD did not answer");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429 || res.status === 503) {
    throw new Busy(pause(parseRetryAfter(res.headers.get("Retry-After"))));
  }
  if (res.status === 404) {
    if (notFound === "error") throw new UpstreamError("GCD search route 404");
    return null;
  }
  if (!res.ok) throw new UpstreamError("GCD error " + res.status);
  try {
    return await res.json();
  } catch {
    // e.g. an HTML challenge page instead of JSON.
    throw new UpstreamError("GCD sent non-JSON");
  }
}

// ---------- parsing helpers ----------

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function normIssue(s) {
  const t = String(s || "").trim().replace(/^#/, "").trim();
  return /^\d+$/.test(t) ? String(Number(t)) : t;
}

const idFromApiUrl = (u) => {
  const m = typeof u === "string" && u.match(/\/api\/(?:issue|series)\/(\d+)\//);
  return m ? Number(m[1]) : null;
};

// series_name looks like "Saga (2012 series)" or "Saga (2012? series)".
function splitSeriesName(s) {
  const m = String(s || "").match(/^(.*) \((\d{4})\??(?: series)?\)$/);
  return m ? { name: m[1], year: Number(m[2]) } : { name: String(s || ""), year: null };
}

// descriptor looks like "1 [Wes Craig Cardstock Variant Cover]" (GCD's own
// variant name in brackets, possibly followed by a code number).
function variantLabelFromDescriptor(d) {
  const all = [...String(d || "").matchAll(/\[([^\]]+)\]/g)];
  return all.length ? all[all.length - 1][1].trim() : "";
}

function yearOf(...values) {
  for (const v of values) {
    const m = typeof v === "string" && v.match(/(\d{4})/);
    if (m && Number(m[1]) > 1800) return Number(m[1]);
  }
  return null;
}

// GCD credit strings look like "Nick Dragotta (credited) (signed as X)" or
// "A; B [as C]; D ?". Conservative clean: drop bracketed and parenthesised
// notes and a trailing "?", skip non-names, dedupe.
const NOT_NAMES = new Set(["", "none", "?", "typeset", "various", "unknown", "uncredited"]);
function creditNames(value) {
  if (typeof value !== "string") return [];
  const out = [];
  for (let part of value.replace(/<[^>]*>/g, "").split(";")) {
    part = part
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\([^)]*\)/g, "")
      .replace(/\?+\s*$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!NOT_NAMES.has(part.toLowerCase())) out.push(part);
  }
  return out;
}

function credits(storySet) {
  const writer = [];
  const artist = [];
  const add = (list, names) => names.forEach((n) => list.includes(n) || list.push(n));
  const stories = (Array.isArray(storySet) ? storySet : [])
    .filter((s) => /^(comic story|cover)$/i.test(String(s?.type || "")))
    // Comic-story credits first, cover credits after.
    .sort((a, b) => (/cover/i.test(a.type) ? 1 : 0) - (/cover/i.test(b.type) ? 1 : 0));
  for (const s of stories) add(writer, creditNames(s.script));
  for (const s of stories) add(artist, creditNames(s.pencils));
  for (const s of stories) add(artist, creditNames(s.inks));
  return { writer, artist };
}

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

// The only fields kept from an issue record (never price).
function summarizeIssue(id, d) {
  const isVariant = Boolean(d.variant_of);
  const name = str(d.variant_name);
  const { writer, artist } = credits(d.story_set);
  return {
    id,
    label: name || (isVariant ? "unnamed variant" : "Cover A"),
    variant: isVariant,
    series: splitSeriesName(d.series_name).name || null,
    seriesId: idFromApiUrl(d.series),
    number: str(d.number),
    title: str(d.title),
    publisher: str(d.indicia_publisher) || (str(d.brand_emblem) || "").split(";")[0].trim() || null,
    year: yearOf(d.key_date, d.on_sale_date, d.publication_date),
    writer,
    artist,
  };
}


// ---------- cache (Workers KV) ----------
//
// The binding GCD_CACHE (wrangler.toml) is a Workers KV namespace. caches.default is not
// used: Cloudflare documents the Cache API as working on custom domains, and this Worker
// runs on *.workers.dev. KV is global (eventually consistent, usually immediate in the
// data center that wrote it). Without the binding the relay still works, uncached.
// Stored: issue summaries 7 days (a missing issue 1 day), a /comic search skeleton (the
// chosen base + every variant name + candidates) 7 days, a base's variant list from its series
// record 7 days (unusable 1 day), a complete /comic answer 7 days with a Metron picture and 1 day
// without, a /comic miss 1 day. Errors are never stored. No price field is ever stored.

const enc = new TextEncoder();
async function kvKey(kind, parts) {
  const raw = KV_PREFIX + kind + ":" + parts.join("|");
  if (enc.encode(raw).length <= 480) return raw;
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return KV_PREFIX + kind + ":h:" + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function cacheGet(env, k) {
  const kv = env && env.GCD_CACHE;
  if (!kv) return null;
  try {
    const v = await kv.get(k, { type: "json" });
    return v && typeof v === "object" ? v : null;
  } catch {
    return null; // a KV read problem is a cache miss, never an error
  }
}

async function cachePut(env, k, body, ttl, ctx) {
  const kv = env && env.GCD_CACHE;
  if (!kv) return;
  let p;
  try {
    p = Promise.resolve(kv.put(k, JSON.stringify(body), { expirationTtl: ttl })).catch(() => {});
  } catch {
    return; // e.g. KV write limits: the answer is still served, just not stored
  }
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
  await p;
}

// One issue's summary: KV first (7 days), else one detail call.
// Returns {summary} | {missing:true}; throws Busy when the budget is spent.
async function issueSummary(id, env, ctx) {
  const k = await kvKey("issue", [id]);
  const hit = await cacheGet(env, k);
  if (hit) return hit.missing ? { missing: true, cached: true } : { summary: hit, cached: true };
  const d = await gcd("issue/" + id + "/");
  if (!d) {
    await cachePut(env, k, { missing: true }, TTL_MISS_S, ctx);
    return { missing: true };
  }
  const s = summarizeIssue(id, d);
  await cachePut(env, k, s, TTL_ISSUE_S, ctx);
  return { summary: s };
}

// ---------- Metron (cover links only) ----------
//
// Metron (https://metron.cloud/, data CC BY-SA 4.0) is asked only AFTER the GCD match, and
// only for the cover image link. Its answer can attach a picture to a GCD row; it never adds
// a row, never changes GCD's names, ids or details, and no price or UPC is passed on.
// Matching: Metron's issue must agree with GCD's base on series name (normalised like the
// GCD search) and issue number. Metron's own gcd_id, when set, must be GCD's base id.
// Cover-date year is an exact match first; if that yields no picture, a later name search
// may accept a unique ±1 year (clearly scored). Variant pictures need an exact case- and
// punctuation-insensitive name match that is unique on both sides.

class MetronUnavailable extends Error {
  constructor(kind) {
    super("metron " + kind);
    this.kind = kind; // "busy" | "auth" | "error"
  }
}

function metronSecondsUntilCall(now = Date.now()) {
  if (metronPausedUntil > now) return (metronPausedUntil - now) / 1000;
  while (metronCallTimes.length && now - metronCallTimes[0] >= 60000) metronCallTimes.shift();
  while (metronDayTimes.length && now - metronDayTimes[0] >= DAY_MS) metronDayTimes.shift();
  if (metronDayTimes.length >= METRON_BUDGET_PER_DAY) return (metronDayTimes[0] + DAY_MS - now) / 1000;
  return metronCallTimes.length < METRON_BUDGET_PER_MIN ? 0 : 1;
}

function metronPause(seconds) {
  metronPausedUntil = Math.max(metronPausedUntil, Date.now() + seconds * 1000);
}

async function metron(path, env) {
  if (metronSecondsUntilCall() > 0) throw new MetronUnavailable("busy");
  const now = Date.now();
  metronCallTimes.push(now);
  metronDayTimes.push(now);
  metronCalls++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METRON_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(METRON_API + path, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT, Authorization: "Bearer " + env.METRON_API_TOKEN },
      signal: controller.signal,
    });
  } catch {
    throw new MetronUnavailable("error");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429 || res.status === 503) {
    metronPause(parseRetryAfter(res.headers.get("Retry-After")) || METRON_DEFAULT_BACKOFF_S);
    throw new MetronUnavailable("busy");
  }
  if (res.status === 401 || res.status === 403) {
    metronPause(METRON_AUTH_BACKOFF_S);
    throw new MetronUnavailable("auth");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new MetronUnavailable("error");
  try {
    return await res.json();
  } catch {
    throw new MetronUnavailable("error"); // e.g. a bot-check page instead of JSON
  }
}

// A Metron image link, exactly as sent, only from Metron's static image host.
function metronImage(value) {
  if (typeof value !== "string" || !value) return null;
  let u;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !METRON_IMAGE_HOST_RE.test(u.hostname) || u.username || u.password || u.port) return null;
  return value;
}

const yearOfDate = (d) => {
  const m = typeof d === "string" && d.match(/^(\d{4})-/);
  return m ? Number(m[1]) : null;
};
// Variant names: case- and punctuation-insensitive, nothing else forgiven.
const variantKey = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// The only Metron fields ever kept (never price, UPC, SKU).
function metronRecord(row, detail) {
  const series = (detail && detail.series) || row.series || {};
  return {
    id: Number(row.id),
    series: str(series.name),
    number: str(row.number),
    coverDate: str(row.cover_date),
    image: metronImage((detail && detail.image) || row.image),
    gcdId: detail && Number.isInteger(detail.gcd_id) ? detail.gcd_id : row.gcdId ?? null,
    detail: Boolean(detail),
    variants: detail && Array.isArray(detail.variants)
      ? detail.variants.map((v) => ({ name: str(v && v.name), image: metronImage(v && v.image) })).filter((v) => v.name)
      : [],
  };
}

// Year score: 0 exact (or GCD has no year), 1 = ±1, 2 = further / missing.
function metronYearScore(rec, gcdYear) {
  if (!gcdYear) return 0;
  const y = yearOfDate(rec && rec.coverDate);
  if (y === gcdYear) return 0;
  if (y != null && Math.abs(y - gcdYear) === 1) return 1;
  return 2;
}

// Does Metron's issue agree with GCD's base? Returns the reason it doesn't, or "".
// yearMode "exact" (default) or "tolerant" (±1 when a year is present).
function metronDisagrees(rec, gcd, yearMode = "exact") {
  if (!rec || !rec.series) return "no-record";
  if (norm(rec.series) !== norm(gcd.series)) return "series";
  if (normIssue(rec.number) !== normIssue(gcd.number)) return "number";
  if (rec.gcdId != null && rec.gcdId !== gcd.baseId) return "gcd-id";
  const score = metronYearScore(rec, gcd.year);
  if (yearMode === "tolerant") {
    if (score > 1) return "year";
  } else if (score !== 0) {
    return "year";
  }
  return "";
}

// Unique candidate at the best accepted year score, or null if none / ambiguous.
function pickMetronCandidate(recs, gcd, yearMode) {
  const ok = (Array.isArray(recs) ? recs : []).filter((r) => !metronDisagrees(r, gcd, yearMode));
  if (!ok.length) return null;
  if (yearMode === "exact") return ok.length === 1 ? ok[0] : null;
  const scored = ok.map((r) => ({ r, s: metronYearScore(r, gcd.year) }));
  const best = Math.min(...scored.map((x) => x.s));
  const at = scored.filter((x) => x.s === best);
  return at.length === 1 ? at[0].r : null;
}

async function metronIssueSearch(params, env) {
  const data = await metron("issue/?" + new URLSearchParams(params), env);
  if (!data || !Array.isArray(data.results)) throw new MetronUnavailable("error");
  return data.results;
}

const upcDigits = (raw) => {
  const d = String(raw || "").replace(/\D/g, "");
  return /^\d{8,17}$/.test(d) ? d : "";
};
// 17-digit codes include a 5-digit add-on that some scanners drop; Metron's
// upc_starts_with wants those first 12 digits (UPC-A). A 12-digit code is used as-is.
const upcPrefix = (digits) => (digits.length > 12 ? digits.slice(0, 12) : digits);

// Exact UPC first, then upc_starts_with. Ambiguous lists are not used.
async function metronByUpc(upc, env) {
  const digits = upcDigits(upc);
  if (!digits) return { rec: null, via: "" };
  const exact = await metronIssueSearch({ upc: digits }, env);
  if (exact.length === 1) return { rec: metronRecord(exact[0], null), via: "upc" };
  if (exact.length >= 2) return { rec: null, via: "upc", ambiguous: true };
  const prefix = upcPrefix(digits);
  if (!prefix) return { rec: null, via: "upc" };
  const start = await metronIssueSearch({ upc_starts_with: prefix }, env);
  if (start.length === 1) return { rec: metronRecord(start[0], null), via: "upc_starts_with" };
  return { rec: null, via: "upc_starts_with", ambiguous: start.length >= 2 };
}

// Attach Metron images to GCD rows. Returns Map(sourceId -> image URL).
function metronImagesFor(rec, gcd, rows) {
  const out = new Map();
  if (metronDisagrees(rec, gcd, "tolerant")) return out;
  const base = rows[0];
  if (base && !base.variant && base.sourceId === "gcd-issue-" + gcd.baseId && rec.image) out.set(base.sourceId, rec.image);
  const mCount = new Map();
  for (const v of rec.variants) mCount.set(variantKey(v.name), (mCount.get(variantKey(v.name)) || 0) + 1);
  const gCount = new Map();
  for (const r of rows) if (r.variant) gCount.set(variantKey(r.label), (gCount.get(variantKey(r.label)) || 0) + 1);
  for (const r of rows) {
    if (!r.variant) continue;
    const k = variantKey(r.label);
    if (!k || gCount.get(k) !== 1 || mCount.get(k) !== 1) continue;
    const mv = rec.variants.find((v) => variantKey(v.name) === k);
    if (mv && mv.image) out.set(r.sourceId, mv.image);
  }
  return out;
}

// Find Metron's issue for this GCD base: by gcd_id first, then a strict series name +
// number + exact cover year, then (only if that yields no picture) the same search without
// a year, scored so a unique ±1 year can be used. If the app also sent a UPC, try Metron
// upc (exact) and then upc_starts_with. KV: a found issue 7 days, none found 1 day, errors
// never. A cached miss is skipped when this request has a UPC, so a later scan can still
// find a picture. Returns { rec | null, status: "hit" | "fetched" | "off" | "busy" | "auth" | "error", calls }.
async function metronFor(gcd, rows, env, ctx, { upc } = {}) {
  if (!env || !env.METRON_API_TOKEN) return { rec: null, status: "off" };
  const k = await kvKey("metron", [gcd.baseId]);
  const needDetail = rows.some((r) => r.variant);
  const hit = await cacheGet(env, k);
  if (hit && hit.none && !upc) return { rec: null, status: "hit" };
  if (hit && !hit.none && (hit.detail || !needDetail) && !metronDisagrees(hit, gcd, "tolerant")) {
    return { rec: hit, status: "hit" };
  }
  try {
    let rec = hit && !hit.none && !metronDisagrees(hit, gcd, "exact") ? hit : null;
    let via = rec ? "cache" : "";
    if (!rec) {
      const byId = await metronIssueSearch({ gcd_id: String(gcd.baseId) }, env);
      if (byId.length === 1) {
        const cand = metronRecord({ ...byId[0], gcdId: gcd.baseId }, null);
        if (!metronDisagrees(cand, gcd, "exact")) {
          rec = cand;
          via = "gcd_id";
        } else if (!metronDisagrees(cand, gcd, "tolerant")) {
          rec = cand;
          via = "gcd_id-year";
        }
      }
      // 2+ results for one gcd_id is ambiguous: do not use it; still try name / UPC.
    }
    if (!rec && gcd.series && gcd.number) {
      via = "series";
      const q = { series_name: gcd.series, number: gcd.number };
      if (gcd.year) q.cover_year = String(gcd.year);
      const r2 = await metronIssueSearch(q, env);
      rec = pickMetronCandidate(r2.map((r) => metronRecord(r, null)), gcd, "exact");
    }
    if (!rec && gcd.series && gcd.number) {
      via = "series-tolerant";
      const r3 = await metronIssueSearch({ series_name: gcd.series, number: gcd.number }, env);
      rec = pickMetronCandidate(r3.map((r) => metronRecord(r, null)), gcd, "tolerant");
    }
    if (!rec && upc) {
      const u = await metronByUpc(upc, env);
      if (u.rec && !metronDisagrees(u.rec, gcd, "tolerant")) {
        rec = u.rec;
        via = u.via;
      }
    }
    if (!rec) {
      await cachePut(env, k, { none: true }, TTL_METRON_MISS_S, ctx);
      return { rec: null, status: "fetched" };
    }
    // Details (variants, Metron's own gcd_id) when GCD has variant rows, or when the
    // issue was found by name or UPC, so Metron's gcd_id can veto it.
    const needsIdCheck = via === "series" || via === "series-tolerant" || via === "upc" || via === "upc_starts_with";
    if (!rec.detail && (needDetail || needsIdCheck) && !metronDisagrees(rec, gcd, "tolerant")) {
      const d = await metron("issue/" + rec.id + "/", env);
      if (d && typeof d === "object") rec = metronRecord({ id: rec.id, series: { name: rec.series }, number: rec.number, cover_date: rec.coverDate, image: rec.image, gcdId: rec.gcdId }, d);
      if (metronDisagrees(rec, gcd, "tolerant")) {
        await cachePut(env, k, { none: true }, TTL_METRON_MISS_S, ctx);
        return { rec: null, status: "fetched" };
      }
    }
    await cachePut(env, k, rec, TTL_METRON_S, ctx);
    return { rec, status: "fetched" };
  } catch (err) {
    return { rec: null, status: err instanceof MetronUnavailable ? err.kind : "error" };
  }
}

// ---------- /comic ----------

function groupBySeries(rows, series) {
  const want = norm(series);
  const groups = new Map();
  for (const r of rows) {
    const sid = idFromApiUrl(r.series);
    const iid = idFromApiUrl(r.api_url);
    if (!sid || !iid) continue;
    if (!groups.has(sid)) {
      const { name, year } = splitSeriesName(r.series_name);
      groups.set(sid, { sid, name, year, rows: [], i: groups.size });
    }
    groups.get(sid).rows.push({
      id: iid,
      variantOf: idFromApiUrl(r.variant_of),
      label: variantLabelFromDescriptor(r.descriptor),
      year: yearOf(r.publication_date),
    });
  }
  // Split each series group into logical issues: a base plus its variants.
  const issues = [];
  for (const g of groups.values()) {
    const bases = g.rows.filter((r) => !r.variantOf);
    const byBase = new Map(bases.map((b) => [b.id, { base: b, variants: [] }]));
    for (const r of g.rows) {
      if (!r.variantOf) continue;
      if (byBase.has(r.variantOf)) byBase.get(r.variantOf).variants.push(r);
      // A variant whose base is not in the results stands in for it.
      else byBase.set(r.id, { base: { ...r, standIn: true }, variants: [] });
    }
    for (const x of byBase.values()) {
      const n = norm(g.name);
      const score = n === want ? 2 : n.startsWith(want + " ") || n.endsWith(" " + want) ? 1 : 0;
      issues.push({ ...x, seriesId: g.sid, name: g.name, seriesYear: g.year, score, i: g.i });
    }
  }
  // Exact name first, then earliest series year, then more records (originals
  // tend to carry the variants), then GCD's own order.
  return issues.sort(
    (a, b) =>
      b.score - a.score ||
      (a.seriesYear || 9999) - (b.seriesYear || 9999) ||
      b.variants.length - a.variants.length ||
      a.i - b.i,
  );
}

const candidateOf = (x) => ({
  series: x.name,
  year: x.base.year || x.seriesYear,
  publisher: null,
  sourceId: "gcd-issue-" + x.base.id,
});

// One search call -> the "skeleton" of the answer: the chosen logical issue (base + every
// variant name, base first) and the candidates, or a miss. Stored in KV on its own, so a
// partial answer (budget ran out during the detail calls) never repeats the search.
async function searchSkeleton(series, issueNumber, year) {
  const path =
    "series/name/" + encodeURIComponent(series) + "/issue/" + encodeURIComponent(issueNumber) + "/" +
    (year ? "year/" + year + "/" : "");
  const data = await gcd(path, { notFound: "error" }); // Busy here = fully over budget -> 503
  // Only a 200 JSON answer with a results array counts as a real search. Any
  // other shape is an error (never cached), not a miss.
  if (!data || typeof data !== "object" || !Array.isArray(data.results)) {
    throw new UpstreamError("GCD search answered in an unexpected shape");
  }
  const truncated = Boolean(data.next);
  const issues = groupBySeries(data.results, series);
  const best = issues[0];
  if (!best || (truncated && best.score < 2)) {
    return {
      best: null,
      candidates: issues.slice(0, MAX_CANDIDATES).map(candidateOf),
      truncated,
    };
  }
  const baseLabel = best.base.standIn ? best.base.label || "unnamed variant" : best.base.label || "Cover A";
  return {
    best: {
      id: best.base.id,
      seriesId: best.seriesId || null,
      // The series list is only used when this is the only logical issue of that series in
      // the hits (another base with the same number there would make its records ambiguous).
      soleInSeries: issues.filter((x) => x.seriesId === best.seriesId).length === 1,
      name: best.name,
      year: best.base.year || best.seriesYear || null,
      variants: [
        { sourceId: "gcd-issue-" + best.base.id, label: baseLabel, variant: Boolean(best.base.standIn) },
        ...best.variants.map((v) => ({ sourceId: "gcd-issue-" + v.id, label: v.label || "unnamed variant", variant: true })),
      ],
    },
    candidates: issues.slice(1, 1 + MAX_CANDIDATES).map(candidateOf),
    truncated,
  };
}

function missBody(sk) {
  return {
    match: null,
    candidates: sk.candidates,
    covers: [],
    variants: [],
    total: 0,
    ...(sk.truncated ? { reason: "add-year" } : {}),
  };
}

// The base issue's full variant list. GCD's issue detail has no variant field, and the
// year-filtered search only returns records whose key_date starts with that year (Batman
// #608's New York Post Exclusive has a later key date, so `year/2002/` leaves it out). The
// series record lists every active issue of the series (`active_issues`, API links) with its
// descriptor (`issue_descriptors`, same order), so one call gives every record that shares
// the base's issue descriptor. Stored 7 days per series + base. Returns [{id, label}] in GCD's
// order without the base, or null when the record can't be trusted (lists of different
// lengths, base not in it): the search hits are used then.
const descriptorNumber = (d) => String(d || "").replace(/\s*\[.*$/, "").trim();
async function seriesVariantList(seriesId, baseId, env, ctx) {
  const k = await kvKey("variants", [seriesId, baseId]);
  const hit = await cacheGet(env, k);
  if (hit) return { list: hit.none ? null : hit.list, cached: true };
  const d = await gcd("series/" + seriesId + "/"); // Busy / UpstreamError propagate
  const links = d && Array.isArray(d.active_issues) ? d.active_issues : null;
  const descs = d && Array.isArray(d.issue_descriptors) ? d.issue_descriptors : null;
  let list = null;
  if (links && descs && links.length === descs.length) {
    const ids = links.map(idFromApiUrl);
    const at = ids.indexOf(baseId);
    if (at >= 0) {
      const num = descriptorNumber(descs[at]);
      list = [];
      ids.forEach((id, i) => {
        if (id && id !== baseId && num && descriptorNumber(descs[i]) === num) list.push({ id, label: variantLabelFromDescriptor(descs[i]) });
      });
    }
  }
  // A series that isn't there (404) or can't be read is a "no list" answer, kept 1 day.
  await cachePut(env, k, list ? { list } : { none: true }, list ? TTL_MATCH_S : TTL_MISS_S, ctx);
  return { list };
}

// Merge: base first, then every record of that issue in GCD's series order. Labels the
// search already gave are kept; records only the series list has get their descriptor's name.
function mergeVariants(searchRows, list) {
  if (!list) return searchRows;
  const base = searchRows[0];
  const byId = new Map(searchRows.map((v) => [v.sourceId, v]));
  const rows = [base];
  for (const x of list) {
    const sid = "gcd-issue-" + x.id;
    rows.push(byId.get(sid) || { sourceId: sid, label: x.label || "unnamed variant", variant: true });
    byId.delete(sid);
  }
  byId.delete(base.sourceId);
  // Anything the search found that the series list didn't (shouldn't happen) stays.
  for (const v of byId.values()) rows.push(v);
  return rows;
}

async function lookupComic(series, issueNumber, year, env, ctx, { upc } = {}) {
  const qk = [norm(series) || series.toLowerCase(), issueNumber.toLowerCase(), year];
  const bodyKey = await kvKey("comic", qk);
  const whole = await cacheGet(env, bodyKey);
  // A cached names-only answer must not hide a later UPC search.
  if (whole && (!(upc && !(whole.covers && whole.covers.length)))) return { body: whole, hit: true };

  const skKey = await kvKey("search", qk);
  let sk = await cacheGet(env, skKey);
  if (!sk) {
    sk = await searchSkeleton(series, issueNumber, year);
    if (!sk.best) {
      const body = missBody(sk);
      await cachePut(env, bodyKey, body, TTL_MISS_S, ctx);
      return { body };
    }
    await cachePut(env, skKey, sk, TTL_MATCH_S, ctx);
  }
  if (!sk.best) return { body: missBody(sk) };

  let variants = sk.best.variants;
  // Detail for the base only (MAX_DETAILS). Cached issues cost nothing.
  const ids = variants.slice(0, MAX_DETAILS).map((v) => Number(v.sourceId.slice(10)));
  const summaries = new Map();
  let retryAfter = 0;
  for (const id of ids) {
    try {
      const r = await issueSummary(id, env, ctx);
      if (r.summary) summaries.set(id, r.summary);
    } catch (err) {
      if (err instanceof Busy) {
        retryAfter = err.retryAfter;
        break;
      }
      // Network or upstream error on one issue: skip it, but don't cache the answer as complete.
      retryAfter = retryAfter || 60;
    }
  }

  // Every record of this issue from the series list (1 call, KV 7 days), unless the
  // budget already ran out or the base is a stand-in variant.
  if (!retryAfter && sk.best.seriesId && sk.best.soleInSeries && variants[0] && !variants[0].variant) {
    try {
      const r = await seriesVariantList(sk.best.seriesId, sk.best.id, env, ctx);
      variants = mergeVariants(variants, r.list);
    } catch (err) {
      retryAfter = err instanceof Busy ? err.retryAfter : 60; // names from the search; not stored whole
    }
  }

  const base = summaries.get(sk.best.id);
  const gSeries = (base && base.series) || sk.best.name;
  const gYear = (base && base.year) || sk.best.year;
  const gNumber = normIssue((base && base.number) || issueNumber);
  // Metron: a picture for the GCD rows it verifiably matches (never for a stand-in base).
  const gcd = { baseId: sk.best.id, series: gSeries, number: gNumber, year: gYear };
  const m = variants[0] && !variants[0].variant ? await metronFor(gcd, variants, env, ctx, { upc }) : { rec: null, status: "none" };
  const images = m.rec ? metronImagesFor(m.rec, gcd, variants) : new Map();
  const rows = variants.map((v) => (images.has(v.sourceId) ? { ...v, image: images.get(v.sourceId) } : { ...v }));
  const covers = rows.filter((v) => v.image).map((v) => ({ sourceId: v.sourceId, url: v.image, label: v.label, variant: v.variant }));
  // Metron busy, down or refusing the token: GCD names only, never an error. Not stored
  // whole, so the next lookup asks Metron again (GCD's parts come from KV at no cost).
  const metronUnsettled = m.status === "busy" || m.status === "error" || m.status === "auth";
  const partial = retryAfter > 0;
  const body = {
    match: {
      series: gSeries,
      issue: gNumber,
      title: base ? base.title : null,
      publisher: base ? base.publisher : null,
      year: gYear,
      writer: base ? base.writer : [],
      artist: base ? base.artist : [],
      sourceId: "gcd-issue-" + sk.best.id,
      sourceName: "Grand Comics Database",
      sourceUrl: GCD_SITE + "/issue/" + sk.best.id + "/",
    },
    candidates: sk.candidates,
    covers,
    variants: rows,
    total: variants.length,
    ...(covers.length ? { imagesFrom: "metron" } : {}),
    ...(m.status === "busy" || m.status === "error" ? { imagesPending: true } : {}),
    ...(sk.truncated ? { truncated: true } : {}),
    ...(partial ? { partial: true } : {}),
  };
  // A complete answer is stored whole. A partial one is not; its skeleton and the issues
  // it did fetch are, so the next call only asks for what is still missing.
  // With a Metron picture 7 days; without one only as long as a Metron miss (1 day), so a
  // picture Metron adds later shows up within a day.
  if (!partial && !metronUnsettled) await cachePut(env, bodyKey, body, covers.length ? TTL_MATCH_S : TTL_METRON_MISS_S, ctx);
  return { body, retryAfter, metron: m.status };
}


// Barcode lookup: GCD has no barcode API, so this uses Metron's upc / upc_starts_with
// only. When Metron returns exactly one issue with a gcd_id, the relay loads that GCD
// issue (details + variants) and attaches Metron's picture the same way /comic does.
// Metron trouble is never an error (200, match null, imagesPending). Without the token
// the route stays a no-upstream miss (reason: barcode-unsupported).
async function lookupByBarcode(upc, env, ctx) {
  if (!env || !env.METRON_API_TOKEN) return { body: { match: null, reason: "barcode-unsupported" }, metron: "off" };
  const digits = upcDigits(upc);
  const bodyKey = await kvKey("barcode", [digits]);
  const whole = await cacheGet(env, bodyKey);
  if (whole) return { body: whole, hit: true };
  try {
    const u = await metronByUpc(digits, env);
    if (!u.rec) {
      const body = { match: null };
      await cachePut(env, bodyKey, body, TTL_METRON_MISS_S, ctx);
      return { body, metron: "fetched" };
    }
    let rec = u.rec;
    if (!rec.detail) {
      const d = await metron("issue/" + rec.id + "/", env);
      if (d && typeof d === "object") rec = metronRecord({ id: rec.id, series: { name: rec.series }, number: rec.number, cover_date: rec.coverDate, image: rec.image, gcdId: rec.gcdId }, d);
    }
    if (!rec.gcdId) {
      const body = { match: null };
      await cachePut(env, bodyKey, body, TTL_METRON_MISS_S, ctx);
      return { body, metron: "fetched" };
    }
    const r = await issueSummary(rec.gcdId, env, ctx);
    if (!r.summary) {
      const body = { match: null };
      await cachePut(env, bodyKey, body, TTL_METRON_MISS_S, ctx);
      return { body, metron: "fetched" };
    }
    const s = r.summary;
    let variants = [{ sourceId: "gcd-issue-" + s.id, label: s.label, variant: Boolean(s.variant) }];
    let retryAfter = 0;
    if (s.seriesId && !s.variant) {
      try {
        const list = await seriesVariantList(s.seriesId, s.id, env, ctx);
        variants = mergeVariants(variants, list.list);
      } catch (err) {
        retryAfter = err instanceof Busy ? err.retryAfter : 60;
      }
    }
    const gcd = { baseId: s.id, series: s.series, number: s.number, year: s.year };
    const images = metronImagesFor(rec, gcd, variants);
    const rows = variants.map((v) => (images.has(v.sourceId) ? { ...v, image: images.get(v.sourceId) } : { ...v }));
    const covers = rows.filter((v) => v.image).map((v) => ({ sourceId: v.sourceId, url: v.image, label: v.label, variant: v.variant }));
    const body = {
      match: {
        series: s.series,
        issue: s.number,
        title: s.title,
        publisher: s.publisher,
        year: s.year,
        writer: s.writer || [],
        artist: s.artist || [],
        sourceId: "gcd-issue-" + s.id,
        sourceName: "Grand Comics Database",
        sourceUrl: GCD_SITE + "/issue/" + s.id + "/",
      },
      candidates: [],
      covers,
      variants: rows,
      total: variants.length,
      ...(covers.length ? { imagesFrom: "metron" } : {}),
      ...(retryAfter > 0 ? { partial: true } : {}),
    };
    if (retryAfter <= 0) await cachePut(env, bodyKey, body, covers.length ? TTL_MATCH_S : TTL_METRON_MISS_S, ctx);
    return { body, retryAfter, metron: "fetched" };
  } catch (err) {
    if (err instanceof MetronUnavailable) {
      return { body: { match: null, imagesPending: true }, metron: err.kind };
    }
    throw err;
  }
}

// ---------- /comic-covers ----------
// Kept so older app builds don't break: GCD's scans can't be shown any more and Metron's
// pictures come with /comic, so this answers at once with no upstream call and no covers.

// ---------- handler ----------

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowed = originAllowed(origin);
    const url = new URL(request.url);
    const calls0 = upstreamCalls;
    const metron0 = metronCalls;
    const upstream = () => ({ "X-Relay-Upstream": String(upstreamCalls - calls0), "X-Relay-Metron-Calls": String(metronCalls - metron0) });

    if (request.method === "OPTIONS") {
      if (!allowed) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (!allowed) return json({ error: "origin not allowed" }, 403, null);
    if (request.method !== "GET") return json({ error: "not found" }, 404, origin);

    if (url.pathname === "/comic-barcode") {
      const upc = (url.searchParams.get("upc") || "").trim();
      if (!/^\d{8,17}$/.test(upc)) return json({ error: "upc must be 8 to 17 digits" }, 400, origin);
      let out;
      try {
        out = await lookupByBarcode(upc, env, ctx);
      } catch (err) {
        if (err instanceof Busy) return json({ error: "busy" }, 503, origin, { ...retryHeader(err.retryAfter), ...upstream() });
        return json({ error: "GCD lookup failed" }, 502, origin, upstream());
      }
      const extra = {
        "X-Relay-Cache": out.hit ? "hit" : "miss",
        ...(out.metron ? { "X-Relay-Metron": out.metron } : {}),
        ...upstream(),
      };
      return json(out.body, 200, origin, extra);
    }

    if (url.pathname === "/comic-covers") {
      const raw = (url.searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!raw.length) return json({ error: "ids required" }, 400, origin);
      if (raw.length > MAX_COVER_IDS) return json({ error: "at most 13 ids" }, 400, origin);
      if (!raw.every((s) => /^gcd-issue-[1-9]\d{0,8}$/.test(s))) {
        return json({ error: "ids must look like gcd-issue-<number>" }, 400, origin);
      }
      return json({ covers: [] }, 200, origin, upstream());
    }

    if (url.pathname !== "/comic") return json({ error: "not found" }, 404, origin);

    const series = (url.searchParams.get("series") || "").trim().replace(/\s+/g, " ");
    const rawIssue = (url.searchParams.get("issue") || "").trim();
    const year = (url.searchParams.get("year") || "").trim();
    if (!series) return json({ error: "series required" }, 400, origin);
    if (series.length > 120) return json({ error: "too long: series" }, 400, origin);
    if (series.length < 2) return json({ error: "series too short" }, 400, origin);
    if (!rawIssue) return json({ error: "issue required" }, 400, origin);
    if (rawIssue.length > 10) return json({ error: "too long: issue" }, 400, origin);
    if (year && !/^(18|19|20)\d{2}$/.test(year)) return json({ error: "year must be YYYY" }, 400, origin);
    const issueNumber = normIssue(rawIssue);
    if (!issueNumber || !/^[\p{L}\p{N}.\-½ ]+$/u.test(issueNumber)) {
      return json({ error: "bad issue" }, 400, origin);
    }
    const upcRaw = (url.searchParams.get("upc") || "").trim();
    if (upcRaw && !/^\d{8,17}$/.test(upcRaw)) return json({ error: "upc must be 8 to 17 digits" }, 400, origin);

    let out;
    try {
      out = await lookupComic(series, issueNumber, year, env, ctx, { upc: upcRaw || "" });
    } catch (err) {
      if (err instanceof Busy) return json({ error: "busy" }, 503, origin, { ...retryHeader(err.retryAfter), ...upstream() });
      return json({ error: "GCD lookup failed" }, 502, origin, upstream());
    }
    const extra = {
      "X-Relay-Cache": out.hit ? "hit" : "miss",
      // Metron step: hit (KV) | fetched | off (no token) | busy | auth | error | none (no step)
      ...(out.metron ? { "X-Relay-Metron": out.metron } : {}),
      ...upstream(),
      ...(out.body.partial && out.retryAfter ? retryHeader(out.retryAfter) : {}),
    };
    return json(out.body, 200, origin, extra);
  },
};
