// LOCAL ONLY. Runs relay/tabletop-worker.js under plain node (no wrangler, no Cloudflare
// account) for testing. Secrets come from the environment, never from this repo:
//   set -a; . /path/outside/repo/gameupc.env; set +a
//   GAMEUPC_USER_ID=local-test-user PORT=8795 KV_FILE=/tmp/tt-kv.json UPSTREAM_LOG=/tmp/up.log node relay/dev-shim.mjs
// - KV_FILE: a JSON file standing in for the TT_CACHE KV binding, so cached GameUPC answers
//   survive restarts (one real GET per UPC across test runs).
// - Every GameUPC POST is MOCKED here (never sent upstream): it is logged and answered 200.
// - UPSTREAM_LOG: one JSON line per upstream call (method, path, mocked); the key is never logged.
import http from "node:http";
import fs from "node:fs";
import worker from "./tabletop-worker.js";

const PORT = Number(process.env.PORT || 8795);
const KV_FILE = process.env.KV_FILE || "";
const LOG = process.env.UPSTREAM_LOG || "";
const kvData = KV_FILE && fs.existsSync(KV_FILE) ? JSON.parse(fs.readFileSync(KV_FILE, "utf8")) : {};
const saveKv = () => KV_FILE && fs.writeFileSync(KV_FILE, JSON.stringify(kvData, null, 1));
const TT_CACHE = {
  async get(k) { const e = kvData[k]; return e && e.until > Date.now() ? e.v : null; },
  async put(k, v, o) { kvData[k] = { v, until: Date.now() + (o && o.expirationTtl ? o.expirationTtl * 1000 : 864e5) }; saveKv(); },
  // KEEP_CACHE=1: a (mocked) confirm doesn't drop the cached answer, so tests never re-GET v1.
  async delete(k) { if (process.env.KEEP_CACHE === "1") return log({ cacheDeleteSkipped: k }); delete kvData[k]; saveKv(); },
};
const env = { GAMEUPC_KEY: process.env.GAMEUPC_KEY, GAMEUPC_BASE: process.env.GAMEUPC_BASE, GAMEUPC_USER_ID: process.env.GAMEUPC_USER_ID, DEV_ORIGIN: process.env.DEV_ORIGIN, TT_CACHE };

const realFetch = globalThis.fetch;
const log = (o) => LOG && fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n");
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  const method = (init.method || "GET").toUpperCase();
  if (u.hostname === "api.gameupc.com" && method !== "GET") {
    log({ method, path: u.pathname, mocked: true, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ status: "ok", mocked: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (u.hostname !== "api.gameupc.com") throw new Error("shim: only api.gameupc.com is reachable");
  const res = await realFetch(input, init);
  let shape = null;
  try {
    const b = await res.clone().json();
    const i = Array.isArray(b.bgg_info) ? b.bgg_info : [];
    shape = { keys: Object.keys(b), bgg_info_status: b.bgg_info_status, name: b.name, searched_for: b.searched_for, bgg_info_len: i.length,
      item_keys: i[0] ? Object.keys(i[0]) : [], items: i.slice(0, 6).map((x) => ({ id: x.id, name: x.name, published: x.published, confidence: x.confidence, thumb: Boolean(x.thumbnail_url) })) };
  } catch {}
  log({ method, path: u.pathname, status: res.status, mocked: false, shape }); // shape only: no headers, no key
  return res;
};

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request(`http://127.0.0.1:${PORT}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : body }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, "127.0.0.1", () => console.log(`relay shim on http://127.0.0.1:${PORT} (base=${env.GAMEUPC_BASE || "test"}, POST mocked)`));
