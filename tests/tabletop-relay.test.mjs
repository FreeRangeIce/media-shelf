// Relay hardening (relay/tabletop-worker.js), plain node, every GameUPC call mocked. LOCAL ONLY.
//   node tests/tabletop-relay.test.mjs
import fs from "node:fs";
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
let upPosts = 0, upGets = 0;
globalThis.fetch = async (u, i = {}) => {
  if (i.method === "POST") { upPosts++; return new Response("{}", { status: 200 }); }
  upGets++;
  const verified = String(u).includes("/upc/555555555555");
  return new Response(JSON.stringify(verified ? { name: "V", bgg_info_status: "verified", bgg_info: [{ id: 7, name: "V" }] } : { name: "X", bgg_info_status: "choose_from_bgg_info_or_search", bgg_info: [{ id: 1, name: "A" }] }), { status: 200 });
};
const { default: w, _test } = await import("../relay/tabletop-worker.js");
const kv = () => { const m = new Map(); return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } }; };
const O = "https://freerangeice.github.io";
const look = (env, upc, ip) => w.fetch(new Request(`https://r/barcode?upc=${upc}`, { headers: { Origin: O, "CF-Connecting-IP": ip } }), env);
const conf = (env, upc, ip, bggId = "999") => w.fetch(new Request("https://r/barcode/confirm", { method: "POST", headers: { Origin: O, "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify({ upc, bggId }) }), env);
const base = { GAMEUPC_KEY: "k", GAMEUPC_USER_ID: "test-user-01" };

// no KV: confirm 503, never POSTs; lookup still works
{
  const env = { ...base };
  const l = await look(env, "200000000001", "2.2.2.1");
  const c = await conf(env, "200000000001", "2.2.2.1");
  check("no KV: lookup still 200", l.status === 200, String(l.status));
  check("no KV: confirm 503, zero upstream POSTs", c.status === 503 && upPosts === 0, `${c.status} posts=${upPosts}`);
}
// seen-record rule
{
  const env = { ...base, TT_CACHE: kv() };
  check("confirm with no lookup at all -> 409", (await conf(env, "200000000002", "2.2.2.2")).status === 409);
  await look(env, "200000000003", "2.2.2.3");
  check("confirm from another IP than the lookup -> 409", (await conf(env, "200000000003", "2.2.2.99")).status === 409);
  const k = [...env.TT_CACHE.m.keys()].find((x) => x.includes("seen:200000000003:2.2.2.3"));
  check("lookup recorded in KV (UPC + IP)", Boolean(k), k || "");
  env.TT_CACHE.m.set(k, String(Date.now() - 11 * 60 * 1000));
  check("lookup older than 10 minutes -> 409", (await conf(env, "200000000003", "2.2.2.3")).status === 409);
  await look(env, "200000000003", "2.2.2.3"); // cache hit still records
  check("cached lookup re-recorded; same IP confirm -> 200", (await conf(env, "200000000003", "2.2.2.3")).status === 200 && upPosts === 1, `posts=${upPosts}`);
  check("second confirm on the same lookup -> 409", (await conf(env, "200000000003", "2.2.2.3")).status === 409 && upPosts === 1);
  await look(env, "555555555555", "2.2.2.4");
  check("verified UPC: not recorded, confirm 409, no POST", (await conf(env, "555555555555", "2.2.2.4")).status === 409 && upPosts === 1);
}
// global daily cap
{
  const env = { ...base, TT_CACHE: kv(), CONFIRM_DAILY_CAP: "3" };
  const before = upPosts;
  const st = [];
  for (let n = 0; n < 5; n++) { const upc = String(300000000000 + n), ip = `3.3.3.${n}`; await look(env, upc, ip); const r = await conf(env, upc, ip); st.push(r.status + (r.status === 429 ? "/" + r.headers.get("Retry-After") : "")); }
  const ra = Number(st[4].split("/")[1]);
  check("CONFIRM_DAILY_CAP=3: 3x200 then 429 across different IPs", st.slice(0, 3).every((s) => s === "200") && st.slice(3).every((s) => s.startsWith("429")), st.join(" "));
  check("over the cap: no upstream POST", upPosts - before === 3, `${upPosts - before}`);
  check("429 Retry-After = seconds to next UTC midnight", ra > 0 && ra <= 86400 && Math.abs(ra - _test.secsToUtcMidnight(Date.now())) <= 2, String(ra));
  check("counter keyed by UTC day", [...env.TT_CACHE.m.keys()].includes(`tt1:confirms:${new Date().toISOString().slice(0, 10)}`));
  check("secsToUtcMidnight(23:59:30Z) = 30", _test.secsToUtcMidnight(Date.parse("2026-11-01T23:59:30Z")) === 30);
}
{
  const env = { ...base, TT_CACHE: kv() }, st = [];
  for (let n = 0; n < 12; n++) { const upc = String(400000000000 + n), ip = `4.4.4.${n}`; await look(env, upc, ip); st.push((await conf(env, upc, ip)).status); }
  check("default cap 10: 10x200 then 429", st.filter((s) => s === 200).length === 10 && st.slice(10).every((s) => s === 429), st.join(","));
}
const src = fs.readFileSync(new URL("../relay/tabletop-worker.js", import.meta.url), "utf8");
check("no unsourced 'undo a bad actor' claim", !/bad actor/i.test(src));
check("user_id note: required by spec, per-user limiting unknown", /user_id is required by the GameUPC spec/.test(src) && /not documented \(unknown\)/.test(src));
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
