const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {formatTankMix,buildModel,renderReport}=require('./scouting-report.js');
const fields={features:[['a','Farm A','Field A'],['b','Farm B','Field B'],['c','Farm B','Field C']].map(([id,client,name])=>({properties:{FIELD_ID:id,CLIENT_NAM:client,FIELD_NAME:name}}))};
const session={id:'s',userId:'u',userName:'Scout',start:'2026-10-16T08:00:00',end:'2026-10-16T10:00:00',checkedFieldIds:['a','b','b'],allocationMethod:'equal-per-checked-field'};
const args={db:{sessions:[session],tasks:[],observations:[]},fields,from:'2026-10-16',to:'2026-10-16'};
test('named tank mix renders products, rates and readable units without metadata',()=>{
 const text=formatTankMix({tankMix:{id:'secret-id',name:'Roundup',deereTankMixId:'internal',solutionRate:7,solutionRateUnit:'gal1ac-1',components:[{product_name:'Roundup Powermax',rate:18,rate_unit:'floz1ac-1',id:'component-id'},{product_name:'Water',rate:6.8,rate_unit:'gal1ac-1'}]}});
 assert.equal(text,'Roundup — 7 gal/ac spray volume: Roundup Powermax 18 fl oz/ac + Water 6.8 gal/ac');
 assert.doesNotMatch(text,/secret|internal|component-id|gal1ac/);
});
test('legacy mixes, zero rates, missing values and unknown units remain readable',()=>{
 assert.equal(formatTankMix({mix:'Legacy recipe'}),'Legacy recipe');
 assert.equal(formatTankMix({products:[{name:'Product A',rate:0,unit:'lb1ac-1'}]}),'Product A 0 lb/ac');
 assert.equal(formatTankMix({tankMix:{id:'hidden'}}),'Not entered');
 assert.equal(formatTankMix({tankMix:{name:'Named mix'}}),'Named mix');
 assert.equal(formatTankMix({products:[{product_name:'A',rate:2,rate_unit:'custom unit'}]}),'A 2 custom unit');
});
test('checked fields without tasks are listed and included in entity time',()=>{
 const m=buildModel(args),html=renderReport(args);
 assert.equal(m.checkedCount,2);assert.equal(m.recordCount,0);
 assert.equal(m.sessions[0].details.length,2);
 assert.deepEqual(m.entities.map(x=>[x.entity,x.ms]),[['Farm A',3600000],['Farm B',3600000]]);
 assert.match(html,/Field A/);assert.match(html,/Field B/);
 assert.match(html,/Checked; no observations or tasks entered/);
 assert.match(html,/Fields confirmed checked:<\/b> 2/);
});
test('task-only fields do not count as checked or receive allocated time',()=>{
 const input={...args,db:{...args.db,tasks:[{id:'t',sessionId:'s',fieldId:'c',type:'Application',tankMix:{name:'Mix',components:[{product_name:'Chemical',rate:4,rate_unit:'pt1ac-1'}]}}]}};
 const m=buildModel(input),html=renderReport(input);
 assert.equal(m.checkedCount,2);assert.equal(m.recordCount,1);
 assert.equal(m.sessions[0].details.find(x=>x.id==='c').checked,false);
 assert.equal(m.entities.reduce((n,x)=>n+x.ms,0),7200000);
 assert.match(html,/not confirmed checked/);assert.match(html,/Chemical 4 pt\/ac/);
});
test('older sessions stay unallocated and edited duration drives equal allocation',()=>{
 const old={...session,id:'old',checkedFieldIds:undefined,allocationMethod:undefined};
 const m=buildModel({...args,db:{...args.db,sessions:[old,{...session,end:'2026-10-16T11:00:00',entityAllocations:[{hours:1}]}]}});
 assert.equal(m.unallocatedMs,7200000);
 assert.equal(m.entities.reduce((n,x)=>n+x.ms,0),10800000);
 assert.equal(m.totalMs,18000000);
});
test('missing fields retain IDs and user text is escaped in report output',()=>{
 const html=renderReport({...args,db:{...args.db,sessions:[{...session,checkedFieldIds:['missing']}],tasks:[{sessionId:'s',fieldId:'missing',name:'<script>alert(1)</script>',notes:'<img src=x>',type:'Application',mix:'<b>Mix</b>'}]}});
 assert.match(html,/Unmatched field missing/);assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(html,/<script>|<img src=x>|<b>Mix/);
});
test('field visits and unique field counts remain distinct across sessions',()=>{
 const m=buildModel({...args,db:{...args.db,sessions:[session,{...session,id:'other'}]}});
 assert.equal(m.checkedCount,2);assert.equal(m.entities.reduce((n,x)=>n+x.count,0),4);
});
test('report dates are validated and saved selections survive report building',()=>{
 const snapshot=JSON.stringify(args.db);
 assert.throws(()=>buildModel({...args,from:'2026-10-17'}),/valid/);
 buildModel(args);assert.equal(JSON.stringify(args.db),snapshot);
});
test('Scout loads the helper before inline callers and preserves export controls',()=>{
 const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
 assert.ok(html.indexOf('src="./scouting-report.js?')<html.indexOf('function formatTaskTankMix'));
 assert.match(html,/SodvilleReports.renderReport\(\{db,fields,from,to\}\)/);
 for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
 const rendered=renderReport(args);assert.match(rendered,/scoutingReportAction\('print'\)/);assert.match(rendered,/scoutingReportAction\('download'\)/);
});
