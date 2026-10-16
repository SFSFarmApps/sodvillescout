const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'labor-log.js'),'utf8');
function setup(){
 class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.style={};this.value='';this.textContent='';this.attributes={};}
  appendChild(x){this.children.push(x);return x;}append(...xs){this.children.push(...xs);}replaceChildren(){this.children=[];}
  setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}pause(){}focus(){this.focused=true;}
  querySelectorAll(tag){return this.children.flatMap(x=>[...(x.tag===tag?[x]:[]),...x.querySelectorAll(tag)]);}
 }
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const context={$: $,document:{createElement:tag=>new Element(tag)},CATEGORIES:['Field Work','Other'],Date,crypto:{randomUUID:()=> 'draft'},user:()=>({id:'u',name:'Scout'}),currentLogs:()=>[],range:x=>[Date.parse(x.start),Date.parse(x.end)],totals:()=>({gross:3600000,overlap:0,additional:3600000}),hours:x=>(x/3600000).toFixed(2),fmt:x=>x,interpret:()=>{throw Error('Unexpected reinterpretation');}};
 const editor=source.slice(source.indexOf('  function taskEditor('),source.indexOf('  async function interpret()'));
 const reviewStart=source.indexOf("  $('laborReview').onclick=async()=>{");
 const review=source.slice(reviewStart,source.indexOf("  $('laborNotes').addEventListener('input'",reviewStart));
 vm.createContext(context);vm.runInContext("let extracted=[],draft=null,spoken='';\n"+editor+'\n'+review,context);
 return {$,context,edit:items=>{context.items=items;vm.runInContext("taskEditor(items,'2020-10-16','ai')",context);},state:()=>JSON.parse(vm.runInContext('JSON.stringify({extracted,draft,spoken})',context))};
}
const task=(description,startTime='08:00',endTime='09:00')=>({description,category:'Field Work',date:'2020-10-16',startTime,endTime});
test('remove one task preserves edited descriptions, dates and times on remaining tasks',()=>{
 const t=setup();t.edit([task('Keep'),task('Remove'),task('Last','10:00','11:00')]);
 const root=t.$('laborParsedTasks'),panels=root.children.slice(1),description=panels[0].children.find(x=>x.tag==='textarea');
 description.value='Edited kept activity';description.oninput();
 const dateInput=panels[0].children.find(x=>x.tag==='label').children[0];dateInput.value='2020-10-15';dateInput.onchange();
 root.querySelectorAll('button')[1].onclick();
 const state=t.state();assert.deepEqual(state.extracted.map(x=>x.description),['Edited kept activity','Last']);
 assert.equal(state.extracted[0].date,'2020-10-15');assert.equal(state.extracted[1].startTime,'10:00');
 assert.equal(root.querySelectorAll('button')[1].attributes['aria-label'],'Remove task 2');
 assert.equal(t.$('laborContinue').hidden,false);
});
test('duplicate descriptions remove the exact selected card and deleting all hides Continue',()=>{
 const t=setup();t.edit([task('Same'),task('Same','10:00','11:00')]);
 t.$('laborParsedTasks').querySelectorAll('button')[0].onclick();
 assert.equal(t.state().extracted[0].startTime,'10:00');
 t.$('laborParsedTasks').querySelectorAll('button')[0].onclick();
 assert.equal(t.state().extracted.length,0);assert.equal(t.$('laborContinue').hidden,true);
 assert.equal(t.$('laborContinue').style.display,'none');assert.match(t.$('laborParsedTasks').children[0].textContent,/All tasks removed/);
 assert.equal(t.$('laborReview').textContent,'✨ Interpret dictation again');
});
test('removed tasks never reach review drafts or spoken readback',async()=>{
 const t=setup();t.edit([task('Keep'),task('Unwanted with missing times','','')]);
 t.$('laborNotes').value='Original dictated narrative for both tasks';
 t.$('laborParsedTasks').querySelectorAll('button')[1].onclick();
 await t.$('laborReview').onclick();const state=t.state();
 assert.equal(state.draft.length,1);assert.equal(state.draft[0].notes,'Keep');assert.equal(state.draft[0].workDate,'2020-10-16');
 assert.doesNotMatch(state.spoken,/Unwanted/);assert.match(t.$('laborSummary').textContent,/Keep/);
 assert.equal(t.$('laborReviewPanel').hidden,false);
});
