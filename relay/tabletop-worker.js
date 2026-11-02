// FreeRangeMedia Tabletop lookup relay (BoardGameGeek XML API2 + GameUPC).
// SOURCE ONLY. Not deployed, and the app is NOT wired to it (tabletop.js LOOKUP_RELAY_URL
// is empty). Modelled on the frm-gcd relay: origin-locked, own CORS, upstream keys held as
// Worker secrets, answers cached. See relay/README-tabletop.md for what it needs.
//
// Secrets (wrangler secret put, never committed):
//   BGG_API_TOKEN  BoardGameGeek application token (boardgamegeek.com/applications), sent only
//                  as Authorization: Bearer to boardgamegeek.com (no www)
//   GAMEUPC_KEY  GameUPC x-api-key
// user_id: GameUPC's OpenAPI spec, https://gameupc.com/gameupc-oas.yaml (POST /upc/{upc}/bgg_id/{bgg_id},
//   requestBody: "we require app authors to include a unique (but consistent) user_id for each user.
//   If one of your users goes bad, we can go back and clear out any updates they've made.";
//   intro: "at least 8 characters"). The page is public, so each
//   device makes its own random id the first time it sends a match, keeps it in its own storage
//   (never in backups or exports) and sends it as "userId". The relay checks it is 8 to 64
//   letters, digits or dashes (400 otherwise) and passes it on as {"user_id"}. There is no shared
//   fallback id. The daily cap and the same-IP check do not depend on the id.
// Vars (wrangler.toml [vars], optional):
//   GAMEUPC_BASE "test" | "v1"   (default "test"; /test "will be wiped periodically")
//   CONFIRM_DAILY_CAP  confirms forwarded to GameUPC per UTC day, all clients together (default 10)
//   BGG_DAILY_CAP  upstream BGG XML API calls per UTC day, all clients together (default 200).
//                  Cache hits never count. At the cap: 503 {"error":"bgg daily cap reached"} +
//                  Retry-After, no BGG call. Needs KV: without TT_CACHE every BGG call is refused (503).
// KV: TT_CACHE. Required for POST /barcode/confirm (503 without it: the daily cap and the
// lookup-before-confirm record live there). Optional for GameUPC lookups. Required for BGG lookups: without it every uncached BGG call is refused (503). Without it, GameUPC answers go to the Workers Cache API (caches.default,
// per data centre) and an isolate-memory map; KV is the shared, longest-lived option.
//
// Routes (GET, from ALLOWED_ORIGINS only):
//   /search?q=NAME           -> { matches: [{ bggId, bggType, name, year }] }  (user picks; never auto-picked)
//   /thing?ids=1,2,...       -> { things: [Thing] }  (at most 20 ids)
//   /barcode?upc=DIGITS      -> { upc, status: "verified"|"choose"|"none", name, searchedFor, candidates: [{ bggId, name, year, thumbnail }] }
// Route (POST, from ALLOWED_ORIGINS only), the ONLY write:
//   /barcode/confirm  body {"upc","bggId","userId"} -> { ok: true }
//     Sent by the page only after the user's explicit confirm (picked suggestion or hand-entered
//     game with a BGG id). Refused with 409 unless this relay served a "choose" / "none" answer
//     for that UPC to the same client IP (CF-Connecting-IP) in the last 10 minutes (recorded in
//     KV), so a confirmed match ("verified") is never posted back. 503 when TT_CACHE is not
//     bound. 429 + Retry-After (seconds to next UTC midnight) once CONFIRM_DAILY_CAP confirms
//     went upstream today, across all clients; no upstream POST then.
//   errors: 400 bad input / bad UPC, 409 not postable, 429 + Retry-After { error: "slow down" },
//           503 + Retry-After { error: "busy" }, 502 { error: "upstream" }
//
// BGG routes: NOT run against the real API (no BGG token yet).
// GameUPC GET /barcode: run locally against v1 (node shim, dev/relay-shim.mjs), 3 test UPCs.
// GameUPC POST: only via /barcode/confirm (above); never automatic. GameUPC's update_url is
// never followed as given: the relay builds /upc/{upc}/bgg_id/{bgg_id} on its own host.
// The follow-up thing pull goes to boardgamegeek.com/xmlapi2, never GameUPC's data_url
// (api.geekdo.com), which is an unlicensed BGG API.

const ALLOWED_ORIGINS = new Set(["https://freerangeice.github.io", "http://127.0.0.1:8790"]);

const CONFIG = {
  BGG_API: "https://boardgamegeek.com/xmlapi2", // not www (BGG's token docs)
  // Gap between BGG calls. Not a published limit: BGG's wiki says ~5 s "seems to suffice".
  BGG_GAP_MS: 5000,
  // Search: false (default) = three single-type searches sent one at a time.
  // true = one call with type=boardgame,boardgameexpansion,rpgitem (BGG docs say a comma
  // list is allowed; untested). Each returned <item type> is kept either way.
  BGG_COMBINED_SEARCH: false,
  BGG_SEARCH_TYPES: ["boardgame", "boardgameexpansion", "rpgitem"],
  BGG_MAX_THING_IDS: 20, // BGG: at most 20 ids per thing call
  GAMEUPC_HOSTS: { test: "https://api.gameupc.com/test", v1: "https://api.gameupc.com/v1" },
  UPSTREAM_TIMEOUT_MS: 10000,
  RETRY_LATER_S: 30, // 500 / 503 / 202 from BGG, 429 from GameUPC
  TTL_THING_S: 7 * 24 * 3600,
  TTL_SEARCH_S: 24 * 3600,
  // GameUPC is free with no stated rate limit (GameUPC, to Micah): cache long, call rarely.
  TTL_UPC_VERIFIED_S: 30 * 24 * 3600, // human-verified match: rarely changes
  TTL_UPC_CHOOSE_S: 7 * 24 * 3600, // suggestions: can become verified as people vote
  TTL_UPC_NONE_S: 12 * 3600, // no data: short, so new data shows up the same day
  UPC_GAP_MS: 1000, // at most one GameUPC call per second per isolate, one at a time
  // Per-client (CF-Connecting-IP) fixed window, per isolate. Cache hits don't count.
  CLIENT_WINDOW_MS: 60 * 1000,
  CLIENT_MAX_LOOKUPS: 10, // upstream lookups per client per minute
  CLIENT_MAX_CONFIRMS: 5, // confirm POSTs per client per minute
  MAX_SEARCH_RESULTS: 40,
  KV_PREFIX: "tt1:",
  CONFIRM_DAILY_CAP: 10, // default; env CONFIRM_DAILY_CAP overrides
  BGG_DAILY_CAP: 200, // default; env BGG_DAILY_CAP overrides (Micah's number)
  SEEN_TTL_S: 10 * 60, // a confirm needs a non-match lookup by the same IP within this window
};
const USER_AGENT = "FreeRangeMedia-tabletop-relay/0.1 (personal, non-commercial; +https://freerangeice.github.io/media-shelf/)";

class Busy extends Error { constructor(s) { super("busy"); this.retryAfter = s; } }
class Upstream extends Error {}
class BadInput extends Error {}
class SlowDown extends Error { constructor(s) { super("slow down"); this.retryAfter = s; } }

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Expose-Headers": "Retry-After",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
const json = (body, status, origin, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra, ...(origin ? cors(origin) : {}) } });

// ---------- cache ----------
// Order: isolate memory -> KV (TT_CACHE, if bound) -> Cache API (caches.default, if present).
const mem = new Map();
const edge = () => (typeof caches !== "undefined" && caches.default ? caches.default : null);
const edgeKey = (k) => new Request(`https://tt-cache.invalid/${encodeURIComponent(k)}`);
async function cacheGet(env, key) {
  const k = CONFIG.KV_PREFIX + key;
  const hit = mem.get(k);
  if (hit && hit.until > Date.now()) return hit.v;
  let v = null;
  try {
    if (env.TT_CACHE) { const s = await env.TT_CACHE.get(k); v = s ? JSON.parse(s) : null; }
    else if (edge()) { const r = await edge().match(edgeKey(k)); v = r ? await r.json() : null; }
  } catch { v = null; }
  if (v) mem.set(k, { v, until: Date.now() + 60 * 1000 }); // short memory copy of a shared hit
  return v;
}
async function cachePut(env, key, v, ttl) {
  const k = CONFIG.KV_PREFIX + key;
  mem.set(k, { v, until: Date.now() + ttl * 1000 });
  try {
    if (env.TT_CACHE) await env.TT_CACHE.put(k, JSON.stringify(v), { expirationTtl: ttl });
    else if (edge()) await edge().put(edgeKey(k), new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${ttl}` } }));
  } catch {}
}
async function cacheDelete(env, key) {
  const k = CONFIG.KV_PREFIX + key;
  mem.delete(k);
  try {
    if (env.TT_CACHE) await env.TT_CACHE.delete(k);
    else if (edge()) await edge().delete(edgeKey(k));
  } catch {}
}

// ---------- per-client throttle (fixed window, per isolate) ----------
const clients = new Map();
function throttle(request, kind, max) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const now = Date.now();
  const k = `${kind}:${ip}`;
  let w = clients.get(k);
  if (!w || now - w.start >= CONFIG.CLIENT_WINDOW_MS) { w = { start: now, n: 0 }; clients.set(k, w); }
  if (clients.size > 5000) clients.clear(); // bounded memory
  w.n += 1;
  if (w.n > max) throw new SlowDown(Math.ceil((w.start + CONFIG.CLIENT_WINDOW_MS - now) / 1000));
}

// ---------- GameUPC (one call at a time, spaced; one in-flight lookup per UPC) ----------
let nextUpcAt = 0;
let upcChain = Promise.resolve();
function gameupc(env, path, init) {
  const run = async () => {
    const wait = nextUpcAt - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    nextUpcAt = Date.now() + CONFIG.UPC_GAP_MS;
    const base = CONFIG.GAMEUPC_HOSTS[env.GAMEUPC_BASE === "v1" ? "v1" : "test"];
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CONFIG.UPSTREAM_TIMEOUT_MS);
    try {
      return await fetch(`${base}${path}`, { ...init, headers: { "x-api-key": env.GAMEUPC_KEY, Accept: "application/json", "User-Agent": USER_AGENT, ...(init.headers || {}) }, signal: ctl.signal });
    } catch { throw new Upstream("GameUPC did not answer"); } finally { clearTimeout(timer); }
  };
  const p = upcChain.then(run, run);
  upcChain = p.catch(() => {});
  return p;
}
const inflight = new Map();

// ---------- BGG daily cap (same pattern as CONFIRM_DAILY_CAP) ----------
// One KV counter per UTC day (tt1:bgg:YYYY-MM-DD), all clients together. Counted before the
// call, never decremented. Admission runs inside bggChain (one BGG call at a time per isolate),
// and uses max(isolate memory, KV) so a stale KV read can't let extra calls in. No KV: fail closed.
class BggCapped extends Error { constructor(s) { super("bgg cap"); this.retryAfter = s; } }
class BggNoKv extends Error {}
const memBggDay = { day: "", n: 0 };
function bggDailyCap(env) {
  const n = Number(env.BGG_DAILY_CAP);
  return env.BGG_DAILY_CAP != null && env.BGG_DAILY_CAP !== "" && Number.isInteger(n) && n >= 0 ? n : CONFIG.BGG_DAILY_CAP;
}
async function admitBgg(env) {
  const kv = env.TT_CACHE;
  if (!kv) throw new BggNoKv();
  const now = Date.now();
  const day = utcDay(now);
  if (memBggDay.day !== day) { memBggDay.day = day; memBggDay.n = 0; }
  const capKey = `${CONFIG.KV_PREFIX}bgg:${day}`;
  const kvUsed = Number(await kv.get(capKey).catch(() => null)) || 0;
  const used = Math.max(memBggDay.n, kvUsed);
  if (used >= bggDailyCap(env)) throw new BggCapped(secsToUtcMidnight(now));
  memBggDay.n = used + 1;
  await kv.put(capKey, String(used + 1), { expirationTtl: 2 * 24 * 3600 }).catch(() => {});
}

// ---------- BGG (spaced calls, one at a time per isolate) ----------
let nextBggAt = 0;
let bggChain = Promise.resolve();
function bgg(env, path) {
  const run = async () => {
    await admitBgg(env); // daily cap, before any wait or call; throws BggCapped / BggNoKv
    const wait = nextBggAt - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    nextBggAt = Date.now() + CONFIG.BGG_GAP_MS;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CONFIG.UPSTREAM_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${CONFIG.BGG_API}${path}`, { headers: { Authorization: `Bearer ${env.BGG_API_TOKEN}`, Accept: "application/xml", "User-Agent": USER_AGENT }, signal: ctl.signal });
    } catch { throw new Upstream("BGG did not answer"); } finally { clearTimeout(timer); }
    if (res.status === 202 || res.status === 500 || res.status === 503 || res.status === 429) {
      nextBggAt = Math.max(nextBggAt, Date.now() + CONFIG.RETRY_LATER_S * 1000);
      throw new Busy(CONFIG.RETRY_LATER_S);
    }
    if (!res.ok) throw new Upstream(`BGG ${res.status}`); // 401 = token missing / wrong
    return res.text();
  };
  const p = bggChain.then(run, run);
  bggChain = p.catch(() => {});
  return p;
}

// ---------- tiny XML helpers (Workers have no DOMParser) ----------
const unxml = (s) => String(s || "").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");
const attrs = (tag) => { const o = {}; tag.replace(/([\w:-]+)="([^"]*)"/g, (_, k, v) => (o[k] = unxml(v))); return o; };
const items = (xml) => [...xml.matchAll(/<item\b([^>]*)>([\s\S]*?)<\/item>/g)].map((m) => ({ a: attrs(m[1]), body: m[2] }));
const first = (body, tag) => { const m = body.match(new RegExp(`<${tag}\\b([^>]*)/?>`)); return m ? attrs(m[1]) : null; };
const text = (body, tag) => { const m = body.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`)); return m ? unxml(m[1]).trim() : ""; };
const num = (v) => { const s = String(v == null ? "" : v).trim(); return s === "" || s === "0" ? "" : s; }; // BGG 0 = unknown

function parseSearch(xml) {
  return items(xml).map(({ a, body }) => {
    const name = first(body, "name");
    const year = first(body, "yearpublished");
    return { bggId: a.id, bggType: a.type, name: name ? name.value : "", year: year ? num(year.value) : "" };
  });
}

function parseThings(xml) {
  return items(xml).map(({ a, body }) => {
    const names = [...body.matchAll(/<name\b([^>]*)\/>/g)].map((m) => attrs(m[1]));
    const primary = names.find((n) => n.type === "primary") || names[0] || {};
    const v = (tag) => { const f = first(body, tag); return f ? num(f.value) : ""; };
    const links = [...body.matchAll(/<link\b([^>]*)\/>/g)].map((m) => attrs(m[1]));
    const minP = v("minplayers"), maxP = v("maxplayers");
    // UNVERIFIED mapping: the base game of an expansion is taken to be
    // <link type="boardgameexpansion" id=".." inbound="true"/> (BGG forum thread 1870921,
    // v1 sample). Needs a tokened test. The rpgitem equivalent is unknown.
    const parents = links.filter((l) => l.type === "boardgameexpansion" && l.inbound === "true").map((l) => ({ bggId: l.id, name: l.value }));
    // UNVERIFIED for rpgitem: designer link type and player / time fields may differ or be
    // absent (rpgdesigner?). Those fields stay optional and empty when not found.
    const designers = links.filter((l) => l.type === "boardgamedesigner" || l.type === "rpgdesigner").map((l) => l.value);
    return {
      bggId: a.id,
      bggType: a.type,
      bggIsExpansion: a.type === "boardgameexpansion",
      name: primary.value || "",
      year: v("yearpublished"),
      designer: designers.join(", "),
      players: minP && maxP ? (minP === maxP ? minP : `${minP}–${maxP}`) : minP || maxP,
      playTime: v("playingtime"),
      image: text(body, "image"),
      thumbnail: text(body, "thumbnail"),
      parents,
    };
  });
}

async function search(env, request, q) {
  const key = `s:${q.toLowerCase()}`;
  const hit = await cacheGet(env, key);
  if (hit) return hit;
  throttle(request, "get", CONFIG.CLIENT_MAX_LOOKUPS); // per-IP, cache misses only, before the daily cap counts
  const xmls = [];
  if (CONFIG.BGG_COMBINED_SEARCH) {
    xmls.push(await bgg(env, `/search?query=${encodeURIComponent(q)}&type=${CONFIG.BGG_SEARCH_TYPES.join(",")}`));
  } else {
    for (const t of CONFIG.BGG_SEARCH_TYPES) xmls.push(await bgg(env, `/search?query=${encodeURIComponent(q)}&type=${t}`)); // one at a time
  }
  const seen = new Set();
  const matches = xmls.flatMap(parseSearch).filter((m) => m.bggId && !seen.has(m.bggId) && seen.add(m.bggId)).slice(0, CONFIG.MAX_SEARCH_RESULTS);
  const out = { matches };
  await cachePut(env, key, out, CONFIG.TTL_SEARCH_S);
  return out;
}

async function things(env, request, ids) {
  const out = [];
  const missing = [];
  for (const id of ids) { const c = await cacheGet(env, `t:${id}`); c ? out.push(c) : missing.push(id); }
  if (missing.length) throttle(request, "get", CONFIG.CLIENT_MAX_LOOKUPS); // per-IP, cache misses only
  for (let i = 0; i < missing.length; i += CONFIG.BGG_MAX_THING_IDS) {
    const batch = missing.slice(i, i + CONFIG.BGG_MAX_THING_IDS);
    const parsed = parseThings(await bgg(env, `/thing?id=${batch.join(",")}`));
    for (const t of parsed) { out.push(t); await cachePut(env, `t:${t.bggId}`, t, CONFIG.TTL_THING_S); }
  }
  return { things: ids.map((id) => out.find((t) => t.bggId === id)).filter(Boolean) };
}

/** Normalise a GameUPC UpcInfo body. Exported for tests. */
function shapeUpc(upc, body) {
  const info = Array.isArray(body.bgg_info) ? body.bgg_info : [];
  // Passed on: id / name / published / thumbnail only. data_url (api.geekdo.com) and
  // update_url are dropped: the relay builds its own confirm URL, on its own host.
  const cand = (b) => ({ bggId: /^\d{1,9}$/.test(String(b.id || "")) ? String(b.id) : "", name: String(b.name || ""), year: num(b.published), thumbnail: /^https:\/\//.test(String(b.thumbnail_url || "")) ? String(b.thumbnail_url) : "" });
  const st = body.bgg_info_status;
  const base = { upc, name: String(body.name || ""), searchedFor: String(body.searched_for || "") };
  const cands = info.map(cand).filter((c) => c.bggId);
  if (st === "verified" && cands.length) return { ...base, status: "verified", candidates: [cands[0]] };
  if (st === "choose_from_bgg_info_or_search" && cands.length) return { ...base, status: "choose", candidates: cands };
  return { ...base, status: "none", candidates: [] }; // anything else, or an empty bgg_info: no data
}

const clientIp = (request) => request.headers.get("CF-Connecting-IP") || "local";
/** Record that this client was served a non-match ("choose"/"none") for upc. KV only. */
async function noteSeen(env, request, upc, out) {
  if (!env.TT_CACHE || !out || out.status === "verified") return;
  try {
    await env.TT_CACHE.put(`${CONFIG.KV_PREFIX}seen:${upc}:${clientIp(request)}`, String(Date.now()), { expirationTtl: CONFIG.SEEN_TTL_S });
  } catch {}
}
async function barcode(env, request, upc) {
  const out = await barcodeLookup(env, request, upc);
  await noteSeen(env, request, upc, out);
  return out;
}
async function barcodeLookup(env, request, upc) {
  const key = `u:${upc}`;
  const hit = await cacheGet(env, key);
  if (hit) return hit;
  if (inflight.has(upc)) return inflight.get(upc); // one upstream lookup per UPC at a time
  throttle(request, "get", CONFIG.CLIENT_MAX_LOOKUPS);
  const p = (async () => {
    const res = await gameupc(env, `/upc/${encodeURIComponent(upc)}`, { method: "GET" });
    if (res.status === 400) throw new BadInput("bad upc");
    if (res.status === 429) throw new Busy(CONFIG.RETRY_LATER_S); // "Overloaded; try again later."
    if (!res.ok) throw new Upstream(`GameUPC ${res.status}`);
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== "object") throw new Upstream("GameUPC shape");
    const out = shapeUpc(upc, body);
    const ttl = out.status === "verified" ? CONFIG.TTL_UPC_VERIFIED_S : out.status === "choose" ? CONFIG.TTL_UPC_CHOOSE_S : CONFIG.TTL_UPC_NONE_S;
    await cachePut(env, key, out, ttl);
    return out;
  })();
  inflight.set(upc, p);
  try { return await p; } finally { inflight.delete(upc); }
}

/** The one write. Only for a UPC this relay last saw as "choose" or "none", never "verified". */
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const secsToUtcMidnight = (t) => { const d = new Date(t); return Math.max(1, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - t) / 1000)); };
function dailyCap(env) {
  const n = Number(env.CONFIRM_DAILY_CAP);
  return Number.isInteger(n) && n >= 0 ? n : CONFIG.CONFIRM_DAILY_CAP;
}
// Confirm admission runs one at a time per isolate (like upcChain): seen-check, marker
// consumption, cap check and the day-count write all finish before the next admission starts
// and before any POST. memDay is this isolate's own count, so a slow or stale KV read can't
// let extra confirms in (admission uses max(memory, KV)).
let admitChain = Promise.resolve();
const memDay = { day: "", n: 0 };
function admitConfirm(env, request, upc) {
  const run = async () => {
    const kv = env.TT_CACHE;
    // 1. this client was served a non-match for this UPC in the last 10 minutes (KV record)
    const seenKey = `${CONFIG.KV_PREFIX}seen:${upc}:${clientIp(request)}`;
    const seenAt = Number(await kv.get(seenKey).catch(() => null));
    if (!seenAt || Date.now() - seenAt > CONFIG.SEEN_TTL_S * 1000) return { status: 409, body: { error: "not postable" } };
    const known = await cacheGet(env, `u:${upc}`);
    if (known && known.status === "verified") return { status: 409, body: { error: "not postable" } };
    throttle(request, "post", CONFIG.CLIENT_MAX_CONFIRMS);
    // 2. global daily cap (all clients). Counted before the POST, never decremented (a failed
    // POST still counts). KV is eventually consistent across data centres: a soft cap there.
    const now = Date.now();
    const day = utcDay(now);
    if (memDay.day !== day) { memDay.day = day; memDay.n = 0; }
    const capKey = `${CONFIG.KV_PREFIX}confirms:${day}`;
    const kvUsed = Number(await kv.get(capKey).catch(() => null)) || 0;
    const used = Math.max(memDay.n, kvUsed);
    if (used >= dailyCap(env)) throw new SlowDown(secsToUtcMidnight(now));
    memDay.n = used + 1;
    await kv.put(capKey, String(used + 1), { expirationTtl: 2 * 24 * 3600 }).catch(() => {});
    await kv.delete(seenKey).catch(() => {}); // one confirm per lookup
    return null; // admitted
  };
  const p = admitChain.then(run, run);
  admitChain = p.catch(() => {});
  return p;
}
const USER_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
async function confirmBarcode(env, request, upc, bggId, userId) {
  const refused = await admitConfirm(env, request, upc);
  if (refused) return refused;
  const res = await gameupc(env, `/upc/${encodeURIComponent(upc)}/bgg_id/${bggId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  });
  if (res.status === 400) throw new BadInput("bad upc");
  if (res.status === 429) throw new Busy(CONFIG.RETRY_LATER_S);
  if (!res.ok) throw new Upstream(`GameUPC ${res.status}`);
  await cacheDelete(env, `u:${upc}`); // next lookup reads the updated record
  return { status: 200, body: { ok: true } };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    // DEV_ORIGIN (local testing only, e.g. "http://127.0.0.1:8841"): one extra loopback origin.
    const dev = typeof env.DEV_ORIGIN === "string" && /^http:\/\/127\.0\.0\.1:\d+$/.test(env.DEV_ORIGIN) ? env.DEV_ORIGIN : "";
    const allowed = ALLOWED_ORIGINS.has(origin) || (dev !== "" && origin === dev);
    if (request.method === "OPTIONS") return allowed ? new Response(null, { status: 204, headers: cors(origin) }) : new Response(null, { status: 403 });
    if (!allowed) return json({ error: "origin not allowed" }, 403, null);
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/barcode/confirm") {
        if (!env.GAMEUPC_KEY) return json({ error: "not configured" }, 503, origin);
        if (!env.TT_CACHE) return json({ error: "not configured" }, 503, origin); // no KV: no cap, no record -> never POST
        const b = await request.json().catch(() => null);
        const upc = String((b && b.upc) || "").trim();
        const bggId = String((b && b.bggId) || "").trim();
        if (!/^\d{8,14}$/.test(upc) || !/^[1-9]\d{0,8}$/.test(bggId)) return json({ error: "upc and bggId required" }, 400, origin);
        // Checked before admission, so a bad id never uses up the lookup record or the day's cap.
        const userId = b && typeof b.userId === "string" ? b.userId : "";
        if (!USER_ID_RE.test(userId)) return json({ error: "userId: 8 to 64 letters, digits or dashes" }, 400, origin);
        const r = await confirmBarcode(env, request, upc, bggId, userId);
        return json(r.body, r.status, origin);
      }
      if (request.method !== "GET") return json({ error: "not found" }, 404, origin);
      if (url.pathname === "/search") {
        if (!env.BGG_API_TOKEN) return json({ error: "not configured" }, 503, origin);
        const q = (url.searchParams.get("q") || "").trim();
        if (q.length < 2 || q.length > 100) return json({ error: "q must be 2 to 100 characters" }, 400, origin);
        return json(await search(env, request, q), 200, origin);
      }
      if (url.pathname === "/thing") {
        if (!env.BGG_API_TOKEN) return json({ error: "not configured" }, 503, origin);
        const ids = [...new Set((url.searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean))];
        if (!ids.length || ids.length > CONFIG.BGG_MAX_THING_IDS || !ids.every((s) => /^[1-9]\d{0,8}$/.test(s))) return json({ error: "ids: 1 to 20 numbers" }, 400, origin);
        return json(await things(env, request, ids), 200, origin);
      }
      if (url.pathname === "/barcode") {
        if (!env.GAMEUPC_KEY) return json({ error: "not configured" }, 503, origin);
        const upc = (url.searchParams.get("upc") || "").trim();
        if (!/^\d{8,14}$/.test(upc)) return json({ error: "upc must be 8 to 14 digits" }, 400, origin);
        return json(await barcode(env, request, upc), 200, origin);
      }
      return json({ error: "not found" }, 404, origin);
    } catch (err) {
      if (err instanceof BggCapped) return json({ error: "bgg daily cap reached" }, 503, origin, { "Retry-After": String(err.retryAfter) });
      if (err instanceof BggNoKv) return json({ error: "not configured" }, 503, origin);
      if (err instanceof Busy) return json({ error: "busy" }, 503, origin, { "Retry-After": String(err.retryAfter) });
      if (err instanceof SlowDown) return json({ error: "slow down" }, 429, origin, { "Retry-After": String(err.retryAfter) });
      if (err instanceof BadInput) return json({ error: "bad upc" }, 400, origin);
      return json({ error: "upstream" }, 502, origin);
    }
  },
};

// Exported for local unit tests only.
export const _test = { USER_ID_RE, parseSearch, parseThings, shapeUpc, CONFIG, secsToUtcMidnight, utcDay, bggDailyCap };
