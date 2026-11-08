// Official API traffic is entirely mocked. Dummy credentials only; never process.env secrets.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const mod = await import(process.env.GAME_WORKER_MODULE ? pathToFileURL(process.env.GAME_WORKER_MODULE) : "../relay/game-worker.js");
const { createGameRelay, usableTitle, sanitizeGames, retrySeconds } = mod;
let pass = 0, fail = 0;
function check(name, ok) { try { assert.ok(ok); pass++; console.log("PASS", name); } catch { fail++; console.log("FAIL", name); } }
const ORIGIN = "http://127.0.0.1:8894";
const game = { id: 42, name: "Hades", first_release_date: 1600300800, cover: { image_id: "co1234" }, platforms: [{ name: "Nintendo Switch" }], involved_companies: [{ developer: true, company: { name: "Supergiant Games" } }] };
function setup({ handler, cap = 500, kv, storage, expiry = 1000, timeoutMs = 50 } = {}) {
  let clock = Date.UTC(2026, 10, 8), calls = [], tokenCalls = 0, gameCalls = 0;
  const memory = () => { const map = new Map(); return { map, async get(k) { return map.get(k); }, async put(k,v) { map.set(k,v); } }; };
  const limits = kv || memory(), store = storage || memory();
  const env = { ALLOWED_ORIGINS: ORIGIN, TWITCH_CLIENT_ID: "dummy-client-id", TWITCH_CLIENT_SECRET: "dummy-secret-value", GAME_LIMITS: limits, IGDB_APP_DAILY_CAP: String(cap) };
  const upstream = async (url, init) => {
    calls.push({ url, init, at: clock });
    if (url === "https://id.twitch.tv/oauth2/token") { tokenCalls++; if (handler) { const r = await handler("token", tokenCalls, init); if (r) return r; } return Response.json({ access_token: `dummy-token-${tokenCalls}`, expires_in: expiry }); }
    assert.equal(url, "https://api.igdb.com/v4/games"); gameCalls++;
    if (handler) { const r = await handler("game", gameCalls, init); if (r) return r; }
    return Response.json([game]);
  };
  const relay = createGameRelay(env, { upstream, now: () => clock, sleep: async ms => { clock += ms; }, storage: store, timeoutMs });
  return { relay, env, calls, limits, store, now: () => clock, advance: ms => clock += ms, get tokenCalls() { return tokenCalls; }, get gameCalls() { return gameCalls; },
    request(title = "Hades", { ip = "127.0.0.1", origin = ORIGIN, method = "GET", extra = "" } = {}) { return relay.fetch(new Request(`https://relay.invalid/game/search?title=${encodeURIComponent(title)}${extra}`, { method, headers: { Origin: origin, "CF-Connecting-IP": ip } })); }
  };
}
check("title normalized without guessing a barcode", usableTitle("  Hades   II  ") === "Hades II" && usableTitle("012345678901") === "" && usableTitle(" ") === "");
check("title URL/control/oversize rejected", !usableTitle("https://evil.invalid") && !usableTitle("Halo\nInjected") && !usableTitle("a".repeat(161)));
check("Retry-After numeric and HTTP date parsed", retrySeconds("31", 0) === 31 && retrySeconds("Thu, 01 Jan 1970 00:01:00 GMT", 0) === 60);
check("response cover host constructed from validated image ID", sanitizeGames([game])[0].coverUrl === "https://images.igdb.com/igdb/image/upload/t_cover_big/co1234.jpg");
check("malicious provider IDs/cover references dropped", sanitizeGames([{ ...game, id: "javascript:1" }]).length === 0 && sanitizeGames([{ ...game, cover: { image_id: "../../evil" } }])[0].coverUrl === "");
{
  const s = setup();
  for (const title of ["", "   ", "012345678901", "https://evil.invalid", "Halo\u0000query", "a".repeat(161)]) check(`invalid title ${JSON.stringify(title).slice(0,30)} rejected before provider`, (await s.request(title)).status === 400);
  check("invalid titles spend no upstream requests", s.calls.length === 0);
  check("unknown parameters cannot become a generic proxy", (await s.request("Hades", { extra: "&url=https://evil.invalid" })).status === 400);
  check("duplicate title parameters rejected", (await s.request("Hades", { extra: "&title=Halo" })).status === 400);
  check("unapproved origins rejected", (await s.request("Hades", { origin: "https://evil.invalid" })).status === 403);
  check("client POST rejected", (await s.request("Hades", { method: "POST" })).status === 405);
  check("preflight exposes GET only", (await s.request("Hades", { method: "OPTIONS" })).headers.get("Access-Control-Allow-Methods") === "GET, OPTIONS");
}
{
  const s = setup(); delete s.env.GAME_LIMITS;
  const r = await s.request(); check("missing required KV fails 503 before token or IGDB", r.status === 503 && s.calls.length === 0);
}
{
  const s = setup(); delete s.env.TWITCH_CLIENT_SECRET;
  check("missing secret fails closed before upstream", (await s.request()).status === 503 && s.calls.length === 0);
}
{
  const s = setup({ cap: 10001 }); check("unbounded app-owned cap rejected", (await s.request()).status === 503 && s.calls.length === 0);
}
{
  const s = setup(); const r = await s.request('Halo "; fields *;'); const data = await r.json();
  check("usable title search returns explicit IGDB IDs", r.status === 200 && data.source === "igdb" && data.candidates[0].igdbId === "42");
  const token = s.calls[0], query = s.calls[1];
  check("Twitch credentials in server POST body, never URL", !token.url.includes("dummy-") && new URLSearchParams(token.init.body).get("grant_type") === "client_credentials");
  check("APICalypse search safely quotes user title, fixed fields and limit", query.init.body.startsWith('search "Halo \\"; fields *;"; fields id,name,') && query.init.body.endsWith("limit 10;"));
  check("query never contains barcode/UPC/EAN fields", !/barcode|\bupc\b|\bean\b/i.test(query.init.body));
  check("response never includes token/client secret", !JSON.stringify(data).includes("dummy-"));
  check("cache disabled and CORS scoped", r.headers.get("Cache-Control") === "no-store" && r.headers.get("Access-Control-Allow-Origin") === ORIGIN);
  await s.request(); check("unexpired token reused", s.tokenCalls === 1 && s.gameCalls === 2);
}
{
  const s = setup({ expiry: 100 }); await s.request(); s.advance(91000); await s.request();
  check("expires_in drives proactive renewal", s.tokenCalls === 2);
}
{
  const s = setup({ handler: async (kind, n) => kind === "game" && n === 1 ? new Response(null, { status: 401 }) : null });
  check("one 401 refresh/retry succeeds", (await s.request()).status === 200 && s.tokenCalls === 2 && s.gameCalls === 2);
}
{
  const s = setup({ handler: async kind => kind === "game" ? new Response(null, { status: 401 }) : null });
  const r = await s.request();
  check("persistent 401 retries exactly once", r.status === 503 && s.tokenCalls === 2 && s.gameCalls === 2);
  const n = s.calls.length; await s.request(); check("auth failure cooldown prevents token storms", s.calls.length === n);
}
{
  const s = setup({ handler: async kind => kind === "token" ? new Response(null, { status: 400 }) : null });
  const r = await s.request(); check("bad Twitch auth sanitized, no IGDB call", r.status === 503 && s.gameCalls === 0 && !JSON.stringify(await r.json()).includes("dummy-"));
}
{
  const s = setup({ handler: async kind => kind === "game" ? new Response(null, { status: 429, headers: { "Retry-After": "123" } }) : null });
  const r = await s.request(); check("429 returned with provider Retry-After, no immediate retry", r.status === 429 && r.headers.get("Retry-After") === "123" && s.gameCalls === 1);
  await s.request(); check("429 stops subsequent upstream starts during cooldown", s.gameCalls === 1);
}
{
  const s = setup({ handler: async kind => kind === "game" ? new Response(null, { status: 500 }) : null });
  check("provider 500 not retried", (await s.request()).status === 502 && s.gameCalls === 1);
}
{
  const s = setup({ handler: async (kind, n, init) => kind === "game" ? new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("dummy sensitive error")))) : null, timeoutMs: 5 });
  const r = await s.request(); check("timeout bounded and sanitized", r.status === 504 && !JSON.stringify(await r.json()).includes("dummy"));
}
{
  const s = setup({ handler: async kind => kind === "game" ? Response.json([]) : null });
  const r = await s.request(); check("no match is an empty candidate list, not guessed data", r.status === 200 && (await r.json()).candidates.length === 0);
}
{
  const s = setup({ cap: 2 }); await s.request(); await s.request(); const r = await s.request();
  check("app-owned daily cap limits actual IGDB attempts", r.status === 429 && (await r.json()).error === "app_daily_limit" && s.gameCalls === 2);
  const next = setup({ cap: 2, kv: s.limits, storage: s.store });
  check("daily guard survives object restart", (await next.request()).status === 429 && next.gameCalls === 0);
}
{
  const s = setup(); let r;
  for (let i = 0; i < 11; i++) r = await s.request();
  check("per-IP ten-per-minute throttle", r.status === 429 && (await r.json()).error === "client_limit" && s.gameCalls === 10);
}
{
  const s = setup(); const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => s.request("Hades", { ip: "ip-" + i })));
  check("concurrent searches coalesce token acquisition", rs.every(r => r.status === 200) && s.tokenCalls === 1);
  const starts = s.calls.filter(c => c.url.endsWith("/games")).map(c => c.at);
  check("upstream starts spaced below four-per-second", starts.every((t, i) => !i || t - starts[i-1] >= 250));
}
{
  let unblock;
  const held = new Promise(r => { unblock = r; });
  const s = setup({ handler: async kind => { if (kind === "game") { await held; return Response.json([game]); } } });
  const rs = Array.from({ length: 10 }, (_, i) => s.request("Hades", { ip: "hold-" + i }));
  // Drain asynchronous admission without wall-clock waits.
  for (let i = 0; i < 400; i++) await Promise.resolve();
  check("at most eight open IGDB calls", s.gameCalls === 8);
  unblock(); const result = await Promise.all(rs);
  check("excess concurrent requests fail boundedly rather than exceed eight", result.filter(r => r.status === 429).length === 2);
}
{
  const s = setup({ cap: 3 });
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => s.request("Hades", { ip: "cap-" + i })));
  check("concurrent cap admissions do not race past daily limit", rs.filter(r => r.status === 200).length === 3 && s.gameCalls === 3);
}
{
  const s = setup({ handler: async (kind, n, init) => kind === "game" && init.headers.Authorization === "Bearer dummy-token-1" ? new Response(null, { status: 401 }) : null });
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => s.request("Hades", { ip: "refresh-" + i })));
  check("parallel stale-token 401s coalesce to one renewed token", rs.every(r => r.status === 200) && s.tokenCalls === 2 && s.gameCalls <= 16);
}
{
  const s = setup({ kv: { async get() { throw new Error("dummy KV failure"); }, async put() {} } });
  check("KV I/O failure spends no provider or token request", (await s.request()).status === 503 && s.calls.length === 0);
}

{
  const r = await mod.default.fetch(new Request(`https://relay.invalid/game/search?title=Hades`, { headers: { Origin: ORIGIN } }), { ALLOWED_ORIGINS: ORIGIN });
  check("production missing Durable Object/KV fails closed with CORS", r.status === 503 && r.headers.get("Access-Control-Allow-Origin") === ORIGIN);
}
console.log(`\n${pass}/${pass+fail} passed`); process.exitCode = fail ? 1 : 0;
