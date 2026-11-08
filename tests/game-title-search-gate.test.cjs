// Pure Node test of the actual UI visibility function; no browser/network.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(process.env.GAME_APP_SOURCE||path.join(__dirname,'../app.js'),'utf8');
const flag=src.match(/const GAME_TITLE_SEARCH_TESTED = (true|false);/);if(!flag)throw Error('Missing independent title-search switch');
const source=src.match(/  function updateReferenceLinks\(\) \{[\s\S]*?\n  \}/)[0];
let pass=0,fail=0;const ck=(n,ok)=>{console.log((ok?'PASS ':'FAIL ')+n);ok?pass++:fail++};
ck('title search independent switch on (local candidate)',flag[1]==='true');
for(const type of ['game','movie','book'])for(const relay of ['', 'https://review.invalid/mock']){
 const button={hidden:false},c={$:()=>button,els:{fieldType:{value:type},fieldTitle:{value:'Example'},fieldYear:{value:'2020'}},GAME_TITLE_SEARCH_TESTED:flag[1]==='true',gameRelayUrl:()=>relay,buildImdbUrl:()=>'',buildIsfdbUrl:()=>'',buildIgdbUrl:()=>'',setRefLink:()=>{}};
 vm.createContext(c);vm.runInContext(source+';updateReferenceLinks();',c);{const show=type==='game'&&relay&&flag[1]==='true';ck(type+' button '+(show?'shown':'hidden')+' with '+(relay?'configured':'empty')+' relay',button.hidden===!show);}
 if(type==='game'&&relay){c.GAME_TITLE_SEARCH_TESTED=true;vm.runInContext('updateReferenceLinks()',c);ck('future separate switch can enable title search only deliberately',button.hidden===false);}
}
console.log(`${pass}/${pass+fail} passed`);process.exitCode=fail?1:0;
