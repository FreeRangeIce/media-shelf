// Map-based stand-in for a Workers KV namespace binding (honours expirationTtl, records ops).
export function makeKv({ failGet = false, failPut = false } = {}) {
  const store = new Map();
  const ops = { get: 0, put: 0 };
  const kv = {
    store,
    ops,
    async get(key, opts) {
      ops.get++;
      if (failGet) throw new Error("KV get failed");
      const e = store.get(key);
      if (!e) return null;
      if (Date.now() > e.expires) { store.delete(key); return null; }
      const type = typeof opts === "string" ? opts : opts && opts.type;
      return type === "json" ? JSON.parse(e.value) : e.value;
    },
    async put(key, value, opts = {}) {
      ops.put++;
      if (failPut) throw new Error("KV put failed");
      if (typeof value !== "string") throw new TypeError("value must be a string here");
      const ttl = opts.expirationTtl;
      if (ttl !== undefined && ttl < 60) throw new Error("expirationTtl must be at least 60");
      store.set(key, { value, ttl, expires: ttl ? Date.now() + ttl * 1000 : Infinity });
    },
  };
  return kv;
}
