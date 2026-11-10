// Pure Node: real pin closure with explicit layout/visual geometry; no browser or network.
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(process.env.APP_SOURCE || 'app.js', 'utf8');
const css = fs.readFileSync(process.env.CSS_SOURCE || 'styles.css', 'utf8');
const a = source.indexOf('  (function pinPageUnderSheets() {'), b = source.indexOf('  const OMDB_KEY_STORAGE', a);
if (a < 0 || b < 0) throw Error('Missing real pin closure');
let pass = 0, fail = 0;
const ck = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); ok ? pass++ : fail++; };
function setup({ width = 1024, height = 720, y = 430, withViewport = true } = {}) {
  const event = () => ({ listeners: {}, addEventListener(n, f) { (this.listeners[n] ||= []).push(f); }, emit(n) { (this.listeners[n] || []).forEach(f => f()); } });
  const vars = new Map(), frames = new Map(); let observer, serial = 0, open = false;
  const style = { setProperty(k,v) { vars.set(k,v); }, removeProperty(k) { vars.delete(k); } };
  const vv = Object.assign(event(), { width, height, offsetTop: 0, offsetLeft: 0, scale: 1 });
  const win = Object.assign(event(), { visualViewport: withViewport ? vv : null, innerHeight: height, innerWidth: width, scrollX: 0, scrollY: y, calls: [], scrollTo(x,y) { this.scrollX=x; this.scrollY=y; this.calls.push([x,y]); } });
  Object.defineProperty(style,'position',{get(){return this.p||''},set(v){this.p=v;if(v==='fixed')win.scrollY=0;}});
  const body=Object.assign(event(),{style,classList:{contains:()=>open}});
  const bar={top:620,bottom:720}; let nested=false, fieldTop=350;
  win.getComputedStyle=()=>({height:bar.fadeHeight || "24px"});
  const panel={scrollTop:0, getBoundingClientRect:()=>({top:16,bottom:height-16}), querySelector:()=>({getBoundingClientRect:()=>bar})};
  const field={matches:()=>true,closest:()=>panel,getBoundingClientRect:()=>({top:fieldTop-panel.scrollTop,bottom:fieldTop-panel.scrollTop+44,height:44})};
  const doc={body,documentElement:{clientHeight:height,clientWidth:width},activeElement:field,querySelector:()=>nested?{}:null};
  vm.runInNewContext(source.slice(a,b),{window:win,document:doc,MutationObserver:class{constructor(f){observer=f;}observe(){}},requestAnimationFrame(f){const id=++serial;frames.set(id,f);return id;},cancelAnimationFrame(id){frames.delete(id);}});
  function flush(){let n=0;while(frames.size){if(++n>10)throw Error('Unbounded viewport work');const batch=[...frames.values()];frames.clear();batch.forEach(f=>f());}}
  return {vars,vv,win,body,panel,doc,bar,field,frames,
    open(){open=true;observer();flush();},close(){open=false;observer();flush();},
    change(values,n='resize'){Object.assign(vv,values);vv.emit(n);flush();},
    focus(top){fieldTop=top;body.emit('focusin');flush();},nested(value){nested=value;observer();flush();},
    number(k){return parseFloat(vars.get(k));}
  };
}
for (const [width,height,small] of [[390,844,300],[1024,720,220],[1000,420,160]]) {
  const s=setup({width,height});s.open();const pinned=s.body.style.top;
  s.change({height:small});
  ck(`${width}: Add retains pre-keyboard layout canvas`,s.number('--add-sheet-height')===height);
  ck(`${width}: other dialogs still receive reduced visual height`,s.number('--sheet-vv-height')===small);
  ck(`${width}: cover spans layout canvas behind keyboard/accessory`,s.number('--sheet-cover-height')>=height);
  const r=s.field.getBoundingClientRect();
  ck(`${width}: focused Title scrolled into unobscured region`,r.top>=24&&r.bottom<=small-8);
  ck(`${width}: focus correction scrolls only panel, not page`,s.panel.scrollTop>0&&s.win.calls.length===0);
  ck(`${width}: stable body pin is preserved`,s.body.style.top===pinned&&s.body.style.position==='fixed');
  // A partial rise is not proof of dismissal, even if >80px cumulatively.
  const calls=s.win.calls.length;s.change({height:small+100,offsetTop:90});
  ck(`${width}: partial keyboard recovery does not reset page scroll`,s.win.calls.length===calls);
  s.change({height,offsetTop:90});
  ck(`${width}: true height recovery can clear delayed page pan`,s.win.calls.length===calls+1);
  ck(`${width}: cover includes independently offset visible bottom`,s.number('--sheet-cover-height')>=height+90);
  s.change({height:height+90,offsetTop:0});s.change({height,offsetTop:0});
  ck(`${width}: transient visual-only expansion does not inflate Add canvas`,s.number('--add-sheet-height')===height);
  s.close();ck(`${width}: close restores original page scroll and all variables`,s.win.scrollY===430&&s.vars.size===0&&s.body.style.position==='');
}
{
  const s=setup();s.open();s.change({height:400,offsetTop:80,offsetLeft:30});
  ck('cover includes horizontal pan beyond layout edge',s.number('--sheet-cover-width')>=1054);
  s.panel.scrollTop=0;s.focus(450);let r=s.field.getBoundingClientRect();
  ck('focusin reveals a newly focused lower field after resize',r.top>=88&&r.bottom<=472);
  const top=s.panel.scrollTop;s.focus(450);
  ck('already visible focused field does not repeatedly scroll',s.panel.scrollTop===top);
  s.bar.top=280;s.bar.bottom=380;s.panel.scrollTop=0;s.focus(350);r=s.field.getBoundingClientRect();
  ck('visible sticky footer and fade are excluded from focus area',r.bottom<=248);
  s.bar.fadeHeight='48px';s.panel.scrollTop=0;s.focus(350);r=s.field.getBoundingClientRect();
  ck('larger-text fade is measured rather than assumed 24px',r.bottom<=224);
  s.bar.fadeHeight='24px';
  s.nested(true);const before=s.panel.scrollTop;s.focus(600);
  ck('nested dialog does not scroll underlying Add fields',s.panel.scrollTop===before);
  ck('nested dialog does not unpin original page',s.body.style.top==='-430px');
  s.nested(false);s.change({scale:2,width:512,height:360});const pos=s.panel.scrollTop;s.focus(700);
  ck('zoom removes explicit geometry and avoids forced panel scrolling',s.vars.size===0&&s.panel.scrollTop===pos);
  s.change({scale:1,width:1024,height:720,offsetTop:0,offsetLeft:0});
  ck('return from zoom restores stable layout bounds',s.number('--add-sheet-height')===720);
  s.win.innerHeight=1024;s.win.innerWidth=720;s.doc.documentElement.clientHeight=1024;s.doc.documentElement.clientWidth=720;
  s.change({width:720,height:1024});
  ck('orientation takes a fresh layout baseline',s.number('--add-sheet-height')===1024);
  s.close();s.change({height:900});ck('closed sheet ignores viewport and focus work',s.vars.size===0&&s.win.scrollY===430);
}
{
  const s=setup({withViewport:false});s.open();s.focus(900);ck('without visualViewport native layout/pin remains untouched',s.vars.size===0&&s.panel.scrollTop===0&&s.body.style.position==='fixed');s.close();ck('without visualViewport close restores scroll',s.win.scrollY===430);
}
ck('Add host has independent stable height and zero origin',/body\.modal-open #modal\s*\{[^}]*top:\s*0;[^}]*height:\s*var\(--add-sheet-height,/s.test(css));
ck('backdrop covers full canvas instead of shared vv height',/body\.modal-open \.modal-backdrop\s*\{[^}]*inset:\s*0;[^}]*height:\s*auto;[^}]*min-height:\s*var\(--sheet-cover-height,/s.test(css));
const capRules=[...css.matchAll(/#modal > \.modal-panel\s*\{([^}]+)\}/g)].map(m=>m[1]).filter(s=>s.includes('max-height:'));
ck('both Add caps use stable canvas, not keyboard-sized dvh',capRules.length===2&&capRules.every(s=>s.includes('--add-sheet-height')&&!s.includes('--sheet-vv-height')&&!s.includes('dvh')));
ck('Add-only separator is transparent and existing fade retained',/#modal \.item-form \.form-actions\s*\{\s*border-top-color:\s*transparent;/.test(css)&&/\.item-form \.form-actions::before\s*\{[^}]*linear-gradient/s.test(css));
ck('other modal visual-viewport sizing remains available',css.includes('height: var(--sheet-vv-height, 100%);')&&css.includes('calc(var(--sheet-vv-height, 100dvh) - var(--sheet-gap))'));
const cssDelta = require('node:child_process').execFileSync('git', ['diff', '65dee85', '--', 'styles.css'], { encoding: 'utf8' });
ck('no scrollbar or caret suppression introduced', !/^\+[^+].*(?:scrollbar-width\s*:\s*none|caret-color\s*:\s*transparent|::-webkit-scrollbar)/m.test(cssDelta));
ck('missing barcode guidance keeps copy but becomes neutral',source.includes('setLookupStatus("Enter a barcode to look up this copy. Title is needed only when you save.", "note")'));
ck('title search independent switch present (on in local candidate)',source.includes('const GAME_TITLE_SEARCH_TESTED = true;'));
ck('V2.6 release and relay origin unchanged',source.includes('const APP_VERSION = "2.6";')&&source.includes('const GAME_RELAY_URL = "https://media-shelf-games.freerangeice.workers.dev";'));
// Execute the actual early game-lookup branch: a typed title is not a barcode error.
{
  const begin=source.indexOf('  async function runGameLookup(byTitle) {');
  const end=source.indexOf('  async function runLookup()',begin);let status,requests=0;
  const els={fieldType:{value:'game'},fieldBarcode:{value:''},fieldTitle:{value:'Hades'}};
  const c={els,gameBusy:false,lookupBusy:false,gameSeq:0,GAME_TITLE_SEARCH_TESTED:false,resetGameLookup(){},gameRelayUrl:()=> 'https://media-shelf-games.freerangeice.workers.dev',usableGameTitle:s=>s,setLookupStatus:(msg,kind)=>{status={msg,kind}},fetch(){requests++;throw Error('No provider request allowed')}};
  vm.createContext(c);vm.runInContext(source.slice(begin,end),c);c.runGameLookup(false);
  ck('typed-title/no-barcode Lookup uses neutral existing helper copy',status?.kind==='note'&&status.msg==='Enter a barcode to look up this copy. Title is needed only when you save.');
  ck('helper branch sends no request and preserves typed Title',requests===0&&els.fieldTitle.value==='Hades');
}
console.log(`${pass}/${pass+fail} passed`);process.exitCode=fail?1:0;
