// FreeRangeMedia Tabletop lookup relay (BoardGameGeek XML API2 + GameUPC).
// SOURCE ONLY. Not deployed, and the app is NOT wired to it (tabletop.js LOOKUP_RELAY_URL
// is empty). Modelled on the frm-gcd relay: origin-locked, own CORS, upstream keys held as
// Worker secrets, answers cached. See relay/README-tabletop.md for what it needs.
//
// Secrets (wrangler secret put, never committed):
//   BGG_TOKEN    BoardGameGeek application token (boardgamegeek.com/applications)
//   GAMEUPC_KEY  GameUPC x-api-key
// Vars (wrangler.toml [vars], optional):
//   GAMEUPC_BASE "test" | "v1"   (default "test"; /test "will be wiped periodically")
// KV (optional): TT_CACHE. Without it, answers are cached in isolate memory only.
//
// Routes (GET, from ALLOWED_ORIGINS only):
//   /search?q=NAME           -> { matches: [{ bggId, bggType, name, year }] }  (user picks; never auto-picked)
//   /thing?ids=1,2,...       -> { things: [Thing] }  (at most 20 ids)
//   /barcode?upc=DIGITS      -> { upc, status: "verified"|"choose"|"none", candidates: [{ bggId, name, year, thumbnail }] }
//   errors: 400 bad input / bad UPC, 503 + Retry-After { error: "busy" }, 502 { error: "upstream" }
//
// NOTHING HERE HAS BEEN RUN AGAINST THE REAL APIS (no BGG token yet).
// Never POSTs anything: GameUPC's update_url (user confirmation) is never called.
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
  TTL_UPC_S: 7 * 24 * 3600,
  MAX_SEARCH_RESULTS: 40,
  KV_PREFIX: "tt1:",
};
const USER_AGENT = "FreeRangeMedia-tabletop-relay/0.1 (personal, non-commercial; +https://freerangeice.github.io/media-shelf/)";

class Busy extends Error { constructor(s) { super("busy"); this.retryAfter = s; } }
class Upstream extends Error {}
class BadInput extends Error {}

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
const json = (body, status, origin, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra, ...(origin ? cors(origin) : {}) } });

// ---------- cache ----------
const mem = new Map();
async function cacheGet(env, key) {
  const k = CONFIG.KV_PREFIX + key;
  if (env.TT_CACHE) { const v = await env.TT_CACHE.get(k); return v ? JSON.parse(v) : null; }
  const hit = mem.get(k);
  return hit && hit.until > Date.now() ? hit.v : null;
}
async function cachePut(env, key, v, ttl) {
  const k = CONFIG.KV_PREFIX + key;
  if (env.TT_CACHE) await env.TT_CACHE.put(k, JSON.stringify(v), { expirationTtl: ttl });
  else mem.set(k, { v, until: Date.now() + ttl * 1000 });
}

// ---------- BGG (spaced calls, one at a time per isolate) ----------
let nextBggAt = 0;
let bggChain = Promise.resolve();
function bgg(env, path) {
  const run = async () => {
    const wait = nextBggAt - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    nextBggAt = Date.now() + CONFIG.BGG_GAP_MS;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CONFIG.UPSTREAM_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${CONFIG.BGG_API}${path}`, { headers: { Authorization: `Bearer ${env.BGG_TOKEN}`, Accept: "application/xml", "User-Agent": USER_AGENT }, signal: ctl.signal });
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

async function search(env, q) {
  const key = `s:${q.toLowerCase()}`;
  const hit = await cacheGet(env, key);
  if (hit) return hit;
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

async function things(env, ids) {
  const out = [];
  const missing = [];
  for (const id of ids) { const c = await cacheGet(env, `t:${id}`); c ? out.push(c) : missing.push(id); }
  for (let i = 0; i < missing.length; i += CONFIG.BGG_MAX_THING_IDS) {
    const batch = missing.slice(i, i + CONFIG.BGG_MAX_THING_IDS);
    const parsed = parseThings(await bgg(env, `/thing?id=${batch.join(",")}`));
    for (const t of parsed) { out.push(t); await cachePut(env, `t:${t.bggId}`, t, CONFIG.TTL_THING_S); }
  }
  return { things: ids.map((id) => out.find((t) => t.bggId === id)).filter(Boolean) };
}

async function barcode(env, upc) {
  const key = `u:${upc}`;
  const hit = await cacheGet(env, key);
  if (hit) return hit;
  const base = CONFIG.GAMEUPC_HOSTS[env.GAMEUPC_BASE === "v1" ? "v1" : "test"];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CONFIG.UPSTREAM_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${base}/upc/${encodeURIComponent(upc)}`, { method: "GET", headers: { "x-api-key": env.GAMEUPC_KEY, Accept: "application/json", "User-Agent": USER_AGENT }, signal: ctl.signal });
  } catch { throw new Upstream("GameUPC did not answer"); } finally { clearTimeout(timer); }
  if (res.status === 400) throw new BadInput("bad upc");
  if (res.status === 429) throw new Busy(CONFIG.RETRY_LATER_S); // "Overloaded; try again later."
  if (!res.ok) throw new Upstream(`GameUPC ${res.status}`);
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== "object") throw new Upstream("GameUPC shape");
  const info = Array.isArray(body.bgg_info) ? body.bgg_info : [];
  // Only id / name / published / thumbnail are passed on. data_url (api.geekdo.com) and
  // update_url are dropped: the app pulls the thing from BGG via /thing, and never confirms.
  const cand = (b) => ({ bggId: String(b.id || ""), name: String(b.name || ""), year: num(b.published), thumbnail: String(b.thumbnail_url || "") });
  let out;
  if (body.bgg_info_status === "verified" && info.length) out = { upc, status: "verified", candidates: [cand(info[0])] };
  else if (body.bgg_info_status === "choose_from_bgg_info_or_search" && info.length) out = { upc, status: "choose", candidates: info.map(cand).filter((c) => c.bggId) };
  else out = { upc, status: "none", candidates: [] }; // no-data shape not documented: treat as a miss (app keeps the code, falls back to name search)
  await cachePut(env, key, out, CONFIG.TTL_UPC_S);
  return out;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.has(origin);
    if (request.method === "OPTIONS") return allowed ? new Response(null, { status: 204, headers: cors(origin) }) : new Response(null, { status: 403 });
    if (!allowed) return json({ error: "origin not allowed" }, 403, null);
    if (request.method !== "GET") return json({ error: "not found" }, 404, origin);
    const url = new URL(request.url);
    try {
      if (url.pathname === "/search") {
        if (!env.BGG_TOKEN) return json({ error: "not configured" }, 503, origin);
        const q = (url.searchParams.get("q") || "").trim();
        if (q.length < 2 || q.length > 100) return json({ error: "q must be 2 to 100 characters" }, 400, origin);
        return json(await search(env, q), 200, origin);
      }
      if (url.pathname === "/thing") {
        if (!env.BGG_TOKEN) return json({ error: "not configured" }, 503, origin);
        const ids = [...new Set((url.searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean))];
        if (!ids.length || ids.length > CONFIG.BGG_MAX_THING_IDS || !ids.every((s) => /^[1-9]\d{0,8}$/.test(s))) return json({ error: "ids: 1 to 20 numbers" }, 400, origin);
        return json(await things(env, ids), 200, origin);
      }
      if (url.pathname === "/barcode") {
        if (!env.GAMEUPC_KEY) return json({ error: "not configured" }, 503, origin);
        const upc = (url.searchParams.get("upc") || "").trim();
        if (!/^\d{8,14}$/.test(upc)) return json({ error: "upc must be 8 to 14 digits" }, 400, origin);
        return json(await barcode(env, upc), 200, origin);
      }
      return json({ error: "not found" }, 404, origin);
    } catch (err) {
      if (err instanceof Busy) return json({ error: "busy" }, 503, origin, { "Retry-After": String(err.retryAfter) });
      if (err instanceof BadInput) return json({ error: "bad upc" }, 400, origin);
      return json({ error: "upstream" }, 502, origin);
    }
  },
};

// Exported for local unit tests only.
export const _test = { parseSearch, parseThings, CONFIG };
