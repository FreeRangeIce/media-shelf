// Pure Node: executes the application's actual transaction functions, no browser/network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.GAME_APP_SOURCE || require('node:path').join(__dirname, '../app.js'), 'utf8');
const start = source.indexOf('  function applyLookupFields('), end = source.indexOf('  const COVER_SOURCE_LABELS', start);
assert(start > 0 && end > start);
let pass = 0, fail = 0;
const ck = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); ok ? pass++ : fail++; };
function form(existing = {}) {
  const field = value => ({value: String(value ?? '')});
  const id = field(existing.igdbId);
  const els = {fieldType: field('game'), fieldTitle: field(existing.title), fieldCreator: field(existing.creator), fieldYear: field(existing.year), fieldCover: field(existing.coverUrl), fieldCoverSource: field(existing.coverSource), fieldCoverSourceId: field(existing.coverSourceId), fieldCoverPlatform: field(''), fieldBarcode: field('')};
  let confirm = null, status = '';
  const ctx = {els, $: selector => {assert.equal(selector, '#field-igdb-id');return id;}, updateCoverPreview(){},updateGoogleBooksAttr(){},SIGNED_TYPES:new Set(),showCoverChoices(){},checkDuplicateFromForm(){},setLookupStatus(s){status=s;},openConfirm(title, description, accept){confirm={title,description,accept};},closeConfirm(){confirm=null;}};
  vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
  return {ctx,els,id,get confirm(){return confirm;},get status(){return status;}};
}
const candidate = {igdbId:'42',title:'Hades',creator:'Supergiant',year:2020,coverUrl:'https://images.igdb.com/igdb/image/upload/t_cover_big/co42.jpg',coverSource:'igdb',coverSourceId:'42'};
for (const previousId of ['', '19']) {
  const f=form({igdbId:previousId,title:'Legacy game',coverUrl:'https://legacy.invalid/rawg.jpg',coverSource:'rawg'});
  f.ctx.commitLookup(candidate);
  ck(`conflicting match opens Overwrite (old ID ${previousId || 'unset'})`, !!f.confirm);
  ck('ID unchanged before acceptance',f.id.value===previousId);
  ck('title and cover unchanged before acceptance',f.els.fieldTitle.value==='Legacy game'&&f.els.fieldCover.value==='https://legacy.invalid/rawg.jpg');
  ck('empty creator/year also remain unchanged before acceptance',f.els.fieldCreator.value===''&&f.els.fieldYear.value==='');
  f.ctx.closeConfirm(); // Cancel closes the same confirmation, never invokes accept.
  ck('Cancel leaves ID unchanged for a subsequent Save',f.id.value===previousId);
  ck('Cancel leaves cover provenance unchanged',f.els.fieldCoverSource.value==='rawg');
  f.ctx.commitLookup(candidate);f.confirm.accept();
  ck('accepted overwrite adopts selected ID/title/cover together',f.id.value==='42'&&f.els.fieldTitle.value==='Hades'&&f.els.fieldCover.value===candidate.coverUrl&&f.els.fieldCoverSourceId.value==='42');
}
{
  const f=form();f.ctx.commitLookup(candidate);
  ck('nonconflicting explicit selection applies record',!f.confirm&&f.id.value==='42'&&f.els.fieldTitle.value==='Hades');
}
{
  const f=form({...candidate,igdbId:'19'});f.ctx.commitLookup(candidate);
  ck('different existing ID alone requires overwrite',!!f.confirm&&f.id.value==='19');
  ck('overwrite text names the IGDB link',f.confirm?.description.includes('IGDB link'));
}
{
  const f=form({title:'Typed title'});f.ctx.commitLookup({title:'Other title',creator:'Existing generic behavior'});
  ck('non-IGDB lookup retains existing empty-field behavior',!!f.confirm&&f.els.fieldCreator.value==='Existing generic behavior'&&f.els.fieldTitle.value==='Typed title');
}
console.log(`${pass}/${pass+fail} passed`);process.exitCode=fail?1:0;
