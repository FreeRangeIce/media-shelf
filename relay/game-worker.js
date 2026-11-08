/* IGDB title-only relay. Official APIs only; no browser secrets, arbitrary URLs or barcode queries.
 * All production traffic goes through ONE Durable Object (see README-games.md).
 * IGDB documents 4 requests/s and 8 open requests, NOT a daily provider allowance.
 */
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const GAMES_URL = "https://api.igdb.com/v4/games";
const FIELDS = "id,name,first_release_date,cover.image_id,platforms.name,involved_companies.developer,involved_companies.company.name";
export function usableTitle(value) {
  const s = typeof value === "string" ? value.normalize("NFKC").replace(/\s+/g, " ").trim() : "";
  return s.length >= 2 && s.length <= 160 && /\p{L}/u.test(s) && !/[\u0000-\u001f\u007f]/.test(value) && !/https?:\/\//i.test(s) ? s : "";
}
class RelayError extends Error {
  constructor(status, code, retry = 0) { super(code); this.status = status; this.code = code; this.retry = retry; }
}
export function retrySeconds(value, now = Date.now()) {
  if (!value) return 1;
  const n = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(n) && n > 0 ? Math.min(31536000, Math.ceil(n)) : 1;
}
const bounded = (v, max = 160) => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "";
export function sanitizeGames(rows) {
  if (!Array.isArray(rows)) throw new RelayError(502, "invalid_provider_response");
  return rows.slice(0, 10).flatMap(g => {
    if (!Number.isSafeInteger(g?.id) || g.id <= 0 || !usableTitle(g.name)) return [];
    const image = g.cover?.image_id;
    const coverUrl = typeof image === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(image) ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${image}.jpg` : "";
    const seconds = Number(g.first_release_date), date = new Date(seconds * 1000);
    const year = Number.isFinite(seconds) && seconds > 0 && date.getUTCFullYear() <= 2200 ? date.getUTCFullYear() : null;
    const platforms = Array.isArray(g.platforms) ? g.platforms.slice(0, 30).map(p => bounded(p?.name, 80)).filter(Boolean) : [];
    const creator = Array.isArray(g.involved_companies) ? g.involved_companies.filter(c => c?.developer === true).slice(0, 8).map(c => bounded(c.company?.name, 80)).filter(Boolean).join(", ").slice(0, 200) : "";
    return [{ igdbId: String(g.id), title: usableTitle(g.name), year, creator, platforms, coverUrl, coverSource: "igdb", coverSourceId: String(g.id) }];
  });
}
/** Dependency injection is for isolated tests; production uses only the constant official URLs. */
export function createGameRelay(env, { upstream = fetch, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)), storage, timeoutMs = 8000 } = {}) {
  let token = null, refreshing = null, authBlocked = 0, providerBlocked = 0, nextStart = 0, active = 0, waiting = 0;
  let startQueue = Promise.resolve();
  const clients = new Map();
  const counters = new Map();
  const appCap = Number(env.IGDB_APP_DAILY_CAP || 500);
  const capValid = Number.isInteger(appCap) && appCap >= 1 && appCap <= 10000;
  async function jsonRequest(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await upstream(url, { ...init, signal: controller.signal, redirect: "manual" });
      // Workers supports manual, not error. Reject every redirect without following it,
      // so bearer tokens/client credentials can never be forwarded to a new host.
      if (res.status >= 300 && res.status < 400) { await res.body?.cancel(); throw new RelayError(502, "provider_redirect_rejected"); }
      if (!res.ok) { await res.body?.cancel(); return { status: res.status, headers: res.headers }; }
      const reader = res.body?.getReader();
      if (!reader) throw new RelayError(502, "invalid_provider_response");
      const chunks = []; let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 256 * 1024) { await reader.cancel(); throw new RelayError(502, "invalid_provider_response"); }
        chunks.push(value);
      }
      const data = new Uint8Array(bytes); let offset = 0;
      chunks.forEach(chunk => { data.set(chunk, offset); offset += chunk.byteLength; });
      try { return { status: res.status, headers: res.headers, data: JSON.parse(new TextDecoder().decode(data)) }; }
      catch { throw new RelayError(502, "invalid_provider_response"); }
    } catch (e) {
      if (e instanceof RelayError) throw e;
      throw new RelayError(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? "provider_timeout" : "provider_unavailable");
    } finally { clearTimeout(timer); }
  }
  async function getToken() {
    if (now() < authBlocked) throw new RelayError(503, "authentication_unavailable", Math.ceil((authBlocked - now()) / 1000));
    if (token && token.expires_at - token.skew > now()) return token.access_token;
    if (!refreshing) refreshing = (async () => {
      const body = new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, client_secret: env.TWITCH_CLIENT_SECRET, grant_type: "client_credentials" });
      const r = await jsonRequest(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
      const secs = Number(r.data?.expires_in), access = r.data?.access_token;
      if (r.status === 429) { const retry = retrySeconds(r.headers.get("Retry-After"), now()); authBlocked = now() + retry * 1000; throw new RelayError(429, "authentication_busy", retry); }
      if (r.status !== 200 || typeof access !== "string" || !/^[A-Za-z0-9._-]{8,2048}$/.test(access) || !Number.isFinite(secs) || secs <= 0 || secs > 31536000) throw new RelayError(503, "authentication_unavailable", 30);
      token = { access_token: access, expires_at: now() + secs * 1000, skew: Math.min(60000, secs * 100) };
      return access;
    })().catch(e => { authBlocked = Math.max(authBlocked, now() + (e.retry || 30) * 1000); throw e; }).finally(() => { refreshing = null; });
    return refreshing;
  }
  async function admitStart(makeRequest) {
    if (waiting >= 16) throw new RelayError(429, "relay_busy", 1);
    waiting++;
    const job = startQueue.catch(() => {}).then(async () => {
      if (now() < providerBlocked) throw new RelayError(429, "provider_busy", Math.ceil((providerBlocked - now()) / 1000));
      if (active >= 8) throw new RelayError(429, "relay_busy", 1);
      const delay = nextStart - now(); if (delay > 0) await sleep(delay);
      if (now() < providerBlocked) throw new RelayError(429, "provider_busy", Math.ceil((providerBlocked - now()) / 1000));
      const day = new Date(now()).toISOString().slice(0, 10), key = `igdb-app:${day}`;
      const [kvUsed, stored] = await Promise.all([env.GAME_LIMITS.get(key), storage.get(key)]);
      const used = Math.max(Number(kvUsed) || 0, Number(stored) || 0, counters.get(key) || 0);
      if (used >= appCap) {
        const midnight = Date.parse(day + "T00:00:00Z") + 86400000;
        throw new RelayError(429, "app_daily_limit", Math.max(1, Math.ceil((midnight - now()) / 1000)));
      }
      await storage.put(key, used + 1); // authoritative single-object durable counter
      await env.GAME_LIMITS.put(key, String(used + 1), { expirationTtl: 172800 }); // required fail-closed mirror
      counters.clear(); counters.set(key, used + 1);
      // Acquire auth BEFORE reserving the actual start time: a slow token fetch must
      // not release a burst of already-admitted requests together.
      const bearer = await getToken();
      nextStart = now() + 260; active++;
      return { bearer, response: makeRequest(bearer) };
    });
    startQueue = job;
    try { return await job; } catch (e) { throw e instanceof RelayError ? e : new RelayError(503, "limits_unavailable"); }
    finally { waiting--; }
  }
  async function search(title) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const job = await admitStart(bearer => jsonRequest(GAMES_URL, { method: "POST", headers: { "Client-ID": env.TWITCH_CLIENT_ID, Authorization: `Bearer ${bearer}`, Accept: "application/json", "Content-Type": "text/plain" }, body: `search ${JSON.stringify(title)}; fields ${FIELDS}; limit 10;` }));
      let r;
      try { r = await job.response; } finally { active--; }
      const bearer = job.bearer;
      if (r.status === 401 && attempt === 0) {
        if (token?.access_token === bearer) token = null;
        continue;
      }
      if (r.status === 401 || r.status === 403) { if (token?.access_token === bearer) token = null; authBlocked = now() + 30000; throw new RelayError(503, "authentication_unavailable", 30); }
      if (r.status === 429) { const retry = retrySeconds(r.headers.get("Retry-After"), now()); providerBlocked = now() + retry * 1000; throw new RelayError(429, "provider_busy", retry); }
      if (r.status !== 200) throw new RelayError(502, "provider_unavailable");
      return sanitizeGames(r.data);
    }
  }

  return { async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const origins = String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin", "X-Content-Type-Options": "nosniff" };
    if (origins.includes(origin)) Object.assign(headers, { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Expose-Headers": "Retry-After" });
    const reply = (body, status = 200, retry = 0) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...(retry ? { "Retry-After": String(retry) } : {}) } });
    if (!origins.includes(origin)) return reply({ error: "origin_not_allowed" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "GET") return reply({ error: "method_not_allowed" }, 405);
    try {
      if (request.url.length > 2400) throw new RelayError(414, "invalid_request");
      const u = new URL(request.url);
      if (u.pathname !== "/game/search" || [...u.searchParams.keys()].some(k => k !== "title") || u.searchParams.getAll("title").length !== 1) throw new RelayError(400, "invalid_request");
      const title = usableTitle(u.searchParams.get("title"));
      if (!title) throw new RelayError(400, "usable_title_required");
      if (!env.GAME_LIMITS || !storage || !capValid || !env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) throw new RelayError(503, "relay_not_configured");
      const ip = (request.headers.get("CF-Connecting-IP") || "unknown").slice(0, 64), t = now();
      for (const [key, value] of clients) if (t - value.start >= 60000) clients.delete(key);
      let client = clients.get(ip);
      if (!client || t - client.start >= 60000) { client = { start: t, n: 0 }; if (clients.size >= 2048) throw new RelayError(429, "relay_busy", 60); clients.set(ip, client); }
      if (++client.n > 10) throw new RelayError(429, "client_limit", Math.max(1, Math.ceil((client.start + 60000 - t) / 1000)));
      for (const [key, value] of clients) if (t - value.start >= 60000) clients.delete(key);
      return reply({ source: "igdb", candidates: await search(title) });
    } catch (e) { return reply({ error: e instanceof RelayError ? e.code : "relay_unavailable" }, e instanceof RelayError ? e.status : 503, e.retry || 0); }
  } };
}
export class GameCoordinator {
  constructor(state, env) { this.relay = createGameRelay(env, { storage: state.storage }); }
  fetch(request) { return this.relay.fetch(request); }
}
export default { async fetch(request, env) {
  if (!env.GAME_COORDINATOR || !env.GAME_LIMITS) return createGameRelay(env).fetch(request);
  return env.GAME_COORDINATOR.get(env.GAME_COORDINATOR.idFromName("game-upstream-v1")).fetch(request);
} };
