const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/labor-log.js','utf8');
function setup(){
 const els=new Map(),$=id=>{if(!els.has(id))els.set(id,{value:'',style:{},textContent:'',replaceChildren(){},scrollIntoView(){this.scrolled=true},focus(){this.focused=true}});return els.get(id)};
 const storage=new Map(),db={laborLogs:[]};let fail=false,saves=0,syncs=0,scout={id:'u',name:'Scout'};
 const ctx={$,db,Date,JSON,console,overlay:{addEventListener(){}},window:{addEventListener(){},sodvilleSyncChanged:()=>syncs++},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},user:()=>scout,currentLogs:()=>db.laborLogs.filter(x=>x.userId===scout.id),range:x=>[Date.parse(x.start),Date.parse(x.end)],history(){},save(){if(fail)throw Error('Storage full');saves++},setTimeout(){},taskEditor(items,date){ctx.restored={items,date}}};
 vm.createContext(ctx);
 const helpers=source.slice(source.indexOf('  let draftOwner=null;'),source.indexOf('  const isoDate=d=>'));
 const approval=source.slice(source.indexOf('  function approve(){'),source.indexOf("  $('laborApprove').onclick=approve;"));
 vm.runInContext("let extracted=[],draft=null;\n"+helpers+'\n'+approval+'\nglobalThis.api={approve,persistLaborDraft,restoreLaborDraft};',ctx);
 const draft=[{id:'a',userId:'u',notes:'Equipment repair',start:'2020-10-16T08:00:00Z',end:'2020-10-16T09:00:00Z'}];
 ctx.items=draft;vm.runInContext("draft=items;draftOwner='u';",ctx);$('laborNotes').value='Equipment repairs this morning';$('laborReviewPanel').hidden=false;
 return {ctx,$,db,storage,fail:()=>fail=true,counts:()=>({saves,syncs}),state:()=>JSON.parse(vm.runInContext('JSON.stringify({draft,extracted})',ctx))};
}
test('failed save preserves reviewed draft, rolls back all inserts, and makes error visible',()=>{const t=setup();t.fail();t.ctx.api.approve();assert.equal(t.db.laborLogs.length,0);assert.equal(t.state().draft.length,1);assert.equal(t.$('laborReviewPanel').hidden,false);assert.match(t.$('laborError').textContent,/Could not save/);assert.equal(t.$('laborError').scrolled,true);assert.deepEqual(t.counts(),{saves:0,syncs:0});});
test('successful approval saves once, clears backup, schedules sync, and prevents duplicate taps',()=>{const t=setup();t.ctx.api.persistLaborDraft();assert.equal(t.storage.size,1);t.ctx.api.approve();t.ctx.api.approve();assert.equal(t.db.laborLogs.length,1);assert.ok(t.db.laborLogs[0].approvedAt);assert.equal(t.storage.size,0);assert.deepEqual(t.counts(),{saves:1,syncs:1});});
test('draft restores notes and edited tasks only for the selected scout',()=>{const t=setup();vm.runInContext("extracted=[{description:'Edited task',date:'2020-10-16',startTime:'08:00',endTime:'09:00'}]",t.ctx);t.ctx.api.persistLaborDraft();t.$('laborNotes').value='';t.ctx.api.restoreLaborDraft();assert.equal(t.$('laborNotes').value,'Equipment repairs this morning');assert.equal(t.ctx.restored.items[0].description,'Edited task');assert.match(t.$('laborError').textContent,/restored/);});
test('overlap added after review blocks posting without changing the draft',()=>{const t=setup();t.db.laborLogs.push({id:'remote',userId:'u',approvedAt:'2020-10-16',start:'2020-10-16T08:30:00Z',end:'2020-10-16T09:30:00Z'});t.ctx.api.approve();assert.equal(t.db.laborLogs.length,1);assert.equal(t.state().draft.length,1);assert.match(t.$('laborError').textContent,/overlaps/);assert.equal(t.counts().saves,0);});
