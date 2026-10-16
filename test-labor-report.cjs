const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const report=require('./labor-report.js'),print=require('./report-print.js');
const scout={id:'u',name:'Andrew'},start='2026-10-16T08:00:00',end='2026-10-16T10:00:00';
const entry={id:'l',userId:'u',userName:'Andrew',approvedAt:'2026-10-16T10:30:00',start,end,category:'Field Work',notes:'Inspect equipment'};
const input={logs:[entry],sessions:[{userId:'u',start:'2026-10-16T08:30:00',end:'2026-10-16T09:30:00'}],scout,from:'2026-10-16',to:'2026-10-16'};
test('approved current-scout records retain scouting-overlap deduction',()=>{
 const r=report.build({...input,logs:[entry,{...entry,id:'unapproved',approvedAt:null},{...entry,id:'other',userId:'other'}]});
 assert.equal(r.rows.length,1);assert.equal(r.gross,2);assert.equal(r.scouting,1);assert.equal(r.additional,1);
});
test('overlapping scouting sessions are counted once',()=>{
 const r=report.build({...input,sessions:[...input.sessions,{userId:'u',start:'2026-10-16T09:00:00',end:'2026-10-16T09:45:00'},{userId:'other',start,end}]});
 assert.equal(r.scouting,1.25);assert.equal(r.additional,.75);
});
test('summary and detailed outputs use the same unrounded totals',()=>{
 const logs=[entry,{...entry,id:'second',category:'Office',start:'2026-10-16T11:00:00',end:'2026-10-16T11:00:20'}];
 const detail=report.build({...input,logs}),summary=report.build({...input,logs,layout:'summary'});
 assert.equal(summary.gross,detail.gross);assert.equal(summary.groups.reduce((n,x)=>n+x.additional,0),detail.additional);
 assert.match(report.body(summary),/Category summary/);assert.match(report.csv(summary),/activities/);
 assert.match(report.csv(detail),/approved/);assert.match(report.body(detail),/Inspect equipment/);
});
test('category, date ranges and invalid times filter without modifying records',()=>{
 const snapshot=JSON.stringify(input);
 assert.equal(report.build({...input,category:'Office'}).rows.length,0);
 assert.equal(report.build({...input,from:'2026-10-17',to:'2026-10-18'}).rows.length,0);
 assert.equal(report.build({...input,logs:[{...entry,end:start}]}).rows.length,0);
 assert.throws(()=>report.build({...input,from:'2026-10-18'}),/valid/);
 assert.equal(JSON.stringify(input),snapshot);
});
test('report text is escaped and spreadsheet text cannot execute formulas',()=>{
 const r=report.build({...input,logs:[{...entry,notes:'=1+1',category:'<script>bad</script>'}]});
 assert.match(report.body(r),/&lt;script&gt;/);assert.match(report.csv(r),/"'=1\+1"/);
});
function closeScript(hasOpener=true){
 const html=print.document({title:'Labor',body:'<h1>Report</h1>',returnUrl:'https://sfsfarmapps.github.io/sodvillescout/#labor-reports'});
 const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];let closed=0,focused=0;
 const elements={reportCloseHelp:{textContent:''},reportReturn:{hidden:true}};
 const window={opener:hasOpener?{closed:false,focus:()=>focused++}:null,close:()=>closed++,location:{href:''}};
 const c={window,document:{getElementById:id=>elements[id]},setTimeout:fn=>fn()};
 vm.runInNewContext(source,c);c.closeReportPreview();return{window,elements,closed,focused,html};
}
test('print preview closes and focuses its builder with a fallback for browser restrictions',()=>{
 const r=closeScript();assert.equal(r.closed,1);assert.equal(r.focused,1);
 assert.equal(r.elements.reportReturn.hidden,false);assert.match(r.elements.reportCloseHelp.textContent,/browser keeps this tab/);
 assert.match(r.html,/Close preview &amp; return/);assert.match(r.html,/@media print/);
});
test('downloaded printable file has a return path when no opener exists',()=>{
 const r=closeScript(false);assert.equal(r.window.location.href,'https://sfsfarmapps.github.io/sodvillescout/#labor-reports');
 assert.equal(r.closed,0);
});
function builderSetup(){
 const elements=new Map(),bodyChildren=[],downloads=[];let draftResets=0,focus=null,popup=null;
 class Element{
  constructor(){this.hidden=false;this.disabled=false;this.value='';this.options=[];this.listeners={};this.textContent='';this._html='';}
  set innerHTML(s){this._html=s;for(const match of s.matchAll(/id="([^"]+)"/g))if(!elements.has(match[1]))elements.set(match[1],new Element());}
  get innerHTML(){return this._html;}
  appendChild(x){this.options.push(x);return x;}replaceChildren(){this.options=[];}
  addEventListener(k,f){this.listeners[k]=f;}focus(){focus=this;document.activeElement=this;}
  querySelectorAll(){return [...elements.values()];}click(){downloads.push(this.download);}remove(){}
 }
 const document={createElement:()=>new Element(),getElementById:id=>elements.get(id),activeElement:new Element(),body:{appendChild:x=>bodyChildren.push(x)}};
 const $=id=>document.getElementById(id),shortcut=new Element();elements.set('laborOpenReportBuilder',new Element());
 const logs=[entry],db={laborLogs:logs,sessions:input.sessions};
 const window={SodvilleLaborReport:report,SodvillePrint:print,location:{hash:''},addEventListener:()=>{},open:()=>popup};
 const source=fs.readFileSync(path.join(__dirname,'labor-log.js'),'utf8');
 const block=source.slice(source.indexOf("  const reportOverlay=document.createElement"),source.indexOf('\n  function history()'));
 const c={document,window,$,db,user:()=>scout,currentLogs:()=>logs,exportShortcut:shortcut,esc:s=>String(s),Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},setTimeout:()=>{},open:()=>draftResets++};
 vm.runInNewContext(block,c);return {$,c,shortcut,downloads,overlay:bodyChildren[0],get draftResets(){return draftResets;},setPopup:p=>popup=p};
}
test('builder opens independently, builds a preview, and invalidates changed filters',()=>{
 const t=builderSetup();t.shortcut.onclick();assert.equal(t.draftResets,0);
 t.$('laborExportFrom').value='2026-10-16';t.$('laborExportTo').value='2026-10-16';
 t.$('laborReportBuild').onclick();assert.match(t.$('laborReportPreview').innerHTML,/Inspect equipment/);
 assert.equal(t.$('laborReportPrint').disabled,false);
 t.$('laborExportFrom').listeners.change();assert.equal(t.$('laborReportPrint').disabled,true);
 assert.doesNotMatch(t.$('laborReportPreview').innerHTML,/Inspect equipment/);
});
test('builder handles empty data and blocked popups, and preserves preview when printing',()=>{
 const t=builderSetup();t.shortcut.onclick();t.$('laborExportFrom').value='2026-10-16';t.$('laborExportTo').value='2026-10-16';
 t.$('laborReportBuild').onclick();t.$('laborReportPrint').onclick();assert.match(t.$('laborExportStatus').textContent,/blocked/);
 let html='';t.setPopup({document:{open(){},write:s=>html=s,close(){}},focus(){}});t.$('laborReportPrint').onclick();
 assert.match(html,/Close preview &amp; return/);assert.match(t.$('laborReportPreview').innerHTML,/Inspect equipment/);
 t.$('laborReportCategory').value='No matches';t.$('laborReportBuild').onclick();assert.equal(t.$('laborReportDownload').disabled,true);
});
test('builder downloads the built layout in the selected format and closes explicitly',()=>{
 const t=builderSetup();t.shortcut.onclick();t.$('laborExportFrom').value='2026-10-16';t.$('laborExportTo').value='2026-10-16';
 t.$('laborReportLayout').value='summary';t.$('laborReportBuild').onclick();
 t.$('laborReportFormat').value='csv';t.$('laborReportDownload').onclick();
 t.$('laborReportFormat').value='html';t.$('laborReportDownload').onclick();
 assert.deepEqual(t.downloads,['Sodville-Labor-summary-2026-10-16-to-2026-10-16.csv','Sodville-Labor-summary-2026-10-16-to-2026-10-16.html']);
 assert.equal(t.overlay.hidden,false);t.$('laborReportDone').onclick();assert.equal(t.overlay.hidden,true);
 assert.equal(t.draftResets,0);
});
test('Scout and Labor both use closeable print shell; startup scripts parse',()=>{
 const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');assert.match(html,/SodvillePrint.document\(/);
 assert.ok(html.indexOf('src="./report-print.js')<html.indexOf('src="./labor-log.js'));
 for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
 new vm.Script(fs.readFileSync(path.join(__dirname,'labor-log.js'),'utf8'));
});
