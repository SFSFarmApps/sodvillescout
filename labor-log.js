/* Sodville Scout Labor & Management Log. Uses the existing scout name selection
   and shared offline database; employee reports are only in private Command. */
(() => {
  'use strict';
  db.laborLogs ||= [];
  const $ = id => document.getElementById(id);
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = iso => new Date(iso).toLocaleString([], {dateStyle:'medium',timeStyle:'short'});
  const localTime = d => {
    const date = new Date(d);
    return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
  };
  const hours = ms => (ms/3600000).toFixed(2);
  const user = () => typeof currentUser === 'function' ? currentUser() : db.users.find(x=>x.id===db.currentUserId);
  const sessions = () => (db.sessions||[]).filter(x=>x.userId===user()?.id && x.start);
  const currentLogs = () => db.laborLogs.filter(x=>x.userId===user()?.id).sort((a,b)=>Date.parse(b.start)-Date.parse(a.start));
  const range = x => {
    const a=Date.parse(x.start),b=Date.parse(x.end);
    return Number.isFinite(a)&&Number.isFinite(b)&&b>a ? [a,b] : null;
  };
  function overlapMs(start,end,items) {
    const clipped=items.map(range).filter(Boolean).map(([a,b])=>[Math.max(a,start),Math.min(b,end)])
      .filter(([a,b])=>b>a).sort((x,y)=>x[0]-y[0]);
    let total=0,last=start;
    for(const [a,b] of clipped){total+=Math.max(0,b-Math.max(a,last));last=Math.max(last,b)}
    return total;
  }
  function totals(start,end) {
    const gross=end-start,overlap=overlapMs(start,end,sessions());
    return {gross,overlap,additional:Math.max(0,gross-overlap)};
  }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let recognition = null;
  function speak(message) {
    if(!('speechSynthesis' in window))return false;
    // iOS standalone web apps can hang while acquiring speech audio. Keep playback opt-in.
    if(isIOS){$('laborError').textContent='On iPhone, use the on-screen review; spoken playback may be unavailable.';return false}
    window.speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance(message);
    utterance.rate=.93;window.speechSynthesis.speak(utterance);return true;
  }
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  function listen(onText,onError) {
    // iOS Web Speech recognition can stall in Home Screen PWAs. Use the reliable
    // system keyboard microphone instead, which transcribes directly into notes.
    if(isIOS){
      $('laborNotes').focus();
      onError('On iPhone, tap the microphone on your keyboard to dictate. Tap Done when finished.');
      return;
    }
    if(!Recognition){onError('Tap the notes field and use your keyboard microphone to dictate.');$('laborNotes').focus();return}
    if(recognition){try{recognition.abort()}catch(_){} recognition=null}
    const rec=new Recognition();recognition=rec;rec.lang='en-US';rec.interimResults=false;rec.continuous=false;
    let finished=false;
    const timeout=setTimeout(()=>{if(!finished){try{rec.abort()}catch(_){}onError('Speech recognition timed out. Use the keyboard microphone instead.')}},12000);
    const cleanup=()=>{finished=true;clearTimeout(timeout);if(recognition===rec)recognition=null};
    rec.onresult=e=>{cleanup();onText(Array.from(e.results).map(r=>r[0].transcript).join(' '))};
    rec.onerror=e=>{cleanup();onError('Microphone: '+e.error+'. Use the keyboard microphone instead.')};
    rec.onend=()=>{if(!finished){cleanup();onError('Dictation stopped. Use the keyboard microphone if needed.')}};
    try{rec.start()}catch(e){cleanup();onError('Microphone unavailable. Use the keyboard microphone instead.')}
  }
  const btn=document.createElement('button');
  btn.id='laborLogBtn';btn.type='button';btn.textContent='🎙 Labor Log';
  btn.style.cssText='background:#e6f1e8;border:1px solid #b5d1bc;color:#173b25;font-weight:800;min-height:43px';
  const reportBtn=$('reportBtn');
  if(reportBtn)reportBtn.insertAdjacentElement('afterend',btn);
  else $('sessionBtn')?.insertAdjacentElement('afterend',btn);
  const overlay=document.createElement('div');
  overlay.id='laborLogOverlay';
  overlay.style.cssText='display:none;position:fixed;inset:0;z-index:100010;background:#0009;padding:12px;overflow:auto';
  overlay.innerHTML=`<section role="dialog" aria-modal="true" aria-label="Labor and management time log" style="max-width:580px;width:100%;margin:3vh auto;background:#fff;color:#17291d;border-radius:14px;padding:18px;box-shadow:0 8px 35px #0004">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2 style="margin:0;font-size:21px">Labor & Management Log</h2><button type="button" id="laborClose" aria-label="Close">✕</button></div>
    <p style="font-size:13px;color:#53675a">Log physical labor or management work. Scouting time already recorded by the scouting timer will be deducted automatically.</p>
    <p id="laborWho" style="font-weight:800"></p>
    <div id="laborForm">
      <label style="display:block;margin:10px 0">Activity
        <select id="laborCategory" style="display:block;width:100%;margin-top:5px">
          <option value="" selected>Choose after dictation</option><option>Equipment Management</option><option>Employee Management</option><option>Field Work</option>
          <option>Marketing</option><option>Financial Management</option><option>Landowner Relations</option>
          <option>FSA Compliance</option><option>Cattle Management</option><option>Office / Administration</option><option>Other</option>
        </select>
      </label>
      <label style="display:block;margin:10px 0">Work date (from dictation, or enter it)<input type="date" id="laborDate" style="display:block;width:100%;margin-top:5px"></label>\n      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px">
        <label>Started<input type="datetime-local" id="laborStart" style="display:block;width:100%;margin-top:5px"></label>
        <label>Finished<input type="datetime-local" id="laborEnd" style="display:block;width:100%;margin-top:5px"></label>
      </div>
      <label style="display:block;margin-top:12px">What did you do?
        <textarea id="laborNotes" rows="3" style="display:block;width:100%;margin-top:5px" placeholder="Example: Worked on equipment repairs and met with employees about tomorrow's field work."></textarea>
      </label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
        <button type="button" id="laborDictate">🎙 Dictate notes</button>
        <button type="button" id="laborReview" style="background:#173b25;color:#fff;font-weight:800">✨ Interpret & review dictation</button>
      </div>
    </div>
    <div id="laborReviewPanel" hidden style="border:1px solid #bdd3c2;background:#f2f8f2;border-radius:10px;padding:12px">
      <h3 style="margin:0 0 8px">Review before approval</h3>
      <div id="laborSummary" style="font-size:14px;line-height:1.7;white-space:pre-line"></div>
      <p id="laborWarning" style="color:#854d0e;font-size:12px"></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" id="laborReadBack">🔊 Read back</button>
        <button type="button" id="laborListenApprove">🎙 Say approve</button>
        <button type="button" id="laborEdit">Edit</button>
        <button type="button" id="laborApprove" style="background:#173b25;color:white;font-weight:800">Approve & save</button>
      </div>
    </div>
    <p id="laborError" role="alert" style="color:#a32222;font-size:13px;min-height:1em"></p>
    <h3 style="font-size:16px">Your recent entries</h3>
    <div id="laborHistory" style="font-size:12px;max-height:190px;overflow:auto"></div>
    <p style="font-size:11px;color:#607466">Entries save on this device first and synchronize when online. Management reports are available only in Sodville Command.</p>
  </section>`;
  document.body.appendChild(overlay);
  let draft=null,spoken='';
  function history() {
    const list=currentLogs().slice(0,15);
    $('laborHistory').innerHTML=list.length?list.map(x=>{
      const r=range(x),t=r?totals(...r):null;
      return '<div style="padding:8px 0;border-bottom:1px solid #e2e9e2"><b>'+esc(x.category)+'</b> · '+esc(fmt(x.start))+
        ' · '+(t?hours(t.additional)+' additional hr':'—')+'<div>'+esc(x.notes||'')+'</div></div>';
    }).join(''):'No labor entries yet.';
  }
  function open() {
    const u=user();if(!u){alert('Select a scout first.');return}
    $('laborWho').textContent='Scout: '+u.name;
    $('laborStart').value='';
    $('laborEnd').value='';
    $('laborNotes').value='';$('laborCategory').value='';$('laborDate').value='';$('laborParsedTasks').replaceChildren();
    $('laborError').textContent=isIOS?'For dictation, tap Dictate notes, then use the microphone on the iPhone keyboard.':'';$('laborReviewPanel').hidden=true;$('laborForm').hidden=false;
    draft=null;history();overlay.style.display='block';
  }
  function close(){overlay.style.display='none';if(recognition){try{recognition.abort()}catch(_){}recognition=null}if(!isIOS)window.speechSynthesis?.cancel()}
  btn.onclick=open;$('laborClose').onclick=close;
  overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
  $('laborDictate').onclick=()=>{
    $('laborError').textContent=isIOS?'Tap the microphone on the iPhone keyboard to dictate.':'Listening for your description…';
    listen(text=>{$('laborNotes').value=($('laborNotes').value+' '+text).trim();$('laborError').textContent='Dictation captured. Review the wording and times.'},m=>$('laborError').textContent=m);
  };

  const CATEGORIES=['Equipment Management','Employee Management','Field Work','Marketing','Financial Management','Landowner Relations','FSA Compliance','Cattle Management','Office / Administration','Other'];
  let extracted=[];
  const isoDate=d=>{const x=new Date(d);return new Date(x.getTime()-x.getTimezoneOffset()*60000).toISOString().slice(0,10)};
  function localInterpret(text) {
    const lower=text.toLowerCase(),now=new Date(),today=isoDate(now);
    let date=null;
    if(/\\btoday\\b/.test(lower))date=today;
    else if(/\\byesterday\\b/.test(lower))date=isoDate(now.getTime()-86400000);
    else {
      const numeric=lower.match(/\\b(\\d{1,2})[\\/.-](\\d{1,2})(?:[\\/.-](\\d{2,4}))?\\b/);
      if(numeric){let y=numeric[3]?Number(numeric[3]):now.getFullYear();if(y<100)y+=2000;const m=Number(numeric[1]),d=Number(numeric[2]);if(m>=1&&m<=12&&d>=1&&d<=31){const test=new Date(y,m-1,d);if(test.getMonth()===m-1&&test.getDate()===d)date=isoDate(test)}}
    }
    const groups=text.split(/(?:\\s+then\\s+|;|\\.\\s+|\\s+after that\\s+|\\s+and then\\s+)/i).map(x=>x.trim()).filter(Boolean);
    const tasks=groups.map(segment=>{
      const l=segment.toLowerCase();
      let category='Other';
      if(/repair|mechanic|tractor|sprayer|combine|picker|equipment|maintenance|greas|service truck/.test(l))category='Equipment Management';
      else if(/employee|crew|hiring|workers|staff|payroll|meeting with/.test(l))category='Employee Management';
      else if(/plant|plow|spray|harvest|field work|cultivat|tillage|leveling/.test(l))category='Field Work';
      else if(/grain sale|cotton sale|market|hedg|contract price/.test(l))category='Marketing';
      else if(/account|budget|invoice|bank|financial|bill|bookkeep/.test(l))category='Financial Management';
      else if(/landowner|rent|lease|landlord/.test(l))category='Landowner Relations';
      else if(/fsa|farm service agency|compliance|acreage report/.test(l))category='FSA Compliance';
      else if(/cattle|cow|calv|pasture|fenc|graz/.test(l))category='Cattle Management';
      else if(/office|paperwork|email|admin/.test(l))category='Office / Administration';
      const duration=l.match(/\\b(?:for|about|roughly|approximately)\\s+(\\d+(?:\\.\\d+)?)\\s*(hours?|hrs?|minutes?|mins?)\\b/);
      const minutes=duration?Math.round(Number(duration[1])*(duration[2].startsWith('h')?60:1)):null;
      return {category,description:segment,startTime:null,endTime:null,durationMinutes:minutes};
    });
    return {source:'local',date,tasks,questions:[]};
  }
  function timeFromNarrative(text,date) {
    // No inferred start or end times. Explicit manual inputs remain authoritative.
    const a=$('laborStart').value,b=$('laborEnd').value;
    if(a&&b)return {start:new Date(a),end:new Date(b)};
    return null;
  }
  function taskEditor(items,date,source){
    extracted=items.map(x=>({...x}));
    $('laborDate').value=date||'';
    const root=$('laborParsedTasks');root.replaceChildren();
    const head=document.createElement('p');head.style.cssText='font-size:12px;color:#415b47';
    head.textContent=(source==='ai'?'AI extracted':'Local extraction')+' '+items.length+' task(s). Check every activity, date, and time. Missing information must be entered before approval.';
    root.appendChild(head);
    extracted.forEach((task,i)=>{
      const panel=document.createElement('div');panel.style.cssText='border:1px solid #d4e2d5;border-radius:9px;padding:10px;margin:9px 0;background:#f7faf7';
      const title=document.createElement('b');title.textContent='Task '+(i+1);panel.appendChild(title);
      const description=document.createElement('textarea');description.rows=2;description.value=task.description||'';description.style.cssText='display:block;width:100%;margin:6px 0';description.setAttribute('aria-label','Task '+(i+1)+' description');description.oninput=()=>task.description=description.value;panel.appendChild(description);
      const category=document.createElement('select');category.style.cssText='display:block;width:100%;margin:6px 0';
      for(const c of CATEGORIES){const opt=document.createElement('option');opt.textContent=c;opt.value=c;category.appendChild(opt)}
      category.value=CATEGORIES.includes(task.category)?task.category:'Other';task.category=category.value;
      category.onchange=()=>task.category=category.value;panel.appendChild(category);
      const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:7px';
      const makeTime=(label,key)=>{const wrap=document.createElement('label');wrap.style.fontSize='12px';wrap.textContent=label;const input=document.createElement('input');input.type='time';input.style.width='100%';input.value=task[key]||'';input.onchange=()=>task[key]=input.value;wrap.appendChild(input);return wrap};
      grid.append(makeTime('Start time','startTime'),makeTime('End time','endTime'));panel.appendChild(grid);
      if(task.durationMinutes&&!task.startTime) {const hint=document.createElement('small');hint.textContent='Dictated duration: '+task.durationMinutes+' minutes. Enter the actual start and finish times.';panel.appendChild(hint)}
      root.appendChild(panel);
    });
  }
  async function interpret() {
    const text=$('laborNotes').value.trim();
    if(text.length<8){$('laborError').textContent='Dictate what you did, including the date and times if you know them.';return}
    const button=$('laborReview');button.disabled=true;button.textContent='Interpreting…';
    $('laborError').textContent='';
    let result=null;
    try{
      const response=await fetch('https://sodville-command-api.onrender.com/api/scout/labor/interpret',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({narrative:text,now:new Date().toISOString()}),signal:AbortSignal.timeout(15000)});
      if(response.ok)result=await response.json();
    }catch(error){console.warn('Labor AI extraction unavailable:',error)}
    finally{button.disabled=false;button.textContent='✨ Interpret & review dictation'}
    if(!result){result=localInterpret(text);$('laborError').textContent='AI service is not available yet; local task extraction is shown. Review and complete missing details.'}
    taskEditor(result.tasks||[],result.date,result.source);
    if(!result.tasks?.length){$('laborError').textContent='No tasks detected. Describe the work and try again.';return}
    if(result.questions?.length)$('laborError').textContent=result.questions.join(' ');
    $('laborParsedTasks').scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  $('laborReview').onclick=async()=>{
    const text=$('laborNotes').value.trim();
    if(!extracted.length){await interpret();return}
    const date=$('laborDate').value;
    if(!date){$('laborError').textContent='What date did you perform this work? Enter it above.';return}
    if(extracted.some(x=>!x.description?.trim()||!x.startTime||!x.endTime)){
      $('laborError').textContent='Each task needs its description, actual start time, and finish time. Complete the missing details above.';return;
    }
    const drafts=[];
    for(const task of extracted){
      const start=new Date(date+'T'+task.startTime),end=new Date(date+'T'+task.endTime);
      if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start||end>Date.now()+60000||end-start>86400000){
        $('laborError').textContent='Check the start and finish times for '+task.description+'. Times must be valid, in the past, and in order.';return;
      }
      const overlap=currentLogs().filter(x=>x.approvedAt).some(x=>{const r=range(x);return r&&+start<r[1]&&+end>r[0]});
      if(overlap){$('laborError').textContent='This time overlaps an already approved labor entry. Correct the time before approval.';return}
      drafts.push({id:crypto.randomUUID(),userId:user().id,userName:user().name,category:task.category,notes:task.description.trim(),start:start.toISOString(),end:end.toISOString(),workDate:date,sourceNarrative:text});
    }
    const sorted=[...drafts].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
    if(sorted.some((x,i)=>i>0&&Date.parse(x.start)<Date.parse(sorted[i-1].end))){
      $('laborError').textContent='Two tasks overlap. Correct their times before approval.';return;
    }
    draft=drafts;
    spoken='Review '+drafts.length+' activities. '+drafts.map(x=>x.category+'. '+x.notes+'. '+fmt(x.start)+' to '+fmt(x.end)).join('. ');
    $('laborSummary').textContent=drafts.map((x,i)=>{
      const r=range(x),t=totals(...r);
      return (i+1)+'. '+x.category+' — '+x.notes+'\n'+fmt(x.start)+' to '+fmt(x.end)+'\nGross '+hours(t.gross)+' hr | Scouting overlap '+hours(t.overlap)+' hr | Additional '+hours(t.additional)+' hr';
    }).join('\n\n');
    $('laborWarning').textContent='Only approve if every activity, date, and time is correct. Scouting overlaps are excluded from additional labor totals.';
    $('laborError').textContent='';$('laborForm').hidden=true;$('laborReviewPanel').hidden=false;
    if(!isIOS)speak(spoken);
  };
  $('laborNotes').addEventListener('input',()=>{extracted=[];$('laborParsedTasks').replaceChildren()});
  $('laborReadBack').onclick=()=>speak(spoken);
  if(isIOS){$('laborReadBack').textContent='Review text above';$('laborReadBack').onclick=()=>{$('laborSummary').scrollIntoView({block:'nearest'});};$('laborListenApprove').textContent='Approve using button';$('laborListenApprove').onclick=()=>{$('laborError').textContent='Tap Approve & save after reviewing the details.'};}
  $('laborEdit').onclick=()=>{$('laborForm').hidden=false;$('laborReviewPanel').hidden=true;draft=null};
  function approve(){
    if(!Array.isArray(draft)||!draft.length)return;
    const u=user();
    if(!u||draft.some(x=>x.userId!==u.id)){$('laborError').textContent='Selected scout changed. Review again.';return}
    const now=new Date().toISOString();
    for(const item of draft)db.laborLogs.push({...item,approvedAt:now,createdAt:now,revision:1});
    const count=draft.length;save();history();$('laborReviewPanel').hidden=true;$('laborForm').hidden=false;
    $('laborNotes').value='';$('laborStart').value='';$('laborEnd').value='';$('laborDate').value='';$('laborCategory').value='';
    $('laborParsedTasks').replaceChildren();extracted=[];draft=null;
    $('laborError').style.color='#176333';$('laborError').textContent=count+' approved labor activities saved. Synchronization will run automatically.';
    setTimeout(()=>{$('laborError').style.color='#a32222'},2500);
  }
  $('laborApprove').onclick=approve;
  if(!isIOS)$('laborListenApprove').onclick=()=>{
    $('laborError').textContent='Listening for “approve” or “edit”…';
    listen(text=>{
      const cmd=text.toLowerCase().trim();
      if(/\bapprove\b/.test(cmd)){approve()}
      else if(/\b(edit|correct|change)\b/.test(cmd)){$('laborEdit').click();$('laborError').textContent='Make corrections, then review again.'}
      else $('laborError').textContent='Heard: '+text+'. Say “approve” or press the approval button.';
    },m=>$('laborError').textContent=m);
  };
})();
