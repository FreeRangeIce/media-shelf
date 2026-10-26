// node tests/tabletop-core.test.js — pure data rules of the Tabletop tab (no browser, no deps).
const assert = require("assert");
const T = require("../tabletop.js");
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("PASS  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "  — " + e.message); }
}
const at = (n) => `2026-10-0${n}T10:00:00.000Z`;
const base = (o) => T.normalize({ title: "Wingspan", subtype: "board", bggId: "266192", dateUpdated: at(1), ...o });
const exp = (o) => T.normalize({ title: "European Expansion", subtype: "expansion", parentBggId: "266192", dateUpdated: at(1), ...o });
const under = (list, b) => T.groupShelf(list).find((g) => g.entry.id === b.id).expansions.map((e) => e.id);

t("new entry defaults to Owned", () => assert.strictEqual(T.normalize({ title: "X" }).status, "owned"));
t("Want is kept", () => assert.strictEqual(T.normalize({ title: "X", status: "want" }).status, "want"));
t("unknown status/subtype fall back to Owned/Board", () => {
  const e = T.normalize({ title: "X", status: "done", subtype: "videogame" });
  assert.deepStrictEqual([e.status, e.subtype], ["owned", "board"]);
});
t("expansion with missing parent saves and stands alone", () => {
  const list = T.upsert([], exp({ id: "e1", parentBggId: "" }));
  assert.strictEqual(list.length, 1);
  const g = T.groupShelf(list);
  assert.strictEqual(g.length, 1); assert.strictEqual(g[0].entry.id, "e1");
});
t("expansion keeps base BGG id with no parent picked", () => {
  const list = T.upsert([], exp({ id: "e1" }));
  assert.strictEqual(list[0].parentBggId, "266192"); assert.strictEqual(list[0].parentId, "");
});
t("parent added later pulls its expansions under it (by BGG id)", () => {
  let list = T.upsert([], exp({ id: "e1" }));
  list = T.upsert(list, exp({ id: "e2", title: "Oceania", status: "want" }));
  list = T.upsert(list, base({ id: "b1" }));
  assert.deepStrictEqual(under(list, list.find((e) => e.id === "b1")).sort(), ["e1", "e2"]);
  assert.strictEqual(T.groupShelf(list).length, 1);
});
t("local-id link when either side has no BGG id", () => {
  let list = T.upsert([], base({ id: "b1", bggId: "" }));
  list = T.upsert(list, exp({ id: "e1", parentBggId: "", parentId: "b1" }));
  assert.deepStrictEqual(under(list, list[0]), ["e1"]);
});
t("manual base later gets a BGG id: links rewritten to carry it", () => {
  let list = T.upsert([], base({ id: "b1", bggId: "" }));
  list = T.upsert(list, exp({ id: "e1", parentBggId: "", parentId: "b1" }));
  list = T.upsert(list, { ...list[0], bggId: "266192" });
  assert.strictEqual(list.find((e) => e.id === "e1").parentBggId, "266192");
});
t("deleting a base keeps its expansions, standing alone", () => {
  let list = T.upsert([], base({ id: "b1" }));
  list = T.upsert(list, exp({ id: "e1", parentId: "b1" }));
  list = T.remove(list, "b1");
  assert.strictEqual(list.length, 1);
  assert.strictEqual(T.resolveParent(list, list[0]), null);
  assert.strictEqual(list[0].parentBggId, "266192");
  list = T.upsert(list, base({ id: "b2" })); // re-added base relinks
  assert.deepStrictEqual(under(list, list.find((e) => e.id === "b2")), ["e1"]);
});
t("Want base with an Owned expansion (and the reverse) keep their own status", () => {
  let list = T.upsert([], base({ id: "b1", status: "want" }));
  list = T.upsert(list, exp({ id: "e1", status: "owned" }));
  const g = T.groupShelf(list)[0];
  assert.strictEqual(g.entry.status, "want"); assert.strictEqual(g.expansions[0].status, "owned");
});
t("duplicate by BGG id first", () => {
  const list = [base({ id: "b1", title: "Wingspan (2nd ed.)" }), base({ id: "b2", title: "Wingspan", bggId: "999" })];
  const d = T.findDuplicate(list, T.normalize({ title: "Wingspan", bggId: "266192" }));
  assert.strictEqual(d.by, "bgg"); assert.strictEqual(d.match.id, "b1");
});
t("duplicate by title when no BGG id; only offered (nothing merged)", () => {
  const list = [base({ id: "b1", bggId: "" })];
  const d = T.findDuplicate(list, T.normalize({ title: "  wingspan " }));
  assert.strictEqual(d.by, "title"); assert.strictEqual(list.length, 1); assert.strictEqual(list[0].title, "Wingspan");
});
t("same title, different BGG ids (another edition) is not a duplicate", () => {
  assert.strictEqual(T.findDuplicate([base({ id: "b1" })], T.normalize({ title: "Wingspan", bggId: "350933" })), null);
});
t("update keeps old values when incoming is empty or BGG 0", () => {
  const old = base({ id: "b1", designer: "Elizabeth Hargrave", year: "2019", players: "1–5" });
  const m = T.mergeUpdate(old, { title: "", designer: "", year: "0", players: "1–5", status: "want" });
  assert.deepStrictEqual([m.id, m.title, m.designer, m.year, m.status], ["b1", "Wingspan", "Elizabeth Hargrave", "2019", "want"]);
});
t("barcode miss keeps the code and falls back to name search", () => {
  const r = T.applyBarcodeMiss(T.normalize({ title: "" }), "0850000000017");
  assert.strictEqual(r.entry.barcode, "0850000000017"); assert.strictEqual(r.next, "name-search");
});
t("old backup with no tabletop block → null (shelf untouched)", () => {
  assert.strictEqual(T.parseBackupBlock({ app: "freerangemedia", version: 3, items: [] }), null);
  assert.strictEqual(T.parseBackupBlock([{ title: "x" }]), null);
});
t("backup round-trip keeps entries and links", () => {
  let list = T.upsert([], base({ id: "b1" }));
  list = T.upsert(list, exp({ id: "e1", parentId: "b1" }));
  const back = T.parseBackupBlock(JSON.parse(JSON.stringify({ tabletop: { v: 1, entries: list } })));
  assert.deepStrictEqual(back, list);
});
t("restore on another device: matched by BGG id, links remapped", () => {
  const device = T.upsert([], base({ id: "local-b", dateUpdated: at(1) }));
  let backup = T.upsert([], base({ id: "other-b", dateUpdated: at(2) }));
  backup = T.upsert(backup, exp({ id: "e1", parentId: "other-b" }));
  const r = T.mergeRestore(device, backup).list;
  assert.strictEqual(r.filter((e) => e.subtype === "board").length, 1);
  const b = r.find((e) => e.subtype === "board");
  assert.strictEqual(b.id, "local-b");
  assert.strictEqual(T.resolveParent(r, r.find((e) => e.id === "e1")), b);
});
t("restore on another device with manual links (no BGG ids) survives", () => {
  let backup = T.upsert([], base({ id: "b1", bggId: "", title: "Homebrew Game" }));
  backup = T.upsert(backup, exp({ id: "e1", parentBggId: "", parentId: "b1", title: "Homebrew Exp" }));
  const blk = T.parseBackupBlock(JSON.parse(JSON.stringify({ tabletop: { v: 1, entries: backup } })));
  const r = T.mergeRestore([], blk).list;
  assert.strictEqual(T.resolveParent(r, r.find((e) => e.id === "e1")).id, "b1");
});
t("Lookup not connected: no relay configured", () => {
  assert.strictEqual(T.lookupConnected(), false);
  assert.match(T.LOOKUP_NOT_CONNECTED, /BoardGameGeek lookup isn’t connected yet/);
});
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
