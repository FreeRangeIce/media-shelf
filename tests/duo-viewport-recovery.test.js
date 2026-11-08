// Deterministic unit tests of the actual app page-pin closure. No browser/network/device.
// APP_SOURCE can point at an unchanged release for a known-bad control.
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync(process.env.APP_SOURCE || "app.js", "utf8");
const start = source.indexOf("  (function pinPageUnderSheets() {");
const end = source.indexOf("  const OMDB_KEY_STORAGE", start);
if (start < 0 || end < 0) throw new Error("page-pin closure boundaries missing");
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
function setup({ height = 720, width = 1024, y = 430, withViewport = true } = {}) {
  const events = () => ({ listeners: {}, addEventListener(n, cb) { (this.listeners[n] ||= []).push(cb); }, emit(n) { for (const cb of this.listeners[n] || []) cb(); } });
  const vars = new Map(), frames = new Map();
  let serial = 0, observer, open = false;
  const vv = Object.assign(events(), { height, width, scale: 1, offsetTop: 0, offsetLeft: 0 });
  const win = Object.assign(events(), { scrollY: y, scrollX: 0, visualViewport: withViewport ? vv : null, calls: [], scrollTo(x, y) { this.calls.push([x, y]); this.scrollX = x; this.scrollY = y; } });
  const style = { setProperty(n, v) { vars.set(n, v); }, removeProperty(n) { vars.delete(n); } };
  Object.defineProperty(style, "position", { get() { return this._position || ""; }, set(v) { this._position = v; if (v === "fixed") win.scrollY = 0; } });
  const body = Object.assign(events(), { style, classList: { contains: () => open } });
  vm.runInNewContext(source.slice(start, end), {
    window: win, document: { body },
    MutationObserver: class { constructor(cb) { observer = cb; } observe() {} },
    requestAnimationFrame(cb) { const id = ++serial; frames.set(id, cb); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  function flush() { let n = 0; while (frames.size) { if (++n > 10) throw new Error("unbounded animation-frame loop"); const batch = [...frames.values()]; frames.clear(); batch.forEach(cb => cb()); } }
  return { vv, win, body, vars, frames, flush,
    open() { open = true; observer(); flush(); }, close() { open = false; observer(); flush(); },
    change(values, event = "resize") { Object.assign(vv, values); vv.emit(event); flush(); },
    nested() { observer(); flush(); }
  };
}
{
  const s = setup(); s.open();
  check("pin captures original scroll without changing its negative top", s.body.style.position === "fixed" && s.body.style.top === "-430px");
  check("host receives measured full visual-viewport height", s.vars.get("--sheet-vv-height") === "720px");
  s.change({ height: 400 });
  check("keyboard shrink updates measured height", s.vars.get("--sheet-vv-height") === "400px");
  for (const h of [430, 460, 490, 520, 550, 580, 610, 640, 670, 700, 720]) s.change({ height: h });
  const before = s.win.calls.length;
  s.change({ offsetTop: 90 }, "scroll");
  check("gradual cumulative dismissal recovers a delayed offset scroll", s.win.calls.length === before + 1 && s.win.calls.at(-1)[1] === 0);
  check("offset bounds cover the independently reported visible bottom", s.vars.get("--sheet-vv-top") === "90px" && Number.parseFloat(s.vars.get("--sheet-vv-top")) + Number.parseFloat(s.vars.get("--sheet-vv-height")) === 810);
  check("reconciliation preserves saved body.top and pin", s.body.style.top === "-430px" && s.body.style.position === "fixed");
  const noLoop = s.win.calls.length;
  s.vv.emit("scroll"); s.flush();
  check("unchanged offset does not cause repeated scroll corrections", s.win.calls.length === noLoop);
  s.change({ offsetTop: 0 }, "scroll");
  check("late offset reset updates visible bounds", s.vars.get("--sheet-vv-top") === "0px");
  s.change({ height: 690, offsetTop: 25 });
  check("next keyboard opening disarms previous recovery", s.win.calls.length === noLoop);
  s.nested();
  check("nested sheet keeps original scroll pin", s.body.style.top === "-430px");
  s.close();
  check("last sheet close restores original page scroll", s.win.scrollY === 430 && s.body.style.position === "" && s.body.style.top === "");
  check("last close removes viewport overrides", s.vars.size === 0);
  const n = s.win.calls.length;
  s.change({ height: 1000, offsetTop: 90 }, "scroll");
  check("closed sheets do not respond to viewport changes", s.vars.size === 0 && s.win.calls.length === n);
}
{
  const s = setup(); s.open(); s.change({ height: 400 });
  const before = s.win.calls.length;
  // Many browser events can coalesce into a single rendered frame.
  for (const h of [430, 460, 490, 520, 550, 580, 610, 640, 670, 700, 720]) { s.vv.height = h; s.vv.offsetTop = 90; s.vv.emit("resize"); }
  s.flush();
  check("coalesced dismissal corrects offset once", s.win.calls.length === before + 1);
  s.vv.offsetTop = 0; s.win.scrollY = 90; s.body.emit("focusout"); s.flush();
  check("focusout catches late page-scroll drift", s.win.scrollY === 0);
  s.close();
}
{
  const s = setup(); s.open(); s.change({ height: 400 });
  const before = s.win.calls.length;
  s.change({ height: 720, width: 512, scale: 2, offsetTop: 90, offsetLeft: 40 });
  check("pinch zoom clears measured overrides rather than resizing the native viewport", s.vars.size === 0);
  check("pinch zoom does not force viewport scrolling", s.win.calls.length === before);
  s.change({ scale: 1, width: 1024, offsetTop: 0, offsetLeft: 0 });
  check("returning to scale one restores measured bounds", s.vars.get("--sheet-vv-width") === "1024px");
  check("zoom never rewrites saved scroll position", s.body.style.top === "-430px");
  s.close(); check("scroll restoration survives zoom", s.win.scrollY === 430);
}
{
  const s = setup(); s.open(); s.change({ height: 400 });
  const before = s.win.calls.length;
  s.change({ width: 720, height: 1024, offsetTop: 0 });
  check("orientation width change resets keyboard recovery", s.win.calls.length === before && s.vars.get("--sheet-vv-width") === "720px");
  s.close();
}
{
  const s = setup({ withViewport: false }); s.open();
  check("without visualViewport page pin remains available", s.body.style.position === "fixed" && s.vars.size === 0);
  s.close(); check("without visualViewport scroll restores", s.win.scrollY === 430);
}
{
  const s = setup(); s.open(); s.vv.emit("resize"); s.close();
  check("closing cancels pending viewport work", s.frames.size === 0 && s.vars.size === 0);
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exitCode = fail ? 1 : 0;
