// BGG_DAILY_CAP (relay/tabletop-worker.js), plain node, every BGG call mocked. LOCAL ONLY.
//   node tests/tabletop-relay-bgg.test.mjs
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
let bggCalls = 0, lastUrl = "", lastAuth = "";
globalThis.fetch = async (u, i = {}) => {
  bggCalls++; lastUrl = String(u); lastAuth = (i.headers || {}).Authorization || "";
  if (lastUrl.includes("/thing")) return new Response(`<items><item type="boardgame" id="${/id=(\d+)/.exec(lastUrl)[1]}"><name type="primary" value="G"/></item></items>`, { status: 200 });
  return new Response(`<items><item type="boardgame" id="13"><name type="primary" value="Catan"/></item></items>`, { status: 200 });
};
let w, iso = 0;
const fresh = async () => { const m = await import(`../relay/tabletop-worker.js?bgg=${++iso}`); m._test.CONFIG.BGG_GAP_MS = 0; m._test.CONFIG.BGG_COMBINED_SEARCH = true; w = m.default; return m; };
const kv = () => { const m = new Map(); return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } }; };
const O = "https://freerangeice.github.io";
const thing = (env, id, origin = O) => w.fetch(new Request(`https://r/thing?ids=${id}`, { headers: { Origin: origin, "CF-Connecting-IP": "9.9.9.9" } }), env);
const srch = (env, q) => w.fetch(new Request(`https://r/search?q=${q}`, { headers: { Origin: O } }), env);
const base = { BGG_API_TOKEN: "fake-test-token" };

{ const m = await fresh();
  check("default BGG_DAILY_CAP is 200", m._test.bggDailyCap({}) === 200 && m._test.CONFIG.BGG_DAILY_CAP === 200);
  check("env BGG_DAILY_CAP overrides", m._test.bggDailyCap({ BGG_DAILY_CAP: "7" }) === 7); }

await fresh();
{ const env = { ...base, TT_CACHE: kv(), BGG_DAILY_CAP: "3" }; bggCalls = 0;
  const st = [];
  for (let n = 1; n <= 3; n++) st.push((await thing(env, 100 + n)).status);
  check("under cap: 3 different things -> 200, 3 BGG calls", st.every((s) => s === 200) && bggCalls === 3, `${st} calls=${bggCalls}`);
  check("token sent as Bearer to boardgamegeek.com (no www)", lastAuth === "Bearer fake-test-token" && lastUrl.startsWith("https://boardgamegeek.com/xmlapi2/"), lastUrl);
  check("counter keyed by UTC day", env.TT_CACHE.m.get(`tt1:bgg:${new Date().toISOString().slice(0, 10)}`) === "3");
  const r = await thing(env, 200);
  const body = await r.json();
  check("at cap: 503 + clear JSON error, zero BGG calls", r.status === 503 && body.error === "bgg daily cap reached" && bggCalls === 3, `${r.status} ${JSON.stringify(body)} calls=${bggCalls}`);
  const ra = Number(r.headers.get("Retry-After"));
  check("at cap: Retry-After = seconds to UTC midnight", ra > 0 && ra <= 86400, String(ra));
  const s = await srch(env, "catan");
  check("at cap: uncached /search 503, zero BGG calls", s.status === 503 && bggCalls === 3, `${s.status} calls=${bggCalls}`);
  const hit = await thing(env, 101);
  check("at cap: cache hit still served 200, no BGG call", hit.status === 200 && (await hit.json()).things[0].bggId === "101" && bggCalls === 3, `calls=${bggCalls}`);
  const f = await thing(env, 300, "https://evil.example");
  check("faked/unknown Origin: 403, no BGG call", f.status === 403 && bggCalls === 3);
  const f2 = await thing(env, 301, O); // a forged allowed Origin still stops at the cap
  check("forged allowed Origin header still stops at the cap (503, no BGG call)", f2.status === 503 && bggCalls === 3, `${f2.status} calls=${bggCalls}`);
}
await fresh();
{ const env = { ...base, TT_CACHE: kv(), BGG_DAILY_CAP: "5" }; bggCalls = 0;
  env.TT_CACHE.m.set(`tt1:bgg:${new Date().toISOString().slice(0, 10)}`, "5"); // other isolates already used the day
  const r = await thing(env, 400);
  check("KV count from other isolates honoured: 503, no BGG call", r.status === 503 && bggCalls === 0); }
await fresh();
{ const env = { ...base }; bggCalls = 0;
  const r = await thing(env, 500), s = await srch(env, "catan");
  check("KV unbound: /thing and /search fail closed 503, zero BGG calls", r.status === 503 && s.status === 503 && bggCalls === 0, `${r.status} ${s.status} calls=${bggCalls}`); }
await fresh();
{ const env = { TT_CACHE: kv() }; bggCalls = 0;
  check("no BGG_API_TOKEN: 503, no BGG call", (await thing(env, 600)).status === 503 && bggCalls === 0); }

await fresh();
{ const env = { ...base, TT_CACHE: kv() }; bggCalls = 0;
  const ipThing = (id, ip) => w.fetch(new Request(`https://r/thing?ids=${id}`, { headers: { Origin: O, "CF-Connecting-IP": ip } }), env);
  const ipSrch = (q, ip) => w.fetch(new Request(`https://r/search?q=${q}`, { headers: { Origin: O, "CF-Connecting-IP": ip } }), env);
  const st = [];
  for (let n = 1; n <= 5; n++) st.push((await ipThing(700 + n, "1.2.3.4")).status);
  for (let n = 1; n <= 5; n++) st.push((await ipSrch(`q${n}`, "1.2.3.4")).status);
  check("per-IP: 10 upstream lookups in a minute -> all 200", st.every((s) => s === 200) && bggCalls === 10, `${st} calls=${bggCalls}`);
  const r = await ipThing(799, "1.2.3.4");
  check("per-IP: 11th uncached lookup -> 429 + Retry-After, no BGG call", r.status === 429 && Number(r.headers.get("Retry-After")) > 0 && bggCalls === 10, `${r.status} calls=${bggCalls}`);
  const rs = await ipSrch("q99", "1.2.3.4");
  check("per-IP: 11th uncached /search -> 429, no BGG call", rs.status === 429 && bggCalls === 10, `${rs.status} calls=${bggCalls}`);
  check("per-IP: throttled requests don't count toward the daily cap", env.TT_CACHE.m.get(`tt1:bgg:${new Date().toISOString().slice(0, 10)}`) === "10");
  const h1 = await ipThing(701, "1.2.3.4"), h2 = await ipSrch("q1", "1.2.3.4");
  check("per-IP: cache hits never limited (thing + search 200 while throttled)", h1.status === 200 && h2.status === 200 && bggCalls === 10, `${h1.status} ${h2.status}`);
  const o = await ipThing(800, "5.6.7.8");
  check("per-IP: another IP still gets through", o.status === 200 && bggCalls === 11, `${o.status} calls=${bggCalls}`); }

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
