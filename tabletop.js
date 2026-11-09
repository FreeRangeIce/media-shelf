/* FreeRangeMedia — Tabletop tab (physical board, card, dice, miniatures and RPG games).
 *
 * Kept apart from the media items in app.js: entries live under their own storage key
 * (STORE_KEY) and ride in backups as an optional `tabletop` block, so an older app.js that
 * restores a newer backup simply ignores them (it never turns a game into a book), and an
 * old backup without the block restores as before.
 *
 * Links: an Expansion stores its base by BGG id (parentBggId) AND by local id (parentId).
 * The base is resolved on every render: BGG id first, local id as the fallback when either
 * side has no BGG id. When an entry later gets a BGG id, links pointing at it by local id
 * are rewritten to carry that BGG id too (linkBggId). Deleting a base never deletes its
 * expansions; they stand alone and keep the BGG id, so re-adding the base relinks them.
 *
 * Lookup: searching BoardGameGeek by title (LOOKUP_RELAY_URL) isn't connected yet, so its button
 * is hidden (not built at all) and it makes no network call. Barcode lookup (below) does make
 * calls, through the relay. See relay/tabletop-worker.js.
 *
 * Barcode lookup (GameUPC, via the relay): on since v43, using the relay at frm-tabletop.freerangeice.workers.dev. Setting GAMEUPC_LOOKUP.enabled to false turns it off: no barcode UI and no relay call.
 * See "barcode lookup" below and relay/README-tabletop.md.
 */
(function (root) {
  "use strict";

  const STORE_KEY = "media-tracker-v1:tabletop";
  /** Relay endpoint for BGG title search. Empty = not connected (no title-search calls). Barcode lookup uses GAMEUPC_LOOKUP.relay. */
  const LOOKUP_RELAY_URL = "";
  /**
   * Lookup data credits: the BoardGameGeek credit (official linked "Powered by BGG" logo under
   * lookup results that show BGG data, and the "Game data from BoardGameGeek" Tabletop footer
   * line) is gated on GAMEUPC_LOOKUP.enabled (see bggCreditOn below): when that flag is false
   * neither is in the page at all. There is no GameUPC credit line. lookupCreditsAllowed() is
   * only about the separate BGG name lookup (LOOKUP_RELAY_URL), which is still not connected.
   */
  const lookupReturnedRecord = false;
  const lookupCreditsAllowed = () => Boolean(LOOKUP_RELAY_URL) && lookupReturnedRecord;
  /**
   * Barcode lookup flag. While off nothing below "barcode lookup" runs.
   * Dev only: on a loopback host (127.0.0.1 / localhost) a test may set
   * window.__FRM_TT_LOOKUP__ = { relay } before load; ignored on any other host.
   */
  const GAMEUPC_LOOKUP = { enabled: true, relay: "https://frm-tabletop.freerangeice.workers.dev" }; // no trailing slash: paths are appended
  function barcodeLookupConfig() {
    // Loopback dev hook first, so local tests reach their own test relay, never the live Worker.
    try {
      const dev = root.__FRM_TT_LOOKUP__;
      const loop = root.location && /^(127\.0\.0\.1|localhost)$/.test(root.location.hostname);
      if (loop && dev && typeof dev.relay === "string" && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(dev.relay)) return { relay: dev.relay };
    } catch {}
    if (GAMEUPC_LOOKUP.enabled && GAMEUPC_LOOKUP.relay) return { relay: GAMEUPC_LOOKUP.relay };
    return null;
  }
  /**
   * BoardGameGeek credit ("Powered by BGG" linked logo, BGG terms). Shown ONLY when
   * GAMEUPC_LOOKUP.enabled is true: under each lookup result that shows BGG data (match,
   * suggestions, confirm, picked; never the no-data state or the Save bar) and as the Tabletop
   * footer line. While the flag is off nothing of it is in the DOM. The svg is BGG's official art,
   * unaltered; width/height keep its 342:76 ratio.
   */
  const bggCreditOn = () => GAMEUPC_LOOKUP.enabled === true;
  const BGG_LOGO = `<a class="tt-bgg-logo" href="https://boardgamegeek.com" target="_blank" rel="noopener"><img src="icons/powered-by-bgg.svg" alt="Powered by BGG" width="162" height="36" /></a>`;
  const bggLogo = () => (bggCreditOn() ? BGG_LOGO : "");
  const SUBTYPES = ["board", "card", "dice", "miniatures", "rpg", "expansion"];
  const SUBTYPE_LABELS = { board: "Board", card: "Card", dice: "Dice", miniatures: "Miniatures", rpg: "RPG", expansion: "Expansion" };
  const STATUSES = ["owned", "want"];
  const STATUS_LABELS = { owned: "Owned", want: "Want" };
  const VISIBLE_EXPANSIONS = 3;

  /* ---------------- core (pure; tested in node) ---------------- */

  const str = (v) => (v == null ? "" : String(v).trim());
  /** BGG uses 0 for unknown numbers: 0, "0" and "" are empty. */
  const bggNum = (v) => {
    const s = str(v);
    return s === "" || s === "0" ? "" : s;
  };
  /**
   * Field provenance (bggSrc): for each filled ID-bound field, where its value came from.
   *   "382229"  filled by a BGG/GameUPC lookup for that BGG id
   *   ""        typed by hand
   *   "?382229" origin unknown, but it sat on the entry while it had that BGG id
   *   "?"       origin unknown, no BGG id at the time
   * A missing key = unknown (entries saved before v48 carry no bggSrc; they are not migrated).
   */
  const BGG_ID_BOUND = ["year", "designer", "players", "playTime", "coverUrl"];
  const SRC_RE = /^(\?([1-9]\d{0,8})?|[1-9]\d{0,8})?$/;
  function cleanBggSrc(src, fields) {
    const out = {};
    if (!src || typeof src !== "object" || Array.isArray(src)) return out;
    BGG_ID_BOUND.forEach((k) => {
      const v = src[k];
      if (typeof v === "string" && SRC_RE.test(v) && str(fields[k]) && str(fields[k]) !== "0") out[k] = v;
    });
    return out;
  }
  /** The BGG id a source tag ties a field to ("" for hand-typed or unknown-without-id). */
  const srcId = (v) => (typeof v === "string" ? v.replace(/^\?/, "") : "");
  const normTitle = (t) => str(t).toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ");
  let idSeq = 0;
  const newId = () => `tt-${Date.now().toString(36)}-${(idSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const nowIso = () => new Date().toISOString();

  function normalize(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const subtype = SUBTYPES.includes(r.subtype) ? r.subtype : "board";
    const e = {
      id: str(r.id) || newId(),
      title: str(r.title),
      subtype,
      status: STATUSES.includes(r.status) ? r.status : "owned", // new entries default to Owned
      bggId: bggNum(r.bggId),
      bggType: str(r.bggType), // boardgame | boardgameexpansion | rpgitem (as BGG reports it)
      bggIsExpansion: r.bggIsExpansion === true,
      year: bggNum(r.year),
      designer: str(r.designer),
      players: str(r.players),
      playTime: str(r.playTime),
      coverUrl: str(r.coverUrl),
      barcode: str(r.barcode),
      notes: str(r.notes),
      parentId: subtype === "expansion" ? str(r.parentId) : "",
      parentBggId: subtype === "expansion" ? bggNum(r.parentBggId) : "",
      parentTitle: subtype === "expansion" ? str(r.parentTitle) : "",
      bggSrc: {},
      dateAdded: str(r.dateAdded) || nowIso(),
      dateUpdated: str(r.dateUpdated) || str(r.dateAdded) || nowIso(),
      seed: r.seed === true,
    };
    e.bggSrc = cleanBggSrc(r.bggSrc, e);
    return e;
  }

  const isBase = (e) => e && e.subtype !== "expansion";

  /** The base an expansion belongs to, or null. BGG id first; local id when either side has none. */
  function resolveParent(list, exp) {
    if (!exp || exp.subtype !== "expansion") return null;
    if (exp.parentBggId) {
      const byBgg = list.find((b) => isBase(b) && b.bggId && b.bggId === exp.parentBggId);
      if (byBgg) return byBgg;
    }
    if (exp.parentId) {
      const byId = list.find((b) => isBase(b) && b.id === exp.parentId);
      if (byId && (!byId.bggId || !exp.parentBggId || byId.bggId === exp.parentBggId)) return byId;
    }
    return null;
  }

  /** Shelf groups: [{ entry, expansions: [] }], bases with their expansions, lone expansions alone. */
  function groupShelf(list, sort = "title") {
    const cmp = (a, b) =>
      sort === "updated"
        ? String(b.dateUpdated).localeCompare(String(a.dateUpdated))
        : normTitle(a.title).localeCompare(normTitle(b.title));
    const under = new Map();
    const loose = [];
    list.forEach((e) => {
      if (e.subtype !== "expansion") return;
      const p = resolveParent(list, e);
      if (p) {
        if (!under.has(p.id)) under.set(p.id, []);
        under.get(p.id).push(e);
      } else loose.push(e);
    });
    const groups = list
      .filter(isBase)
      .map((b) => ({ entry: b, expansions: (under.get(b.id) || []).sort(cmp) }))
      .concat(loose.map((e) => ({ entry: e, expansions: [] })));
    return groups.sort((a, b) => cmp(a.entry, b.entry));
  }

  function expansionsOf(list, base) {
    return list.filter((e) => e.subtype === "expansion" && resolveParent(list, e) === base);
  }

  /** Duplicate check: by BGG id first (ids are unique across BGG thing types), then by title. */
  function findDuplicate(list, entry) {
    const others = list.filter((e) => e.id !== entry.id);
    if (entry.bggId) {
      const m = others.find((e) => e.bggId === entry.bggId);
      if (m) return { by: "bgg", match: m };
    }
    const t = normTitle(entry.title);
    if (t) {
      const m = others.find((e) => normTitle(e.title) === t && !(entry.bggId && e.bggId && e.bggId !== entry.bggId));
      if (m) return { by: "title", match: m };
    }
    return null;
  }

  const KEEP_FIELDS = ["title", "bggId", "bggType", "year", "designer", "players", "playTime", "coverUrl", "barcode", "notes", "parentId", "parentBggId", "parentTitle"];
  /** Update `old` with `incoming`: an empty (or BGG 0) incoming field keeps the old value. */
  function mergeUpdate(old, incoming) {
    const out = { ...old };
    const oldSrc = cleanBggSrc(old && old.bggSrc, old || {});
    // Kept fields with no tag (pre-v48 data) stay tied to the OLD entry's id before any id change,
    // so a merge can never relabel them as the incoming game's.
    BGG_ID_BOUND.forEach((k) => { if (!(k in oldSrc) && bggNum(old && old[k]) && str(old[k])) oldSrc[k] = `?${bggNum(old.bggId)}`; });
    const incSrc = cleanBggSrc(incoming && incoming.bggSrc, incoming || {});
    const incId = bggNum(incoming.bggId);
    out.bggSrc = { ...oldSrc };
    KEEP_FIELDS.forEach((k) => {
      const v = ["bggId", "year", "parentBggId"].includes(k) ? bggNum(incoming[k]) : str(incoming[k]);
      if (v) {
        out[k] = v;
        // A replaced field takes the incoming field's source (unknown when it has none).
        if (BGG_ID_BOUND.includes(k)) out.bggSrc[k] = k in incSrc ? incSrc[k] : `?${incId}`;
      }
    });
    if (SUBTYPES.includes(incoming.subtype)) out.subtype = incoming.subtype;
    if (STATUSES.includes(incoming.status)) out.status = incoming.status;
    // A known BGG type is authoritative (true or false); without one, only a true flag is added,
    // so missing backup metadata never erases a known flag.
    const incType = str(incoming.bggType);
    if (["boardgame", "boardgameexpansion", "rpgitem"].includes(incType)) out.bggIsExpansion = incType === "boardgameexpansion";
    else if (incoming.bggIsExpansion === true) out.bggIsExpansion = true;
    out.dateUpdated = nowIso();
    return normalize(out);
  }

  /** After `id` gained a BGG id: expansions linked to it by local id now carry that BGG id too. */
  function linkBggId(list, id) {
    const base = list.find((e) => e.id === id);
    if (!base || !base.bggId) return list;
    return list.map((e) =>
      e.subtype === "expansion" && e.parentId === id && e.parentBggId !== base.bggId
        ? { ...e, parentBggId: base.bggId, dateUpdated: nowIso() }
        : e
    );
  }

  /** Save (add or replace by id), then refresh links. */
  function upsert(list, entry) {
    const e = normalize(entry);
    if (e.subtype === "expansion" && e.parentId) {
      const p = list.find((b) => b.id === e.parentId);
      if (p) {
        if (p.bggId && !e.parentBggId) e.parentBggId = p.bggId;
        if (!e.parentTitle) e.parentTitle = p.title;
      }
    }
    const i = list.findIndex((x) => x.id === e.id);
    let next = i < 0 ? list.concat(e) : list.map((x, j) => (j === i ? e : x));
    if (i >= 0) next = carryExpansions(list, list[i], next, e);
    return linkBggId(next, e.id);
  }

  /**
   * A base's BGG id was edited: expansions that resolved to it before keep resolving to it.
   * Their parentBggId follows the new id (or is cleared, with the local id kept, when the base
   * loses its BGG id), so a link made by BGG id is never silently cut.
   */
  function carryExpansions(prevList, before, next, after) {
    if (!isBase(before) || !isBase(after) || before.bggId === after.bggId) return next;
    const linked = new Set(expansionsOf(prevList, before).map((x) => x.id));
    if (!linked.size) return next;
    return next.map((x) =>
      linked.has(x.id) ? { ...x, parentBggId: after.bggId, parentId: x.parentId || after.id, dateUpdated: nowIso() } : x
    );
  }

  /** Delete one entry. Expansions of a deleted base stay (they keep parentBggId / parentTitle). */
  function remove(list, id) {
    return list.filter((e) => e.id !== id);
  }

  /** Barcode with no GameUPC match: keep the code on the entry; next step is name search. */
  function applyBarcodeMiss(entry, code) {
    return { entry: { ...entry, barcode: str(code) || str(entry.barcode) }, next: "name-search" };
  }

  /**
   * What to do with a hand-entered match: an incoming entry with no BGG id and a different
   * local id, but the same title and subtype as one already here (also with no BGG id).
   * Interim rule (undecided): keep both and report it, never merge or drop silently.
   * To ask per title later, pass `opts.onHandMatch(existing, incoming)` returning one of
   * HAND_MATCH ("keep-both" | "merge" | "skip").
   */
  const HAND_MATCH = { KEEP_BOTH: "keep-both", MERGE: "merge", SKIP: "skip" };
  const defaultHandMatch = () => HAND_MATCH.KEEP_BOTH;

  /**
   * Restore/merge `incoming` into `current`. Same local id, or same BGG id, is one entry
   * (newer dateUpdated wins). Incoming local-id links are remapped to the surviving entry.
   * Returns handMatches: [{ title, subtype, existingId, incomingId, action }].
   */
  function mergeRestore(current, incoming, opts = {}) {
    const answers = opts.answers || null; // { [incomingId]: HAND_MATCH value } from the per-item prompt
    const onHandMatch =
      typeof opts.onHandMatch === "function"
        ? opts.onHandMatch
        : answers
          ? (m, inc) => answers[inc.id] || HAND_MATCH.KEEP_BOTH // safety net: never drop an unasked copy
          : defaultHandMatch;
    const out = current.map((e) => ({ ...e }));
    const here = out.slice(); // only entries already on this device can be a hand match
    const remap = new Map();
    const handMatches = [];
    let added = 0;
    let updated = 0;
    incoming.forEach((raw) => {
      const inc = normalize(raw);
      // Freshness comes from the backup's OWN date. normalize() stamps a missing date with "now";
      // that stamp must never make an undated (or invalid-dated) entry win over a dated one.
      const incTime = Date.parse(str(raw && raw.dateUpdated) || str(raw && raw.dateAdded));
      let i = out.findIndex((e) => e.id === inc.id);
      if (i < 0 && inc.bggId) i = out.findIndex((e) => e.bggId === inc.bggId);
      // Hand match: same title + subtype where at least one side has no BGG id (hand-entered on
      // one device). Mirrors findDuplicate: two different BGG ids are never a match.
      if (i < 0) {
        const m = here.find(
          (e) => e.subtype === inc.subtype && normTitle(e.title) === normTitle(inc.title) && !(e.bggId && inc.bggId)
        );
        if (m) {
          const asked = onHandMatch(m, inc);
          const action = Object.values(HAND_MATCH).includes(asked) ? asked : HAND_MATCH.KEEP_BOTH;
          handMatches.push({ title: inc.title, subtype: inc.subtype, existingId: m.id, incomingId: inc.id, action });
          if (action === HAND_MATCH.SKIP) {
            remap.set(inc.id, m.id);
            return;
          }
          if (action === HAND_MATCH.MERGE) {
            // Update existing: the add-time overwrite rule (an empty restored field keeps the
            // old value); the existing id stays and local-id links to the restored one follow it.
            const j = out.findIndex((e) => e.id === m.id);
            out[j] = { ...mergeUpdate(out[j], inc), id: m.id, dateAdded: out[j].dateAdded };
            remap.set(inc.id, m.id);
            updated += 1;
            return;
          }
        }
      }
      if (i < 0) {
        out.push(inc);
        added += 1;
        return;
      }
      remap.set(inc.id, out[i].id);
      if (Number.isFinite(incTime) && incTime > Date.parse(out[i].dateUpdated)) {
        out[i] = { ...inc, id: out[i].id };
        updated += 1;
      }
    });
    let list = out.map((e) => (e.parentId && remap.has(e.parentId) ? { ...e, parentId: remap.get(e.parentId) } : e));
    list.filter((e) => e.bggId).forEach((e) => (list = linkBggId(list, e.id)));
    return { list, added, updated, handMatches };
  }

  function parseBackupBlock(data) {
    const block = data && typeof data === "object" && !Array.isArray(data) ? data.tabletop : null;
    if (!block || !Array.isArray(block.entries)) return null; // older backups: no tabletop block
    // Keep a missing date missing (not "now"), so restore can tell an undated entry from a newer one;
    // mergeRestore dates it when it is added as a new entry.
    return block.entries.filter((r) => r && typeof r === "object" && r.title).map((r) => {
      const e = normalize(r);
      if (!str(r.dateUpdated) && !str(r.dateAdded)) { e.dateUpdated = ""; e.dateAdded = ""; }
      return e;
    });
  }

  /** UPC-A / EAN-13 / EAN-8 with a valid check digit (the debounce only fires on these). */
  function validGtin(code) {
    const d = str(code);
    if (!/^(\d{8}|\d{12}|\d{13})$/.test(d)) return false;
    const n = d.split("").map(Number);
    const check = n.pop();
    const sum = n.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === check;
  }

  /**
   * Whether a save may send a barcode match, and which. Pure. `look` is the lookup state:
   * { upc, status: "verified"|"choose"|"none", confirmed: { bggId } | null, answer: "send"|"skip"|null }.
   * Never for "verified"; "choose" only for the confirmed pick still in the form; "none" only
   * with a BGG id in the form AND an explicit "send" answer. Returns
   * { send: { upc, bggId } } | { ask: true } | { send: null }.
   */
  function barcodePostDecision(look, form) {
    const none = { send: null };
    if (!look || !form || str(form.barcode) !== look.upc) return none;
    const id = bggNum(form.bggId);
    if (!/^[1-9]\d{0,8}$/.test(id)) return none; // no BGG id: nothing is posted
    if (look.status === "choose") return look.confirmed && look.confirmed.bggId === id ? { send: { upc: look.upc, bggId: id } } : none;
    if (look.status === "none") {
      if (look.answer === "send" && look.confirmed && look.confirmed.bggId === id) return { send: { upc: look.upc, bggId: id } };
      if (look.answer === "skip" && look.confirmed && look.confirmed.bggId === id) return none;
      return { ask: true };
    }
    return none; // verified: never posted
  }

  /** Direct ID lookup is read-only. A result is never applied until Use and, if needed, Overwrite. */
  const validBggId = (value) => /^[1-9]\d{0,8}$/.test(str(value));
  const bggImageUrl = (value) => {
    const raw = typeof value === "string" ? value : "";
    try { const u = new URL(raw); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? raw : ""; } catch { return ""; }
  };
  function bggIdRecord(value, id) {
    if (!value || str(value.bggId) !== id || !str(value.name)) return null;
    const type = str(value.bggType);
    if (!["boardgame", "boardgameexpansion", "rpgitem"].includes(type)) return null;
    return { title: str(value.name), bggId: id, bggType: type,
      year: bggNum(value.year), designer: str(value.designer), players: str(value.players), playTime: bggNum(value.playTime),
      coverUrl: bggImageUrl(value.image) || bggImageUrl(value.thumbnail) };
  }
  /**
   * Patch for an accepted result. `sources` says, per ID-bound field, which BGG id filled it ("" =
   * typed by hand); a string applies to every field. Never the typed ID input. A field the result
   * lacks is cleared only when it came from a DIFFERENT BGG id, so details from different games
   * never mix; same-id and hand-typed values stay. `kept` lists hand-typed fields that stay.
   */
  function bggIdPatch(record, sources) {
    const patch = Object.fromEntries(Object.entries(record).filter(([, v]) => v !== ""));
    const srcOf = (k) => (typeof sources === "object" && sources ? (typeof sources[k] === "string" ? sources[k] : "?") : str(sources));
    const cleared = [], kept = [], unchanged = [];
    BGG_ID_BOUND.forEach((k) => {
      if (k in patch) return;
      const src = srcOf(k), from = srcId(src);
      if (from && from !== record.bggId) { patch[k] = ""; cleared.push(k); }
      else if (src === "") kept.push(k); // known hand-typed
      else unchanged.push(k); // same BGG id, or origin unknown with no BGG id
    });
    return { patch, cleared, kept, unchanged };
  }
  function createBggIdLookup({ relay, fetcher, current, isOpen, onState, confirm, apply, identity = () => "", timers = globalThis }) {
    let seq = 0, controller = null, timer = null, candidate = null, selected = false, busy = false, activeId = "";
    const emit = (state) => onState(state);
    const reset = () => {
      ++seq; controller?.abort(); controller = null;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null; candidate = null; selected = false; busy = false; activeId = ""; emit({ status: "idle" });
    };
    const valid = (token, id) => token === seq && isOpen() && str(current().bggId) === id;
    async function lookup(raw) {
      const id = str(raw);
      if (busy && activeId === id) return;
      reset();
      if (!validBggId(id)) { emit({ status: "error", message: "Enter a BGG id using digits only." }); return; }
      const token = seq;
      controller = new AbortController(); const signal = controller.signal;
      activeId = id; busy = true; emit({ status: "loading" });
      timer = timers.setTimeout(() => controller?.abort(), 20000);
      try {
        const response = await fetcher(`${relay}/thing?ids=${encodeURIComponent(id)}`, { headers: { Accept: "application/json" }, signal, credentials: "omit", redirect: "error" });
        if (!valid(token, id)) return;
        if (!response.ok) {
          const retry = response.headers?.get("Retry-After");
          emit({ status: "error", message: response.status === 429 || response.status === 503
            ? `BGG lookup is unavailable right now.${/^\d{1,6}$/.test(retry || "") ? ` Try again in ${retry} seconds.` : " Try again later."} What you typed is kept.`
            : "Couldn’t look up this BGG id. What you typed is kept." }); return;
        }
        const data = await response.json();
        if (!valid(token, id)) return;
        const matches = Array.isArray(data?.things) ? data.things.filter((v) => str(v?.bggId) === id) : [];
        candidate = matches.length === 1 ? bggIdRecord(matches[0], id) : null;
        emit(candidate ? { status: "choice", candidate, selected: false } : { status: "none", message: "No supported game found for this BGG id. What you typed is kept." });
      } catch (error) {
        if (valid(token, id)) emit({ status: "error", message: signal.aborted ? "BGG lookup timed out. What you typed is kept." : "Couldn’t look up this BGG id. What you typed is kept." });
      } finally {
        if (token === seq) { busy = false; timers.clearTimeout(timer); timer = null; controller = null; }
      }
    }
    const select = () => { if (candidate && isOpen()) { selected = true; emit({ status: "choice", candidate, selected: true }); } };
    function use() {
      if (!candidate || !selected || busy || !isOpen()) return;
      const token = seq, record = candidate, before = current(), snapshot = JSON.stringify(before);
      if (!valid(token, record.bggId)) return;
      const finish = () => {
        if (!valid(token, record.bggId) || JSON.stringify(current()) !== snapshot) return;
        apply(bggIdPatch(record, sources).patch, record.bggId);
        ++seq; candidate = null; selected = false;
        emit({ status: "used", message: "Game details filled in. Check them, then save." });
      };
      const sources = identity();
      const { patch, cleared, kept, unchanged } = bggIdPatch(record, sources);
      const clears = cleared.filter((k) => str(before[k]));
      const keeps = kept.filter((k) => str(before[k]));
      const holds = unchanged.filter((k) => str(before[k]));
      const conflicts = Object.entries(patch).some(([k, v]) => str(before[k]) && str(before[k]) !== v);
      if (conflicts) confirm(finish, { clears, keeps, holds }); else finish();
    }
    return { lookup, reset, select, use };
  }

  const core = { validBggId, bggImageUrl, bggIdRecord, bggIdPatch, cleanBggSrc, BGG_ID_BOUND, createBggIdLookup, STORE_KEY, validGtin, barcodePostDecision, GAMEUPC_LOOKUP, SUBTYPES, normalize, resolveParent, groupShelf, expansionsOf, findDuplicate, mergeUpdate, linkBggId, upsert, remove, applyBarcodeMiss, mergeRestore, HAND_MATCH, carryExpansions, parseBackupBlock, lookupConnected: () => Boolean(LOOKUP_RELAY_URL), lookupCreditsAllowed };
  if (typeof module !== "undefined" && module.exports) module.exports = core;
  if (typeof document === "undefined") return;

  /* ---------------- storage (same pattern as app.js: re-read before every write) ---------------- */

  let entries = [];
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
      entries = Array.isArray(raw) ? raw.map(normalize) : [];
    } catch {
      entries = [];
    }
    return entries;
  }
  /** Returned by a commit mutation to cancel the write: nothing is stored. */
  const ABORT = Symbol("abort");
  /** Outcome: "committed" (stored), "aborted" (mutation declined; storage untouched), "failed" (storage error). */
  function commit(mutate) {
    load(); // another tab may have written since we last read
    const next = mutate(entries.slice());
    if (next === ABORT) return "aborted";
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
      entries = next;
      return "committed";
    } catch {
      host.toast && host.toast("Couldn’t save — storage may be full");
      return "failed";
    }
  }
  const snap = (e) => (e ? JSON.stringify(normalize(e)) : "");

  /* ---------------- UI ---------------- */

  let host = {};
  let active = false;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  /** Creator · year · players · time; non-breaking inside "1–5 players" and "90 min". "" when all empty. */
  const NB = "\u00a0";
  const WJ = "\u2060"; // word joiner: no line break at the dash in "1–5"
  const metaText = (e) =>
    [e.designer, e.year, e.players && `${e.players.replace(/\s*([–-])\s*/g, `${WJ}$1${WJ}`)}${NB}players`, e.playTime && `${e.playTime}${NB}min`]
      .filter(Boolean)
      .join(" · ");
  const meta = (e) => metaText(e) || "—";
  /** Lone expansions and the sheet drop the line entirely when it would only be "—". */
  const metaLine = (e) => (metaText(e) ? `<p class="item-meta">${esc(metaText(e))}</p>` : "");
  const statusBadge = (e) => `<span class="badge badge-status tt-status ${e.status}">${STATUS_LABELS[e.status]}</span>`;
  const subtypeBadge = (e) => `<span class="badge badge-type tabletop">${SUBTYPE_LABELS[e.subtype]}</span>`;

  function cover(e) {
    const inner = e.coverUrl
      ? `<img class="item-cover" src="${esc(e.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
      : `<div class="item-cover-placeholder tabletop" aria-hidden="true">Tabletop</div>`;
    return `<div class="item-cover-col" data-type="tabletop">${inner}</div>`;
  }

  function cardHtml(g) {
    const e = g.entry;
    const lone = e.subtype === "expansion";
    const exps = g.expansions;
    const shown = exps.slice(0, VISIBLE_EXPANSIONS);
    const more = exps.length - shown.length;
    const expList = exps.length
      ? `<ul class="tt-exp-list" aria-label="${esc(`Expansions of ${e.title}`)}">${shown
          .map(
            (x) =>
              `<li><button type="button" class="tt-exp-row" data-tt-open="${esc(x.id)}" aria-label="${esc(`${x.title}, expansion, ${STATUS_LABELS[x.status]}`)}"><span class="tt-exp-title">${esc(x.title)}</span>${statusBadge(x)}</button></li>`
          )
          .join("")}${more > 0 ? `<li><button type="button" class="tt-exp-more" data-tt-open="${esc(e.id)}">+ ${more} more</button></li>` : ""}</ul>`
      : "";
    // Title-only card; detail (openDetail) keeps subtype, status, meta, notes, expansions.
    return `<li class="tt-group">
  <article class="item-card tt-card" tabindex="0" role="button" data-tt-open="${esc(e.id)}" aria-label="${esc(`Details for ${e.title}`)}">
    ${cover(e)}
    <div class="item-body">
      <h3 class="item-title" title="${esc(e.title)}">${esc(e.title)}</h3>
    </div>
  </article>${expList}
</li>`;
  }

  function render() {
    const view = $("#tabletop-view");
    if (!view) return;
    load();
    const q = normTitle(host.search ? host.search() : "");
    const status = host.status ? host.status() : "all";
    let list = entries;
    const groups = groupShelf(list, host.sort && host.sort() === "updated" ? "updated" : "title").filter((g) => {
      const hit = (e) => (!q || [e.title, e.designer, e.notes].some((s) => normTitle(s).includes(q))) && (status === "all" || e.status === status);
      return hit(g.entry) || g.expansions.some(hit);
    });
    $("#tabletop-list").innerHTML = groups.map(cardHtml).join("");
    const empty = $("#tabletop-empty");
    empty.hidden = groups.length > 0;
    if (!groups.length) {
      const filtered = entries.length > 0;
      $(".empty-title", empty).textContent = filtered ? "No matches" : "No tabletop games yet";
      $(".empty-hint", empty).textContent = filtered
        ? "Try a different filter or search."
        : "Add the board, card, dice, miniatures and RPG games on your shelf. Linked expansions sit under their base game."; // Berean cleared
      $("#tt-empty-add").hidden = filtered;
    }
  }

  function show(on) {
    active = on;
    $("#tabletop-view").hidden = !on;
    if (on) render();
  }

  /* ----- form ----- */
  const F = (id) => document.getElementById(id);
  let returnFocus = null;
  let pendingDup = null;
  const SAVE_ABORTED = "Not saved: this game changed in another tab. Your entries are still here; check them and save again.";
  function clearDupPrompt() { pendingDup = null; F("tt-dup").hidden = true; }

  // v41: Tabletop sheets set body.modal-open too, so app.js pins the page behind them while
  // the keyboard is up (the Duo fix). It's cleared only when no other sheet is still open.
  const releaseModalOpen = () => {
    if (!document.querySelector(".modal:not([hidden])")) document.body.classList.remove("modal-open");
  };
  function openModal(id) {
    const m = F(id);
    returnFocus = returnFocus || document.activeElement;
    m.hidden = false;
    m.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }
  function closeModal(id) {
    if (id === "tt-form-modal") resetBggIdLookup();
    const m = F(id);
    m.hidden = true;
    m.setAttribute("aria-hidden", "true");
    releaseModalOpen();
    if (F("tt-form-modal").hidden && F("tt-detail-modal").hidden && returnFocus) {
      try { returnFocus.focus(); } catch {}
      returnFocus = null;
    }
  }

  function fillParentOptions(selfId, current) {
    const sel = F("tt-parent");
    const bases = entries.filter((e) => isBase(e) && e.id !== selfId).sort((a, b) => normTitle(a.title).localeCompare(normTitle(b.title)));
    sel.innerHTML = `<option value="">Not in my library</option>` + bases.map((b) => `<option value="${esc(b.id)}"${b.id === current ? " selected" : ""}>${esc(b.title)}</option>`).join("");
  }

  function syncExpansionRows() {
    const isExp = F("tt-subtype").value === "expansion";
    F("tt-parent-row").hidden = !isExp;
    F("tt-parent-bgg-row").hidden = !isExp;
  }

  function openForm(entry, prefill) {
    load();
    const e = entry || normalize({ ...(prefill || {}), id: "" });
    pendingDup = null;
    F("tt-form-title").textContent = entry ? "Edit tabletop game" : "Add tabletop game";
    F("tt-id").value = entry ? entry.id : "";
    F("tt-title").value = e.title || "";
    F("tt-subtype").value = e.subtype;
    F("tt-status").value = entry ? e.status : "owned";
    fillParentOptions(entry && entry.id, entry ? (resolveParent(entries, entry) || {}).id || "" : "");
    ["bggId", "year", "designer", "players", "playTime", "coverUrl", "barcode", "notes", "parentBggId"].forEach((k) => {
      const el = F(`tt-${k}`);
      if (el) el.value = entry ? e[k] || "" : "";
    });
    F("tt-dup").hidden = true;
    F("tt-title-error").hidden = true;
    F("tt-save-status").hidden = true;
    resetBggIdLookup();
    resetBarcodeLookup();
    F("tt-bggType").value = entry ? e.bggType || "" : "";
    // Durable sources from the saved entry; a field without one is unknown, tied to the saved id.
    bggFieldSrc = {};
    const savedSrc = entry ? cleanBggSrc(e.bggSrc, e) : {};
    BGG_ID_BOUND.forEach((k) => { if (str(F(`tt-${k}`).value)) bggFieldSrc[k] = k in savedSrc ? savedSrc[k] : `?${entry ? bggNum(e.bggId) : ""}`; });
    syncExpansionRows();
    closeModal("tt-detail-modal");
    openModal("tt-form-modal");
    F("tt-title").focus();
  }

  function readForm() {
    const v = (k) => F(`tt-${k}`).value;
    const parentId = v("subtype") === "expansion" ? v("parent") : "";
    const parent = parentId ? entries.find((e) => e.id === parentId) : null;
    const existing = entries.find((e) => e.id === v("id"));
    return {
      ...(existing || {}),
      id: v("id"),
      title: v("title"),
      subtype: v("subtype"),
      status: v("status"),
      bggId: v("bggId"),
      bggType: v("bggType"),
      bggIsExpansion: v("bggType") ? v("bggType") === "boardgameexpansion" : Boolean(existing && existing.bggId === str(v("bggId")) && existing.bggIsExpansion),
      year: v("year"),
      designer: v("designer"),
      players: v("players"),
      playTime: v("playTime"),
      coverUrl: v("coverUrl"),
      bggSrc: Object.fromEntries(BGG_ID_BOUND.filter((k) => str(v(k))).map((k) => [k, typeof bggFieldSrc[k] === "string" ? bggFieldSrc[k] : "?"])),
      barcode: v("barcode"),
      notes: v("notes"),
      parentId,
      parentBggId: parent && parent.bggId ? parent.bggId : v("parentBggId"),
      parentTitle: parent ? parent.title : existing && !parentId ? existing.parentTitle : "",
      dateUpdated: nowIso(),
    };
  }

  function saveForm(mode) {
    const data = readForm();
    if (!str(data.title)) {
      F("tt-title-error").hidden = false;
      F("tt-title").setAttribute("aria-invalid", "true");
      F("tt-title").focus();
      return;
    }
    F("tt-title").removeAttribute("aria-invalid");
    load();
    // What this save was checked against; the final write aborts if it changed in between (another tab).
    const editBase = data.id ? snap(entries.find((e) => e.id === data.id)) : "";    // Update / Add-copy answer a duplicate prompt: re-check it against the current form and shelf.
    // If the match changed (id/title edited, target deleted or replaced, a new match), ask again.
    if (mode) {
      const fresh = findDuplicate(entries, normalize({ ...data, id: data.id || "__new__" }));
      if (!pendingDup || !fresh || fresh.by !== pendingDup.by || fresh.match.id !== pendingDup.match.id) {
        clearDupPrompt();
        saveForm(null);
        return;
      }
      pendingDup = fresh;
    }
    // Barcode match (lookup on only): a hand-entered game with a BGG id asks before anything
    // is sent. Nothing is sent for a verified match or without a BGG id.
    const post = barcodeLookupOn ? barcodePostDecision(look, data) : { send: null };
    if (post.ask) {
      look.pendingMode = mode;
      showSendAsk(data);
      return;
    }
    if (!mode) {
      const dup = findDuplicate(entries, normalize({ ...data, id: data.id || "__new__" }));
      if (dup) {
        pendingDup = dup;
        F("tt-dup-text").textContent =
          dup.by === "bgg"
            ? `“${dup.match.title}” with this BGG id is already in your library. Update it instead of adding a second copy?`
            : `You already have “${dup.match.title}”. Editions and reprints can share a title. Update that entry, or add this as a separate copy?`; // Berean cleared
        F("tt-dup").hidden = false;
        F("tt-dup-update").focus();
        return;
      }
    }
    let savedId = data.id;
    const dupBase = mode === "update" && pendingDup ? snap(pendingDup.match) : "";
    const outcome = commit((list) => {
      if (data.id && snap(list.find((e) => e.id === data.id)) !== editBase) return ABORT; // edited entry changed/deleted
      if (mode === "update" && pendingDup) {
        const target = list.find((e) => e.id === pendingDup.match.id);
        if (!target || snap(target) !== dupBase) return ABORT; // target vanished or changed since the check
        const merged = mergeUpdate(target, data);
        savedId = merged.id;
        return upsert(list, merged);
      }
      if (!mode && findDuplicate(list, normalize({ ...data, id: data.id || "__new__" }))) return ABORT; // a match appeared
      const e = normalize({ ...data, id: data.id || newId(), dateAdded: data.dateAdded || nowIso() });
      savedId = e.id;
      return upsert(list, e);
    });
    if (outcome === "aborted") {
      // Not saved: keep the sheet and everything typed; no success message, no barcode send. Save again re-checks.
      clearDupPrompt();
      load();
      host.toast && host.toast(SAVE_ABORTED);
      F("tt-save-status").textContent = SAVE_ABORTED;
      F("tt-save-status").hidden = false;
      return;
    }
    if (outcome !== "committed") return;
    closeModal("tt-form-modal");
    render();
    host.renderStats && host.renderStats();
    // A confirmed pick dropped at Save (BGG id or barcode edited after Confirm): say it wasn't sent.
    const dropped = Boolean(barcodeLookupOn) && !post.send && ((look && look.status === "choose" && look.confirmed) || lostConfirm);
    lostConfirm = false;
    if (dropped) look = null;
    host.toast && host.toast(dropped ? UPC_COPY.postFailed : mode === "update" ? "Updated" : "Saved");
    if (post.send) {
      const cfg = barcodeLookupOn;
      look = null; // sent once; a re-save never re-sends
      // Non-blocking: the game is already saved on this device whatever happens here.
      sendBarcodeMatch(cfg, post.send).then((ok) => { if (!ok && host.toast) host.toast(UPC_COPY.postFailed); });
    }
  }


  /* ----- barcode lookup (GameUPC via the relay). Runs only when barcodeLookupConfig() is set. ----- */
  // Every user-facing string of the barcode lookup. PENDING BEREAN (all).
  const UPC_COPY = {
    button: "Look up barcode",
    loading: "Looking up barcode…",
    found: (n) => `Found ${n}. Check the details, then save.`,
    pickTitle: "Pick your game",
    pickHint: "Choose the game that matches this box.",
    noneOfThese: "None of these",
    confirmTitle: "Is this your game?",
    confirmWhat: (u) => `Confirm fills in this game. When you save, its BGG id and barcode ${u} are sent to GameUPC, with a random id for this device, so this barcode can be matched next time.`,
    confirmWrong: "If it’s wrong, choose Cancel. Nothing is sent until you confirm and save.",
    confirm: "Confirm",
    cancel: "Cancel",
    picked: (n) => `${n} filled in. Its BGG id is sent to GameUPC with this barcode when you save.`,
    noneTitle: "No match for this barcode",
    noneHint: "Enter the game yourself. If you add its BGG id, you’ll be asked before it’s sent to GameUPC with this barcode. Without a BGG id, nothing is sent.",
    sendTitle: "Send this barcode match to GameUPC?",
    sendWhat: (t, id, u) => `${t}, BGG id ${id}, barcode ${u}. Sent with a random id for this device.`,
    sendDevice: "Sent with a random id for this device.",
    sendWhy: "Sending helps this barcode match this game next time. If it’s wrong, choose Save only.",
    sendYes: "Save and send",
    sendNo: "Save only",
    errBadCode: "That barcode doesn’t look right. Check the digits.",
    errBusy: "Too many lookups. Try again in a minute.", // this client's own 429
    errUpstreamBusy: "Barcode lookup is busy. Try again in a minute.", // 503 / GameUPC busy
    errFailed: "Couldn’t look up this barcode. Try again, or enter the game yourself.",
    postFailed: "Saved. The barcode match wasn’t sent.",
    yearLabel: (y) => (y ? `, ${y}` : ""),
  };
  const UPC_DEBOUNCE_MS = 600;
  let look = null; // { upc, status, data, confirmed, answer }
  let upcTimer = 0;
  let upcSeq = 0;
  const upcSession = new Map(); // upc -> relay answer (this page load)
  const upcInflight = new Map(); // upc -> Promise

  function upcFetch(cfg, upc) {
    if (upcSession.has(upc)) return Promise.resolve(upcSession.get(upc));
    if (upcInflight.has(upc)) return upcInflight.get(upc);
    const p = fetch(`${cfg.relay}/barcode?upc=${encodeURIComponent(upc)}`, { headers: { Accept: "application/json" } })
      .then(async (r) => {
        if (r.status === 200) { const d = await r.json(); upcSession.set(upc, d); return d; }
        throw new Error(r.status === 400 ? "bad" : r.status === 429 ? "busy" : r.status === 503 ? "upstreamBusy" : "failed");
      })
      .finally(() => upcInflight.delete(upc));
    upcInflight.set(upc, p);
    return p;
  }

  /**
   * This device's GameUPC user_id (GameUPC asks for "a unique (but consistent) user_id for each
   * user"). Made the first time this device sends a match, then kept in its own storage key, which
   * backups and exports never read. If storage is unavailable, the id lasts for this page load.
   */
  const DEVICE_ID_KEY = "frm-gameupc-device-id";
  const DEVICE_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
  let sessionDeviceId = "";
  function makeDeviceId() {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }
  function deviceId() {
    try {
      const saved = localStorage.getItem(DEVICE_ID_KEY);
      if (saved && DEVICE_ID_RE.test(saved)) return saved;
      const id = makeDeviceId();
      localStorage.setItem(DEVICE_ID_KEY, id);
      return id;
    } catch (_) {
      if (!sessionDeviceId) sessionDeviceId = makeDeviceId();
      return sessionDeviceId;
    }
  }

  /** The ONLY POST. Called from saveForm after a confirmed pick / a "Save and send" answer. */
  function sendBarcodeMatch(cfg, m) {
    return fetch(`${cfg.relay}/barcode/confirm`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ ...m, userId: deviceId() }) })
      .then((r) => r.ok)
      .catch(() => false);
  }

  function upcPanel() { return F("tt-upc-panel"); }
  function upcView(html, focusSel) {
    const p = upcPanel();
    p.innerHTML = html;
    p.hidden = !html;
    // A thumbnail that fails to load becomes the plain placeholder (no broken-image icon).
    p.querySelectorAll("img.tt-upc-thumb").forEach((img) => img.addEventListener("error", () => {
      const ph = document.createElement("span");
      ph.className = "tt-upc-thumb tt-upc-thumb-none";
      ph.setAttribute("aria-hidden", "true");
      img.replaceWith(ph);
    }, { once: true }));
    if (focusSel) { const el = p.querySelector(focusSel); if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "nearest" }); } }
    // A question (Confirm card / send-ask): bring its buttons fully above the pinned bar's rule
    // and fade (the sheet's scroll-padding-bottom covers bar + fade).
    const q = p.querySelector(".tt-upc-confirm");
    if (q) {
      const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      q.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    }
  }
  const upcStatus = (msg, cls = "", logo = false) => upcView(`<p class="field-hint tt-upc-msg ${cls}" role="status">${esc(msg)}</p>${logo ? bggLogo() : ""}`);
  const thumb = (c) => (c.thumbnail && !/blank_box_thumb/.test(c.thumbnail)
    ? `<img class="tt-upc-thumb" src="${esc(c.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : `<span class="tt-upc-thumb tt-upc-thumb-none" aria-hidden="true"></span>`);
  const candRow = (c) => `${thumb(c)}<span class="tt-upc-cand-text"><span class="tt-upc-cand-name">${esc(c.name)}</span>${c.year ? `<span class="tt-upc-cand-year">${esc(c.year)}</span>` : ""}</span>`;

  function fillFromCandidate(c, overwrite) {
    const set = (k, v) => { const el = F(`tt-${k}`); if (el && v && (overwrite || !str(el.value))) { el.value = v; tagBggFields([k], c.bggId); } };
    const previousBggId = F("tt-bggId").value;
    set("title", c.name);
    set("bggId", c.bggId);
    if (F("tt-bggId").value !== previousBggId) F("tt-bggType").value = "";
    set("year", c.year);
  }

  function showChoose() {
    const cands = look.data.candidates;
    upcView(`<h3 class="tt-upc-h" id="tt-upc-h" tabindex="-1">${esc(UPC_COPY.pickTitle)}</h3>
<p class="field-hint">${esc(UPC_COPY.pickHint)}</p>
<ul class="tt-upc-list" aria-labelledby="tt-upc-h">${cands.map((c, i) => `<li><button type="button" class="tt-upc-cand" data-upc-pick="${i}" aria-label="${esc(c.name + UPC_COPY.yearLabel(c.year))}">${candRow(c)}</button></li>`).join("")}</ul>
<button type="button" class="tt-upc-secondary" data-upc-none="1">${esc(UPC_COPY.noneOfThese)}</button>${bggLogo()}`, "#tt-upc-h");
  }
  function showConfirmPick(i) {
    const c = look.data.candidates[i];
    look.pickIndex = i;
    upcView(`<div class="tt-upc-confirm" role="group" aria-labelledby="tt-upc-h" aria-describedby="tt-upc-what tt-upc-wrong">
<h3 class="tt-upc-h" id="tt-upc-h" tabindex="-1">${esc(UPC_COPY.confirmTitle)}</h3>
<div class="tt-upc-cand tt-upc-cand-static">${candRow(c)}</div>
<p class="field-hint" id="tt-upc-what">${esc(UPC_COPY.confirmWhat(look.upc))}</p>
<p class="field-hint" id="tt-upc-wrong">${esc(UPC_COPY.confirmWrong)}</p>
<div class="tt-upc-actions"><button type="button" class="btn btn-ghost" data-upc-cancel="1">${esc(UPC_COPY.cancel)}</button><button type="button" class="btn btn-primary" data-upc-confirm="1">${esc(UPC_COPY.confirm)}</button></div></div>${bggLogo()}`, "#tt-upc-h");
  }
  function showNone() {
    look.status = "none"; // "None of these" joins the no-data path: hand entry, ask before any send
    upcView(`<h3 class="tt-upc-h" id="tt-upc-h" tabindex="-1">${esc(UPC_COPY.noneTitle)}</h3><p class="field-hint">${esc(UPC_COPY.noneHint)}</p>`, "#tt-upc-h");
  }
  function showSendAsk(form) {
    upcView(`<div class="tt-upc-confirm" role="group" aria-labelledby="tt-upc-h" aria-describedby="tt-upc-what tt-upc-wrong">
<h3 class="tt-upc-h" id="tt-upc-h" tabindex="-1">${esc(UPC_COPY.sendTitle)}</h3>
<div class="tt-upc-cand tt-upc-cand-static" id="tt-upc-what" aria-label="${esc(UPC_COPY.sendWhat(str(form.title), bggNum(form.bggId), look.upc))}"><span class="tt-upc-cand-text"><span class="tt-upc-cand-name">${esc(str(form.title))}</span><span class="tt-upc-cand-year">BGG ${esc(bggNum(form.bggId))} · <span class="tt-upc-nowrap">Barcode ${esc(look.upc)}</span></span><span class="tt-upc-cand-year tt-upc-device">${esc(UPC_COPY.sendDevice)}</span></span></div>
<p class="field-hint" id="tt-upc-wrong">${esc(UPC_COPY.sendWhy)}</p>
<div class="tt-upc-actions"><button type="button" class="btn btn-ghost" data-upc-ask-cancel="1">${esc(UPC_COPY.cancel)}</button><button type="button" class="btn btn-ghost" data-upc-send="skip">${esc(UPC_COPY.sendNo)}</button><button type="button" class="btn btn-primary" data-upc-send="send">${esc(UPC_COPY.sendYes)}</button></div></div>`, "#tt-upc-h");
  }

  function runLookup(cfg) {
    resetBggIdLookup();
    clearTimeout(upcTimer);
    const upc = str(F("tt-barcode").value).replace(/[\s-]/g, "");
    if (!/^\d{8,14}$/.test(upc)) { look = null; upcStatus(UPC_COPY.errBadCode, "tt-upc-err"); return; }
    if (look && look.upc === upc && look.data) return; // already answered for this code
    if (upcInflight.has(upc)) return; // one request per code at a time
    const seq = ++upcSeq;
    look = { upc, status: null, data: null, confirmed: null, answer: null };
    const btn = F("tt-upc-go");
    btn.setAttribute("aria-busy", "true");
    upcView(`<p class="field-hint tt-upc-msg tt-upc-loading" role="status"><span class="tt-upc-spin" aria-hidden="true"></span>${esc(UPC_COPY.loading)}</p>`);
    upcFetch(cfg, upc).then((d) => {
      if (seq !== upcSeq) return; // a newer code was typed meanwhile
      look.data = d;
      look.status = d.status;
      if (d.status === "verified" && d.candidates[0]) {
        fillFromCandidate(d.candidates[0], false);
        upcStatus(UPC_COPY.found(d.candidates[0].name), "tt-upc-found", true);
      } else if (d.status === "choose" && d.candidates.length) showChoose();
      else showNone();
    }).catch((err) => {
      if (seq !== upcSeq) return;
      look = null;
      upcStatus(err.message === "bad" ? UPC_COPY.errBadCode : err.message === "busy" ? UPC_COPY.errBusy : err.message === "upstreamBusy" ? UPC_COPY.errUpstreamBusy : UPC_COPY.errFailed, "tt-upc-err");
    }).finally(() => { if (seq === upcSeq) btn.removeAttribute("aria-busy"); });
  }

  function setupBarcodeLookup() {
    const cfg = barcodeLookupConfig();
    if (!cfg) return; // flag off: no UI, no listeners, no network
    const grid = F("tt-barcode").closest(".form-grid");
    const row = document.createElement("div");
    row.className = "form-row tt-upc";
    row.id = "tt-upc";
    row.innerHTML = `<button type="button" class="btn btn-outline tt-upc-go" id="tt-upc-go" aria-controls="tt-upc-panel">${esc(UPC_COPY.button)}</button><div class="tt-upc-panel" id="tt-upc-panel" aria-live="polite" hidden></div>`;
    grid.after(row);
    F("tt-barcode").setAttribute("aria-describedby", "tt-upc-panel");
    F("tt-upc-go").addEventListener("click", () => runLookup(cfg));
    // Debounce: a lookup fires 600 ms after typing stops, and only for a complete code with a
    // valid check digit, so no request goes out per keystroke.
    F("tt-barcode").addEventListener("input", () => {
      clearTimeout(upcTimer);
      const v = str(F("tt-barcode").value).replace(/[\s-]/g, "");
      if (look && look.upc !== v) { if (look.status === "choose" && look.confirmed) lostConfirm = true; look = null; upcSeq++; upcView(""); F("tt-upc-go").removeAttribute("aria-busy"); }
      if (validGtin(v)) upcTimer = setTimeout(() => runLookup(cfg), UPC_DEBOUNCE_MS);
    });
    row.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b || !look) return;
      if (b.dataset.upcPick) showConfirmPick(Number(b.dataset.upcPick));
      else if (b.dataset.upcNone) showNone();
      else if (b.dataset.upcCancel) {
        const i = look.pickIndex;
        showChoose();
        const r = upcPanel().querySelector(`[data-upc-pick="${i}"]`);
        if (r) r.focus();
      } else if (b.dataset.upcConfirm) {
        const c = look.data.candidates[look.pickIndex];
        look.confirmed = { bggId: c.bggId };
        lostConfirm = false;
        fillFromCandidate(c, true);
        upcStatus(UPC_COPY.picked(c.name), "", true);
        F("tt-title").focus();
      } else if (b.dataset.upcSend) {
        look.answer = b.dataset.upcSend;
        look.confirmed = { bggId: bggNum(F("tt-bggId").value) };
        upcView(""); // the save goes on
        saveForm(look.pendingMode || null);
      } else if (b.dataset.upcAskCancel) {
        look.answer = null;
        showNone();
        F("tt-save").focus();
      }
    });
    barcodeLookupOn = cfg;
  }
  let barcodeLookupOn = null;
  /* ----- direct BGG ID: separate from title search and GameUPC posting ----- */
  let bggIdLookup = null, bggConfirmDone = null;
  /** Per ID-bound field: the BGG id that filled it ("" = typed by hand). Set on open, accepted direct
   *  lookup, GameUPC fill and hand edits; only fields actually written are tagged. */
  let bggFieldSrc = {};
  function tagBggFields(keys, id) { keys.forEach((k) => { if (BGG_ID_BOUND.includes(k)) { if (str(F(`tt-${k}`).value)) bggFieldSrc[k] = str(id); else delete bggFieldSrc[k]; } }); }
  const BGG_FIELD_LABELS = { coverUrl: "cover", year: "year", designer: "designer", players: "players", playTime: "play time" };
  function resetBggIdLookup() {
    bggIdLookup?.reset();
    bggConfirmDone = null;
  }
  function setupBggIdLookup() {
    const cfg = barcodeLookupConfig();
    if (!cfg || F("tt-bgg-go")) return;
    const field = F("tt-bggId"), row = document.createElement("div");
    row.className = "form-row tt-bgg-id-lookup";
    row.innerHTML = `<button type="button" class="btn btn-outline tt-bgg-id-go" id="tt-bgg-go" aria-controls="tt-bgg-panel">Look up BGG id</button><div id="tt-bgg-panel" class="tt-upc-panel" aria-live="polite" hidden></div>`;
    field.closest(".form-grid").after(row);
    field.setAttribute("aria-describedby", "tt-bgg-panel");
    const panel = F("tt-bgg-panel"), button = F("tt-bgg-go");
    field.after(button); // Keep the ID action beside its own field, not the barcode field.
    const keys = ["title", "bggId", "bggType", "year", "designer", "players", "playTime", "coverUrl", "subtype"];
    const current = () => Object.fromEntries(keys.map((k) => [k, F(`tt-${k}`).value]));
    bggIdLookup = createBggIdLookup({ relay: cfg.relay, fetcher: (...args) => fetch(...args), current,
      isOpen: () => !F("tt-form-modal").hidden,
      identity: () => ({ ...bggFieldSrc }),
      confirm: (done, info = {}) => {
        const names = (ks) => ks.map((k) => BGG_FIELD_LABELS[k]).join(", ");
        const clearNote = (info.clears && info.clears.length ? ` This BGG result has no ${names(info.clears)}. Those fields will be cleared to avoid mixing details from different games.` : "")
          + (info.keeps && info.keeps.length ? ` Kept as you typed: ${names(info.keeps)}.` : "")
          + (info.holds && info.holds.length ? ` Kept unchanged: ${names(info.holds)}.` : "");
        bggConfirmDone = done;
        panel.innerHTML = `<div class="tt-bgg-confirm" role="group" aria-labelledby="tt-bgg-overwrite-title"><h3 id="tt-bgg-overwrite-title" class="tt-upc-h">Overwrite filled details?</h3><p class="field-hint">Use this BGG result to replace the filled game details?${clearNote} Your barcode, notes and ownership details stay as entered.</p><div class="tt-upc-actions"><button type="button" class="btn btn-outline" data-bgg-back="1">Cancel</button><button type="button" class="btn btn-primary" data-bgg-overwrite="1">Overwrite</button></div></div>${bggLogo()}`;
        panel.querySelector("[data-bgg-back]").focus();
      },
      apply: (record, acceptedId) => {
        resetBarcodeLookup(); // no implicit GameUPC confirmation or send from direct ID lookup
        Object.entries(record).forEach(([k, v]) => { F(`tt-${k}`).value = v; });
        tagBggFields(Object.keys(record), acceptedId);
        syncExpansionRows(); F("tt-title").removeAttribute("aria-invalid"); F("tt-title-error").hidden = true;
      },
      onState: (state) => {
        button.setAttribute("aria-busy", String(state.status === "loading"));
        panel.hidden = state.status === "idle";
        if (state.status === "idle") { bggConfirmDone = null; panel.innerHTML = ""; return; }
        if (state.status !== "choice") {
          panel.innerHTML = `<p class="field-hint${state.status === "error" ? " tt-upc-err" : ""}" role="status">${esc(state.message || "Looking up BGG id…")}</p>${state.status === "used" ? bggLogo() : ""}`;
          return;
        }
        const c = state.candidate;
        const image = c.coverUrl ? `<img src="${esc(c.coverUrl)}" alt="" referrerpolicy="no-referrer" />` : `<span aria-hidden="true">No cover</span>`;
        panel.innerHTML = `<p class="field-hint">Choose this result, then use it to fill the game details.</p><button type="button" class="tt-upc-cand tt-bgg-choice" data-bgg-pick="1" aria-pressed="${state.selected}"><span class="tt-bgg-cover">${image}</span><span class="tt-upc-cand-text"><span class="tt-upc-cand-name">${esc(c.title)}</span><span class="tt-upc-cand-year">BGG id ${esc(c.bggId)}${c.bggType === "boardgameexpansion" ? " · Expansion" : c.bggType === "rpgitem" ? " · RPG" : ""}${c.year ? ` · ${esc(c.year)}` : ""}</span></span></button><div class="tt-upc-actions"><button type="button" class="btn btn-outline" data-bgg-cancel="1">Cancel lookup</button><button type="button" class="btn btn-primary" data-bgg-use="1"${state.selected ? "" : " disabled"}>Use this match</button></div>${bggLogo()}`;
        panel.querySelector(".tt-bgg-cover img")?.addEventListener("error", (ev) => {
          const placeholder = document.createElement("span"); placeholder.textContent = "No cover"; placeholder.setAttribute("aria-hidden", "true"); ev.target.replaceWith(placeholder);
        }, { once: true });
        if (state.selected) panel.querySelector("[data-bgg-pick]").focus({ preventScroll: true });
      }
    });
    button.addEventListener("click", () => { resetBarcodeLookup(); bggIdLookup.lookup(field.value); });
    panel.addEventListener("click", (ev) => {
      const target = ev.target.closest("button");
      if (target?.dataset.bggPick) bggIdLookup.select();
      else if (target?.dataset.bggUse) bggIdLookup.use();
      else if (target?.dataset.bggCancel) resetBggIdLookup();
      else if (target?.dataset.bggBack) { bggConfirmDone = null; bggIdLookup.select(); }
      else if (target?.dataset.bggOverwrite) { const done = bggConfirmDone; bggConfirmDone = null; done?.(); }
    });
    F("tt-form").addEventListener("input", (ev) => {
      resetBggIdLookup();
      if (ev.target === field) F("tt-bggType").value = "";
      const k = ev.target && typeof ev.target.id === "string" ? ev.target.id.replace(/^tt-/, "") : "";
      if (BGG_ID_BOUND.includes(k)) tagBggFields([k], ""); // hand edit: the value is now the user's
    });
    F("tt-form").addEventListener("change", () => resetBggIdLookup());
  }

  /**
   * "Look up on BoardGameGeek" (title search): built only when LOOKUP_RELAY_URL is set. While it's
   * empty (today) the button isn't in the page at all: no element, no tab stop, no gap.
   * TODO(title search): wire the click to the relay's /search and /thing when it's connected.
   */
  function setupTitleLookup() {
    if (!LOOKUP_RELAY_URL || F("tt-lookup")) return;
    const row = document.createElement("div");
    row.className = "form-row tt-lookup-row";
    row.innerHTML = `<button type="button" class="btn btn-ghost" id="tt-lookup">Look up on BoardGameGeek</button>`;
    F("tt-title").closest(".form-row").after(row);
  }
  /** Tabletop footer credit: only built when GAMEUPC_LOOKUP.enabled is true (else not in the DOM). */
  function setupBggFooter() {
    if (!bggCreditOn()) return;
    const view = $("#tabletop-view");
    if (!view || F("tt-bgg-credit")) return;
    const p = document.createElement("p");
    p.className = "tt-bgg-credit";
    p.id = "tt-bgg-credit";
    p.innerHTML = `<span class="tt-bgg-credit-text">Game data from BoardGameGeek</span>${BGG_LOGO}`;
    view.appendChild(p);
  }
  // A confirmed pick whose barcode was then edited away (look is dropped on a new code).
  let lostConfirm = false;
  function resetBarcodeLookup() {
    if (!barcodeLookupOn) return;
    lostConfirm = false;
    clearTimeout(upcTimer);
    upcSeq++;
    look = null;
    F("tt-upc-go").removeAttribute("aria-busy");
    upcView("");
  }

  /* ----- detail ----- */
  function openDetail(id) {
    load();
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    F("tt-detail-title").textContent = e.title;
    const rows = [];
    const ml = metaLine(e);
    const head = `<div class="tt-detail-badges">${subtypeBadge(e)}${statusBadge(e)}</div>${ml || ""}`;
    // The saved cover (same URL the shelf card shows), beside the badges/meta; stacks when narrow.
    // No cover or a broken one: no frame at all.
    rows.push(e.coverUrl
      ? `<div class="tt-detail-top"><span class="tt-detail-cover"><img src="${esc(e.coverUrl)}" alt="" referrerpolicy="no-referrer" /></span><div class="tt-detail-meta">${head}</div></div>`
      : head);
    if (e.barcode) rows.push(`<p class="tt-detail-line">Barcode ${esc(e.barcode)}</p>`);
    if (e.subtype === "expansion") {
      const p = resolveParent(entries, e);
      rows.push(`<h3 class="tt-detail-h">Base game</h3>`);
      rows.push(
        p
          ? `<ul class="tt-exp-list tt-exp-list-open"><li><button type="button" class="tt-exp-row" data-tt-open="${esc(p.id)}"><span class="tt-exp-title">${esc(p.title)}</span>${statusBadge(p)}</button></li></ul>`
          : `<p class="tt-detail-line tt-muted">${e.parentTitle || e.parentBggId ? `${esc(e.parentTitle || `BGG id ${e.parentBggId}`)}, not in your library` : "Not in your library"}</p>`
      );
    } else {
      const exps = expansionsOf(entries, e).sort((a, b) => normTitle(a.title).localeCompare(normTitle(b.title)));
      rows.push(`<h3 class="tt-detail-h">Expansions</h3>`);
      rows.push(
        exps.length
          ? `<ul class="tt-exp-list tt-exp-list-open">${exps.map((x) => `<li><button type="button" class="tt-exp-row" data-tt-open="${esc(x.id)}"><span class="tt-exp-title">${esc(x.title)}</span>${statusBadge(x)}</button></li>`).join("")}</ul>`
          : `<p class="tt-detail-line tt-muted">None in your library</p>`
      );
    }
    if (e.notes) rows.push(`<p class="item-notes">${esc(e.notes)}</p>`);
    if (e.bggId) rows.push(`<p class="tt-detail-line tt-bgg-id">BGG id ${esc(e.bggId)}</p>`);
    F("tt-detail-body").innerHTML = rows.join("");
    const cov = F("tt-detail-body").querySelector(".tt-detail-cover img");
    if (cov) cov.addEventListener("error", () => { const w = cov.closest(".tt-detail-cover"); if (w) w.remove(); }, { once: true });
    F("tt-detail-edit").dataset.id = e.id;
    F("tt-detail-delete").dataset.id = e.id;
    openModal("tt-detail-modal");
    F("tt-detail-close").focus();
  }

  /* ----- merge: ask about each hand match, one at a time ----- */
  const MATCH_COPY = {
    title: "Same game?", // PENDING BEREAN
    lede: "The backup has a game with the same title and kind as one on this shelf. It may be a different edition.", // PENDING BEREAN
    progress: (i, n) => `${i} of ${n}`, // PENDING BEREAN
    here: "On this shelf", // PENDING BEREAN
    backup: "From backup", // PENDING BEREAN
    keep: "Keep both", // PENDING BEREAN
    update: "Update existing", // PENDING BEREAN
    skip: "Skip backup copy", // Berean cleared
    rest: "Keep both for the rest", // PENDING BEREAN
    close: "Cancel merge", // PENDING BEREAN
    updated: (d) => `Updated ${d}`, // PENDING BEREAN
    expansionOf: (t) => `Expansion of ${t}`, // PENDING BEREAN
    late: "This one was added to your shelf while you were answering.", // Berean cleared
  };
  const shortDate = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  const parentName = (list, e) => {
    if (e.subtype !== "expansion") return "";
    const p = resolveParent(list, e);
    return p ? p.title : e.parentTitle || (e.parentBggId ? `BGG id ${e.parentBggId}` : "");
  };

  function matchSide(e, other, list, otherList, label, newer) {
    const diff = (a, b) => normTitle(a) !== normTitle(b);
    const B = (txt, d) => (d ? `<b class="tt-diff">${esc(txt)}</b>` : esc(txt));
    const parts = [
      e.designer && B(e.designer, diff(e.designer, other.designer)),
      e.year && B(e.year, diff(e.year, other.year)),
      e.players && B(`${e.players.replace(/\s*([–-])\s*/g, `${WJ}$1${WJ}`)}${NB}players`, diff(e.players, other.players)),
      e.playTime && B(`${e.playTime}${NB}min`, diff(e.playTime, other.playTime)),
    ].filter(Boolean);
    const pn = parentName(list, e);
    const st = (cls, d) => (d ? `${cls} tt-diff` : cls);
    return `<section class="tt-match-side" aria-label="${esc(label)}">
  <h3 class="tt-match-label">${esc(label)}</h3>
  <p class="tt-match-name">${B(e.title, e.title !== other.title)}</p>
  ${parts.length ? `<p class="item-meta">${parts.join(" · ")}</p>` : ""}
  ${pn ? `<p class="tt-match-parent">${B(MATCH_COPY.expansionOf(pn), pn !== parentName(otherList, other))}</p>` : ""}
  <div class="tt-detail-badges">${subtypeBadge(e).replace('class="badge', `class="${st("badge", e.subtype !== other.subtype)}`)}${statusBadge(e).replace('class="badge', `class="${st("badge", e.status !== other.status)}`)}</div>
  ${newer ? `<p class="tt-match-updated">${esc(MATCH_COPY.updated(shortDate(e.dateUpdated)))}</p>` : ""}
</section>`;
  }

  /**
   * Ask about each hand match. Resolves { [incomingId]: action } after the last answer, or
   * null if the prompt is closed or cancelled at any point (the caller then writes nothing).
   */
  function askHandMatches(matches, incomingList, opts = {}) {
    const done = opts.done || 0; // answered earlier in this same merge: "N of M" continues
    return new Promise((resolve) => {
      const list = load();
      const inc = incomingList.map(normalize);
      const answers = {};
      let i = 0;
      const prevFocus = document.activeElement;
      const modal = F("tt-match-modal");
      const panel = F("tt-match-panel");
      F("tt-match-title").textContent = MATCH_COPY.title;
      F("tt-match-lede").textContent = MATCH_COPY.lede;
      F("tt-match-keep").textContent = MATCH_COPY.keep;
      F("tt-match-update").textContent = MATCH_COPY.update;
      F("tt-match-skip").textContent = MATCH_COPY.skip;
      F("tt-match-rest").textContent = MATCH_COPY.rest;
      F("tt-match-late").textContent = MATCH_COPY.late;
      F("tt-match-late").hidden = !opts.late; // only on matches re-asked after the commit-time re-check
      F("tt-match-close").setAttribute("aria-label", MATCH_COPY.close);
      const show = () => {
        const m = matches[i];
        const a = m.existing, b = m.incoming;
        const ta = Date.parse(a.dateUpdated), tb = Date.parse(b.dateUpdated);
        F("tt-match-progress").textContent = MATCH_COPY.progress(done + i + 1, done + matches.length);
        F("tt-match-progress").hidden = done + matches.length < 2; // "N of M" only from 2 matches up
        F("tt-match-pair").innerHTML =
          matchSide(a, b, list, inc, MATCH_COPY.here, ta > tb) + matchSide(b, a, inc, list, MATCH_COPY.backup, tb > ta);
        F("tt-match-rest").hidden = matches.length - i < 2;
        F("tt-match-keep").focus();
      };
      const finish = (result) => {
        modal.hidden = true;
        modal.setAttribute("aria-hidden", "true");
        releaseModalOpen();
        cleanup();
        try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch {}
        resolve(result);
      };
      const answer = (action) => {
        answers[matches[i].incomingId] = action;
        i += 1;
        if (i >= matches.length) finish(answers);
        else show();
      };
      const onClick = (ev) => {
        const t = ev.target.closest("button, .modal-backdrop");
        if (!t) return;
        if (t.dataset.ttMatchCancel) return finish(null);
        if (t.id === "tt-match-keep") answer(HAND_MATCH.KEEP_BOTH);
        else if (t.id === "tt-match-update") answer(HAND_MATCH.MERGE);
        else if (t.id === "tt-match-skip") answer(HAND_MATCH.SKIP);
        else if (t.id === "tt-match-rest") {
          for (; i < matches.length; i++) answers[matches[i].incomingId] = HAND_MATCH.KEEP_BOTH;
          finish(answers);
        }
      };
      const onKey = (ev) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          finish(null);
        } else if (ev.key === "Tab") {
          const f = [...panel.querySelectorAll("button:not([hidden])")];
          const first = f[0], last = f[f.length - 1];
          if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
          else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
        }
      };
      const cleanup = () => {
        modal.removeEventListener("click", onClick);
        document.removeEventListener("keydown", onKey, true);
      };
      modal.addEventListener("click", onClick);
      document.addEventListener("keydown", onKey, true);
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("modal-open");
      show();
    });
  }

  function deleteEntry(id) {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    const n = isBase(e) ? expansionsOf(entries, e).length : 0;
    const go = () => {
      if (commit((list) => remove(list, id)) !== "committed") return;
      host.closeConfirm && host.closeConfirm();
      closeModal("tt-detail-modal");
      render();
      host.renderStats && host.renderStats();
    };
    const desc = n ? `Its ${n === 1 ? "expansion stays" : `${n} expansions stay`} in your library on ${n === 1 ? "its" : "their"} own. This cannot be undone.` : "This cannot be undone."; // Berean cleared
    if (host.confirm) host.confirm(`Delete “${e.title}”?`, desc, go, "Delete");
    else go();
  }

  function bind() {
    document.addEventListener("click", (ev) => {
      const t = ev.target.closest("[data-tt-open]");
      if (t && (t.closest("#tabletop-view") || t.closest("#tt-detail-modal"))) {
        ev.preventDefault();
        openDetail(t.dataset.ttOpen);
      }
    });
    $("#tabletop-list").addEventListener("keydown", (ev) => {
      if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches("article[data-tt-open]")) {
        ev.preventDefault();
        openDetail(ev.target.dataset.ttOpen);
      }
    });
    F("tt-empty-add").addEventListener("click", () => openForm(null));
    F("tt-subtype").addEventListener("change", syncExpansionRows);
    F("tt-form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      saveForm(null);
    });
    F("tt-dup-update").addEventListener("click", () => saveForm("update"));
    // Any edit after the duplicate prompt makes its answer stale: hide it; Save asks again.
    ["input", "change"].forEach((t) => F("tt-form").addEventListener(t, () => { if (pendingDup) clearDupPrompt(); }));
    F("tt-dup-add").addEventListener("click", () => saveForm("add"));
    document.querySelectorAll("[data-tt-close]").forEach((b) => b.addEventListener("click", () => closeModal(b.dataset.ttClose)));
    F("tt-detail-edit").addEventListener("click", (ev) => openForm(entries.find((e) => e.id === ev.currentTarget.dataset.id)));
    F("tt-detail-delete").addEventListener("click", (ev) => deleteEntry(ev.currentTarget.dataset.id));
    document.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") return;
      if (!F("tt-form-modal").hidden) closeModal("tt-form-modal");
      else if (!F("tt-detail-modal").hidden) closeModal("tt-detail-modal");
    });
    window.addEventListener("storage", (ev) => {
      if (ev.key === STORE_KEY || ev.key === null) {
        load();
        if (active) render();
        host.renderStats && host.renderStats();
      }
    });
  }

  root.FRMTabletop = {
    ...core,
    init(h) {
      host = h || {};
      load();
      bind();
      setupTitleLookup();
      setupBarcodeLookup();
      setupBggIdLookup();
      setupBggFooter();
    },
    show,
    render,
    isActive: () => active,
    openAdd: () => openForm(null),
    /** v45: the media Add sheet's Type "Tabletop game" swaps to this sheet in place, carrying
     *  Title and Barcode. `returnTo` gets focus back when this sheet closes (the media sheet's opener). */
    openAddFrom({ title = "", barcode = "" } = {}, returnTo) {
      if (returnTo) returnFocus = returnTo;
      openForm(null, { title });
      F("tt-barcode").value = barcode;
    },
    count: () => load().length,
    askHandMatches,
    /** Hand matches a merge of `incoming` would raise, without writing anything. */
    previewHandMatches(incoming) {
      const list = load();
      const r = mergeRestore(list, incoming, { onHandMatch: () => HAND_MATCH.SKIP });
      const byId = new Map(incoming.map((e) => [e.id, normalize(e)]));
      return r.handMatches.map((m) => ({ ...m, existing: list.find((e) => e.id === m.existingId), incoming: byId.get(m.incomingId) }));
    },
    entries: () => load().slice(),
    backupBlock: () => ({ v: 1, entries: load().map((e) => ({ ...e })) }),
    clearSeeds: () => { load(); const next = entries.filter((e) => !e.seed); if (next.length === entries.length) return false; entries = next; save(entries); render(); return true; },
    seedSampleIfEmpty: (entry) => { load(); if (entries.some((e) => e.seed) || entries.length) return false; const e = normalize({ ...entry, seed: true }); entries = [e]; save(entries); render(); return true; },
    hasSeed: () => { load(); return entries.some((e) => e.seed); },
    /** Restore: "replace" swaps the tabletop shelf, "merge" folds in by id / BGG id. */
    restore(incoming, mode, opts) {
      let res = { added: Array.isArray(incoming) ? incoming.length : 0, updated: 0, handMatches: [] };
      let ok = false;
      try {
        ok = "committed" === commit((list) => {
          if (mode === "replace") return mergeRestore([], incoming).list;
          res = mergeRestore(list, incoming, opts);
          return res.list;
        });
      } catch { ok = false; } // malformed input: nothing written
      if (!ok) return null;
      // The write is committed; a display failure afterwards must not turn it into "not restored".
      try { if (active) render(); } catch { return { ...res, renderFailed: true }; }
      return res;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
