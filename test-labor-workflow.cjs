const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('labor-log.js','utf8');
const elements=new Map();
function $(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,style:{},src:'',paused:true,click(){return this.onclick?.()},pause(){this.paused=true},async play(){this.paused=false},removeAttribute(k){this[k]=''},replaceChildren(){},dispatchEvent(){if(id==='laborNotes')ctx.extracted=[]}});return elements.get(id)}
const db={laborLogs:[]};let saved=0;
const ctx={$,db,extracted:[],draft:null,spoken:'',crypto:require('node:crypto').webcrypto,user:()=>({id:'andrew',name:'Andrew'}),currentLogs:()=>db.laborLogs,range:x=>[Date.parse(x.start),Date.parse(x.end)],totals:(a,b)=>({gross:b-a,overlap:0,additional:b-a}),hours:x=>(x/3600000).toFixed(2),fmt:x=>x,save:()=>saved++,history(){},Event:class{},setTimeout(){},Date,Array,Number,JSON,URL:{createObjectURL:()=> 'blob:review',revokeObjectURL(){}},AbortSignal,window:{speechSynthesis:{cancel(){ctx.cancelled=true}}},isIOS:true,navigator:{mediaDevices:{async getUserMedia(){assert.equal($('laborSpokenPlayback').paused,true);throw Error('mock microphone unavailable')}}},listen(){},speak(){return false},console};vm.createContext(ctx);
const review=source.slice(source.indexOf("  $('laborReview').onclick="),source.lastIndexOf("  $('laborNotes').addEventListener('input'"));
const playback=source.slice(source.indexOf('  let spokenAudioUrl='),source.indexOf('  let commandRecorder='));
const commands=source.slice(source.indexOf('  let commandRecorder='),source.lastIndexOf('})();'));
vm.runInContext(review+playback+commands,ctx);
(async()=>{
$('laborNotes').value='Yesterday I repaired the tractor from 8 to 10 AM.';
ctx.extracted=[{date:'2026-10-15',category:'Equipment Management',description:'Repaired tractor',startTime:'08:00',endTime:'10:00'}];
await $('laborReview').click();assert.equal(ctx.draft[0].workDate,'2026-10-15');assert.equal(ctx.draft[0].start,new Date('2026-10-15T08:00').toISOString());
let speechBody;ctx.fetch=async(url,opts)=>{assert.ok(url.endsWith('/speak'));speechBody=JSON.parse(opts.body);return {ok:true,blob:async()=>({})}};
await $('laborReadBack').click();assert.match(speechBody.text,/Repaired tractor/);assert.equal($('laborSpokenPlayback').paused,false);
await $('laborListenApprove').click();assert.equal(ctx.cancelled,true);assert.equal($('laborSpokenPlayback').paused,true);
vm.runInContext("handleVoiceCommand('Change the finish time to 10:30 AM.')",ctx);
assert.equal(ctx.draft,null);assert.match($('laborNotes').value,/\nCorrection: Change the finish time/);assert.equal(ctx.extracted.length,0);assert.equal(saved,0);
// Reinterpret response after correction, retaining the dictated work date.
ctx.extracted=[{date:'2026-10-15',category:'Equipment Management',description:'Repaired tractor',startTime:'08:00',endTime:'10:30'}];
await $('laborReview').click();await $('laborReadBack').click();assert.match(speechBody.text,/15:30/);
vm.runInContext("handleVoiceCommand('do not save')",ctx);assert.equal(saved,0);
vm.runInContext("handleVoiceCommand('Yes save.')",ctx);assert.equal(saved,1);assert.equal(db.laborLogs.length,1);assert.equal(db.laborLogs[0].end,new Date('2026-10-15T10:30').toISOString());assert.equal(db.laborLogs[0].workDate,'2026-10-15');assert.ok(db.laborLogs[0].approvedAt);
vm.runInContext("handleVoiceCommand('save')",ctx);assert.equal(saved,1);
console.log('PASS: review → MP3 → stop playback → spoken correction → corrected review/readback → explicit save; date preserved; ambiguous/duplicate approval rejected');
})().catch(e=>{console.error(e);process.exitCode=1});
