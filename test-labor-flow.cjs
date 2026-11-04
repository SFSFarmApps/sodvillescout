const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(__dirname+'/labor-log.js','utf8');
function setup({offline=false}={}){
 const dom=new JSDOM('<button id="reportBtn">Report</button><button id="sessionBtn">Session</button>',{url:'https://sfsfarmapps.github.io/sodvillescout/',runScripts:'outside-only'}),w=dom.window;
 w.confirm=()=>true;w.console.warn=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLMediaElement.prototype.pause=function(){};
 w.fetch=async()=>{if(offline)throw Error('offline');return {ok:true,json:async()=>({source:'ai',date:'2020-11-03',tasks:[{category:'Equipment Management',description:'Repaired tractor',date:'2020-11-03',startTime:'08:00',endTime:'09:00'}],questions:[]})}};
 w.eval(fs.readFileSync(__dirname+'/labor-report.js','utf8'));
 w.eval("const db={users:[{id:'brad',name:'Brad (test fixture)'}],currentUserId:'brad',sessions:[],laborLogs:[]};const currentUser=()=>db.users[0];const save=()=>localStorage.setItem('sodvilleScoutV1',JSON.stringify(db));window.savedDB=()=>db;\n"+source.replace(/\}\)\(\);\s*$/,'window.testLaborVoice=handleVoiceCommand;})();'));w.document.getElementById('laborLogBtn').click();
 return {w,dom,$:id=>w.document.getElementById(id)};
}
async function prepare(t,notes){t.$('laborNotes').value=notes;t.$('laborNotes').dispatchEvent(new t.w.Event('input',{bubbles:true}));await t.$('laborReview').onclick();}
test('actual Labor Log UI reviews and saves Brad’s interpreted tasks once',async()=>{
 const t=setup();try{await prepare(t,'Repaired tractor November 3, 2020 from 8 to 9 AM');await t.$('laborReview').onclick();assert.equal(t.$('laborReviewPanel').hidden,false);t.$('laborApprove').click();const stored=JSON.parse(t.w.localStorage.getItem('sodvilleScoutV1'));assert.equal(stored.laborLogs.length,1);assert.equal(stored.laborLogs[0].userId,'brad');assert.match(t.$('laborError').textContent,/activities saved/);t.$('laborApprove').click();assert.equal(t.w.savedDB().laborLogs.length,1);}finally{t.dom.window.close()}
});
test('offline AI fallback extracts explicit work dates and clock times and reaches Save',async()=>{
 const t=setup({offline:true});try{await prepare(t,'On 11/03/2020 repaired the tractor from 8 to 9 AM. Then worked on the sprayer from 9 to 10 AM.');await t.$('laborReview').onclick();assert.equal(t.$('laborReviewPanel').hidden,false,t.$('laborError').textContent);t.$('laborApprove').click();const stored=JSON.parse(t.w.localStorage.getItem('sodvilleScoutV1'));assert.equal(stored.laborLogs.length,2);assert.equal(stored.laborLogs[0].workDate,'2020-11-03');assert.equal(stored.laborLogs[0].userId,'brad');}finally{t.dom.window.close()}
});

test('yesterday fallback and spoken yes save persist the reviewed activity',async()=>{
 const t=setup({offline:true});try{await prepare(t,'Yesterday repaired the tractor from 8 to 9 AM');await t.$('laborReview').onclick();assert.equal(t.$('laborReviewPanel').hidden,false,t.$('laborError').textContent);t.w.testLaborVoice('yes save');assert.equal(t.w.savedDB().laborLogs.length,1);assert.match(t.$('laborError').textContent,/activities saved/);}finally{t.dom.window.close()}
});

test('an unfinished draft from the broken fallback can be reinterpreted and saved without retyping notes',async()=>{
 const t=setup({offline:true});try{const notes='On 11/03/2020 repaired the tractor from 8 to 9 AM';t.w.localStorage.setItem('sodvilleScoutLaborDraftV1:brad',JSON.stringify({userId:'brad',notes,date:'',tasks:[{description:notes,date:'',category:'Equipment Management',startTime:null,endTime:null}]}));t.$('laborLogBtn').click();assert.equal(t.$('laborReinterpret').hidden,false);await t.$('laborReinterpret').onclick();await t.$('laborReview').onclick();assert.equal(t.$('laborReviewPanel').hidden,false,t.$('laborError').textContent);t.$('laborApprove').click();assert.equal(t.w.savedDB().laborLogs.length,1);assert.equal(t.w.savedDB().laborLogs[0].workDate,'2020-11-03');assert.equal(t.w.savedDB().laborLogs[0].sourceNarrative,notes);}finally{t.dom.window.close()}
});
