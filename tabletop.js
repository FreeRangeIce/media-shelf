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
 * Lookup: BoardGameGeek lookup is NOT connected. No network call is ever made from here;
 * the Lookup button only says so (LOOKUP_RELAY_URL is empty). See relay/tabletop-worker.js.
 */
(function (root) {
  "use strict";

  const STORE_KEY = "media-tracker-v1:tabletop";
  /** Relay endpoint for BGG / GameUPC lookups. Empty = not connected (no network calls). */
  const LOOKUP_RELAY_URL = "";
  const LOOKUP_NOT_CONNECTED =
    "BoardGameGeek lookup isn’t connected yet. Fill in the details by hand; you can add a BGG id later."; // Berean cleared
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
      dateAdded: str(r.dateAdded) || nowIso(),
      dateUpdated: str(r.dateUpdated) || str(r.dateAdded) || nowIso(),
    };
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
    KEEP_FIELDS.forEach((k) => {
      const v = ["bggId", "year", "parentBggId"].includes(k) ? bggNum(incoming[k]) : str(incoming[k]);
      if (v) out[k] = v;
    });
    if (SUBTYPES.includes(incoming.subtype)) out.subtype = incoming.subtype;
    if (STATUSES.includes(incoming.status)) out.status = incoming.status;
    if (incoming.bggIsExpansion === true) out.bggIsExpansion = true;
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
          ? (m, inc) => answers[inc.id] || HAND_MATCH.SKIP
          : defaultHandMatch;
    const out = current.map((e) => ({ ...e }));
    const here = out.slice(); // only entries already on this device can be a hand match
    const remap = new Map();
    const handMatches = [];
    let added = 0;
    let updated = 0;
    incoming.map(normalize).forEach((inc) => {
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
      if (Date.parse(inc.dateUpdated) > Date.parse(out[i].dateUpdated)) {
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
    return block.entries.filter((r) => r && typeof r === "object" && r.title).map(normalize);
  }

  const core = { STORE_KEY, SUBTYPES, normalize, resolveParent, groupShelf, expansionsOf, findDuplicate, mergeUpdate, linkBggId, upsert, remove, applyBarcodeMiss, mergeRestore, HAND_MATCH, carryExpansions, parseBackupBlock, lookupConnected: () => Boolean(LOOKUP_RELAY_URL), LOOKUP_NOT_CONNECTED };
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
  function commit(mutate) {
    load(); // another tab may have written since we last read
    const next = mutate(entries.slice());
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
      entries = next;
      return true;
    } catch {
      host.toast && host.toast("Couldn’t save — storage may be full");
      return false;
    }
  }

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
    return `<li class="tt-group">
  <article class="item-card tt-card" tabindex="0" role="button" data-tt-open="${esc(e.id)}" aria-label="${esc(`Open ${e.title}`)}">
    ${cover(e)}
    <div class="item-body"><div class="item-top"><div>
      ${lone ? `<p class="tt-kicker">Expansion</p>` : ""}
      <h3 class="item-title">${esc(e.title)}</h3>
      ${lone ? metaLine(e) : `<p class="item-meta">${esc(meta(e))}</p>`}
      ${exps.length ? `<p class="tt-exp-count">${exps.length} ${exps.length === 1 ? "expansion" : "expansions"}</p>` : ""}
    </div>
    <div class="item-badges">${lone ? "" : subtypeBadge(e)}${statusBadge(e)}</div></div></div>
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

  function openModal(id) {
    const m = F(id);
    returnFocus = returnFocus || document.activeElement;
    m.hidden = false;
    m.setAttribute("aria-hidden", "false");
  }
  function closeModal(id) {
    const m = F(id);
    m.hidden = true;
    m.setAttribute("aria-hidden", "true");
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
    // Lookup isn't connected: the control stays focusable (aria-disabled, not disabled) and
    // is described by the helper line, which also shows when it's pressed.
    F("tt-lookup-status").textContent = LOOKUP_NOT_CONNECTED;
    F("tt-lookup-status").hidden = true;
    F("tt-dup").hidden = true;
    F("tt-title-error").hidden = true;
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
      year: v("year"),
      designer: v("designer"),
      players: v("players"),
      playTime: v("playTime"),
      coverUrl: v("coverUrl"),
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
    const ok = commit((list) => {
      if (mode === "update" && pendingDup) {
        const merged = mergeUpdate(list.find((e) => e.id === pendingDup.match.id) || pendingDup.match, data);
        savedId = merged.id;
        return upsert(list, merged);
      }
      const e = normalize({ ...data, id: data.id || newId(), dateAdded: data.dateAdded || nowIso() });
      savedId = e.id;
      return upsert(list, e);
    });
    if (!ok) return;
    closeModal("tt-form-modal");
    render();
    host.renderStats && host.renderStats();
    host.toast && host.toast(mode === "update" ? "Updated" : "Saved");
  }

  /* ----- detail ----- */
  function openDetail(id) {
    load();
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    F("tt-detail-title").textContent = e.title;
    const rows = [];
    rows.push(`<div class="tt-detail-badges">${subtypeBadge(e)}${statusBadge(e)}</div>`);
    const ml = metaLine(e);
    if (ml) rows.push(ml);
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
  function askHandMatches(matches, incomingList) {
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
      F("tt-match-close").setAttribute("aria-label", MATCH_COPY.close);
      const show = () => {
        const m = matches[i];
        const a = m.existing, b = m.incoming;
        const ta = Date.parse(a.dateUpdated), tb = Date.parse(b.dateUpdated);
        F("tt-match-progress").textContent = MATCH_COPY.progress(i + 1, matches.length);
        F("tt-match-pair").innerHTML =
          matchSide(a, b, list, inc, MATCH_COPY.here, ta > tb) + matchSide(b, a, inc, list, MATCH_COPY.backup, tb > ta);
        F("tt-match-rest").hidden = matches.length - i < 2;
        F("tt-match-keep").focus();
      };
      const finish = (result) => {
        modal.hidden = true;
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("modal-open");
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
      if (!commit((list) => remove(list, id))) return;
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
    F("tt-dup-add").addEventListener("click", () => saveForm("add"));
    F("tt-lookup").addEventListener("click", () => {
      // Never a network call while LOOKUP_RELAY_URL is empty.
      const s = F("tt-lookup-status");
      s.textContent = LOOKUP_NOT_CONNECTED;
      s.hidden = false;
    });
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
    },
    show,
    render,
    isActive: () => active,
    openAdd: () => openForm(null),
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
    /** Restore: "replace" swaps the tabletop shelf, "merge" folds in by id / BGG id. */
    restore(incoming, mode, opts) {
      let res = { added: incoming.length, updated: 0, handMatches: [] };
      const ok = commit((list) => {
        if (mode === "replace") return mergeRestore([], incoming).list;
        res = mergeRestore(list, incoming, opts);
        return res.list;
      });
      if (active) render();
      return ok ? res : null;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
