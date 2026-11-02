// Relay hardening (relay/tabletop-worker.js), plain node, every GameUPC call mocked. LOCAL ONLY.
//   node tests/tabletop-relay.test.mjs
import fs from "node:fs";
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
let upPosts = 0, upGets = 0, lastPostBody = null;
globalThis.fetch = async (u, i = {}) => {
  if (i.method === "POST") { upPosts++; lastPostBody = i.body; return new Response("{}", { status: 200 }); }
  upGets++;
  const verified = String(u).includes("/upc/555555555555");
  return new Response(JSON.stringify(verified ? { name: "V", bgg_info_status: "verified", bgg_info: [{ id: 7, name: "V" }] } : { name: "X", bgg_info_status: "choose_from_bgg_info_or_search", bgg_info: [{ id: 1, name: "A" }] }), { status: 200 });
};
const { _test } = await import("../relay/tabletop-worker.js");
// Each block gets a fresh module = a fresh isolate (own in-memory day count and admission chain).
let w, iso = 0;
const freshIsolate = async () => { w = (await import(`../relay/tabletop-worker.js?isolate=${++iso}`)).default; };
const kv = () => { const m = new Map(); return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } }; };
const O = "https://freerangeice.github.io";
const look = (env, upc, ip) => w.fetch(new Request(`https://r/barcode?upc=${upc}`, { headers: { Origin: O, "CF-Connecting-IP": ip } }), env);
const conf = (env, upc, ip, bggId = "999", userId = "device-test-0001") => w.fetch(new Request("https://r/barcode/confirm", { method: "POST", headers: { Origin: O, "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify({ upc, bggId, userId }) }), env);
const base = { GAMEUPC_KEY: "k" };

await freshIsolate();
// no KV: confirm 503, never POSTs; lookup still works
{
  const env = { ...base };
  const l = await look(env, "200000000001", "2.2.2.1");
  const c = await conf(env, "200000000001", "2.2.2.1");
  check("no KV: lookup still 200", l.status === 200, String(l.status));
  check("no KV: confirm 503, zero upstream POSTs", c.status === 503 && upPosts === 0, `${c.status} posts=${upPosts}`);
}
// seen-record rule
await freshIsolate();
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
await freshIsolate();
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
await freshIsolate();
{
  const env = { ...base, TT_CACHE: kv() }, st = [];
  for (let n = 0; n < 12; n++) { const upc = String(400000000000 + n), ip = `4.4.4.${n}`; await look(env, upc, ip); st.push((await conf(env, upc, ip)).status); }
  check("default cap 10: 10x200 then 429", st.filter((s) => s === 200).length === 10 && st.slice(10).every((s) => s === 429), st.join(","));
}
// Race: 30 concurrent confirms, each after its own lookup from its own IP, slow KV (Nathan's case).
const slowKv = (ms) => { const m = new Map(); const t = () => new Promise((r) => setTimeout(r, ms)); return { m, async get(k) { await t(); return m.has(k) ? m.get(k) : null; }, async put(k, v) { await t(); m.set(k, v); }, async delete(k) { await t(); m.delete(k); } }; };
const today = () => `tt1:confirms:${new Date().toISOString().slice(0, 10)}`;
await freshIsolate();
{
  const env = { ...base, TT_CACHE: slowKv(5) }, before = upPosts;
  const upcs = [...Array(30)].map((_, n) => String(500000000000 + n));
  for (const [n, upc] of upcs.entries()) await look(env, upc, `5.5.${n}`);
  const rs = await Promise.all(upcs.map((upc, n) => conf(env, upc, `5.5.${n}`)));
  const c = {}; for (const r of rs) c[r.status] = (c[r.status] || 0) + 1;
  check("race: 30 concurrent confirms, slow KV -> at most 10 x 200, rest 429", (c[200] || 0) <= 10 && (c[200] || 0) + (c[429] || 0) === 30, JSON.stringify(c));
  check("race: at most 10 upstream POSTs", upPosts - before <= 10, String(upPosts - before));
  check("race: KV day counter ends at the number admitted", Number(env.TT_CACHE.m.get(today())) === (c[200] || 0), String(env.TT_CACHE.m.get(today())));
}
// A stale KV (reads 0 forever, e.g. another location's lagging replica): the isolate's own count still caps.
await freshIsolate();
{
  const k = slowKv(1); const env = { ...base, TT_CACHE: { ...k, async get(key) { return key.includes(":confirms:") ? null : k.get(key); }, put: k.put, delete: k.delete } }, before = upPosts;
  const st = [];
  for (let n = 0; n < 12; n++) { const upc = String(510000000000 + n), ip = `5.1.1.${n}`; await look(env, upc, ip); st.push((await conf(env, upc, ip)).status); }
  check("stale KV counter: in-memory day count still caps at 10", st.filter((x) => x === 200).length === 10 && upPosts - before === 10, st.join(","));
}
// Upstream POST failure still counts (counted before the POST, never decremented).
await freshIsolate();
{
  const env = { ...base, TT_CACHE: kv(), CONFIRM_DAILY_CAP: "2" };
  const real = globalThis.fetch;
  globalThis.fetch = async (u, i = {}) => (i.method === "POST" ? (upPosts++, new Response("{}", { status: 500 })) : real(u, i));
  await look(env, "520000000000", "5.2.0.1");
  const r1 = await conf(env, "520000000000", "5.2.0.1");
  globalThis.fetch = real;
  check("POST failure -> 502 to the page", r1.status === 502, String(r1.status));
  check("POST failure still counted in KV (1)", env.TT_CACHE.m.get(today()) === "1", String(env.TT_CACHE.m.get(today())));
  const st = [];
  for (let n = 1; n <= 2; n++) { const upc = String(520000000000 + n), ip = `5.2.0.${n + 1}`; await look(env, upc, ip); st.push((await conf(env, upc, ip)).status); }
  check("cap 2 after one failed POST: one more 200, then 429", st.join(",") === "200,429", st.join(","));
}
// Per-device user_id (Option A): 8 to 64 letters, digits or dashes, else 400 before admission.
await freshIsolate();
{
  const env = { ...base, TT_CACHE: kv() }, before = upPosts, upc = "610000000001", ip = "6.1.0.1";
  await look(env, upc, ip);
  const bad = [undefined, "", "short7c", "a".repeat(65), "has space1", "under_score", "émoji-ok-1", 12345678];
  const st = [];
  for (const id of bad) {
    const body = { upc, bggId: "999" }; if (id !== undefined) body.userId = id;
    st.push((await w.fetch(new Request("https://r/barcode/confirm", { method: "POST", headers: { Origin: O, "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) }), env)).status);
  }
  check("bad or missing userId -> 400 every time, zero POSTs", st.every((x) => x === 400) && upPosts === before, st.join(","));
  check("bad userId does not use up the day's cap", !env.TT_CACHE.m.has(today()));
  check("bad userId does not use up the lookup record", (await conf(env, upc, ip, "999", "a".repeat(64))).status === 200 && upPosts === before + 1);
  check("upstream body is exactly the device's user_id", lastPostBody === JSON.stringify({ user_id: "a".repeat(64) }), lastPostBody);
  const upc2 = "610000000002"; await look(env, upc2, ip);
  check("8-char id with dashes accepted", (await conf(env, upc2, ip, "999", "ab-12-CD")).status === 200 && JSON.parse(lastPostBody).user_id === "ab-12-CD");
  check("no shared fallback: GAMEUPC_USER_ID is ignored", !fs.readFileSync(new URL("../relay/tabletop-worker.js", import.meta.url), "utf8").includes("GAMEUPC_USER_ID"));
}
// Cap and same-IP check are independent of the id: new ids don't reset either.
await freshIsolate();
{
  const env = { ...base, CONFIRM_DAILY_CAP: "2", TT_CACHE: kv() }, st = [];
  for (let n = 1; n <= 3; n++) { const upc = String(620000000000 + n), ip = `6.2.0.${n}`; await look(env, upc, ip); st.push((await conf(env, upc, ip, "999", `fresh-id-000${n}`)).status); }
  check("cap 2 with a new id each time: 200,200,429", st.join(",") === "200,200,429", st.join(","));
  const upc = "620000000009"; await look(env, upc, "6.2.9.1");
  check("other IP with any id -> 409", (await conf(env, upc, "6.2.9.2", "999", "other-device-01")).status === 409);
}
const src = fs.readFileSync(new URL("../relay/tabletop-worker.js", import.meta.url), "utf8");
check("user_id note cites the GameUPC spec URL and quotes it", src.includes("https://gameupc.com/gameupc-oas.yaml") && src.includes("we can go back and clear out any updates they've made"));
check("no single-user / one-id wording", !/single-user|one-person|one id for every/i.test(src));
check("no paraphrased 'bad actor' claim", !/bad actor/i.test(src));
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
