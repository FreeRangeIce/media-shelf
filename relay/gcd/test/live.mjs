// Live test against GCD, anonymous. Hard cap on real calls (MAX_LIVE, default 5),
// 2s apart. Responses already recorded this session (test/fixtures) are replayed
// instead of re-fetched, to stay inside GCD's 30/hour anonymous throttle.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { makeKv } from "./kv-shim.mjs";

const REC = JSON.parse(readFileSync(new URL("./fixtures/gcd-recorded.json", import.meta.url)));
const MAX_LIVE = Number(process.env.MAX_LIVE || 5);
const env = { GCD_CACHE: makeKv() }; // fake KV in memory, like the GCD_CACHE binding
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
mkdirSync("/tmp/gcd-raw2", { recursive: true });
const realFetch = globalThis.fetch;
let live = 0, replayed = 0, last = 0;
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  if (REC[u.pathname]) {
    replayed++;
    console.log("    replay  " + decodeURIComponent(u.pathname));
    return new Response(JSON.stringify(REC[u.pathname]), { headers: { "Content-Type": "application/json" } });
  }
  if (++live > MAX_LIVE) throw new Error("harness live-call cap reached");
  const gap = 2000 - (Date.now() - last);
  if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  last = Date.now();
  const res = await realFetch(url, init);
  console.log("    LIVE #" + live + " " + decodeURIComponent(u.pathname) + " -> " + res.status + (res.headers.get("retry-after") ? " retry-after " + res.headers.get("retry-after") : ""));
  writeFileSync("/tmp/gcd-raw2/" + live + ".txt", u.pathname + "\n" + (await res.clone().text()));
  return res;
};
const worker = (await import("../worker.js")).default;

async function run(name, path, origin = "https://freerangeice.github.io") {
  console.log("== " + name + "  GET " + path + "  Origin: " + origin);
  const l0 = live, r0 = replayed;
  const res = await worker.fetch(new Request("https://frm-gcd.local" + path, { headers: { Origin: origin } }), env, null);
  const text = await res.text();
  console.log("   status " + res.status + "  cache " + (res.headers.get("X-Relay-Cache") || "-") + "  live " + (live - l0) + "  replayed " + (replayed - r0) + "  price in body: " + /price/i.test(text) + (res.headers.get("Retry-After") ? "  Retry-After " + res.headers.get("Retry-After") : ""));
  console.log("   " + text);
  writeFileSync(new URL("./out/" + name + ".json", import.meta.url), text + "\n");
  return JSON.parse(text);
}

await run("saga-1-2012", "/comic?series=Saga&issue=1&year=2012");
const ab = await run("absolute-batman-1-2024", "/comic?series=Absolute%20Batman&issue=1&year=2024");
await run("nonsense", "/comic?series=Qwzxv%20Plumbtrandle%20Fnorp&issue=1");
if (ab.variants) await run("covers-cached", "/comic-covers?ids=" + ab.variants.slice(0, 5).map((v) => v.sourceId).join(","));
await run("bad-origin", "/comic?series=Saga&issue=1", "https://evil.example.com");
await run("barcode", "/comic-barcode?upc=76194138584600111");
console.log("live calls: " + live + " (cap " + MAX_LIVE + "), replayed: " + replayed);
