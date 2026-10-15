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
          <option>Equipment Management</option><option>Employee Management</option><option>Field Work</option>
          <option>Marketing</option><option>Financial Management</option><option>Landowner Relations</option>
          <option>FSA Compliance</option><option>Cattle Management</option><option>Office / Administration</option><option>Other</option>
        </select>
      </label>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px">
        <label>Started<input type="datetime-local" id="laborStart" style="display:block;width:100%;margin-top:5px"></label>
        <label>Finished<input type="datetime-local" id="laborEnd" style="display:block;width:100%;margin-top:5px"></label>
      </div>
      <label style="display:block;margin-top:12px">What did you do?
        <textarea id="laborNotes" rows="3" style="display:block;width:100%;margin-top:5px" placeholder="Example: Worked on equipment repairs and met with employees about tomorrow's field work."></textarea>
      </label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
        <button type="button" id="laborDictate">🎙 Dictate notes</button>
        <button type="button" id="laborReview" style="background:#173b25;color:#fff;font-weight:800">Review time</button>
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
    $('laborStart').value=localTime(Date.now()-3600000);
    $('laborEnd').value=localTime(Date.now());
    $('laborNotes').value='';$('laborCategory').value='Equipment Management';
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
  $('laborReview').onclick=()=>{
    const start=new Date($('laborStart').value).getTime(),end=new Date($('laborEnd').value).getTime();
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start){$('laborError').textContent='Enter valid start and finish times.';return}
    if(end>Date.now()+60000){$('laborError').textContent='Finish time cannot be in the future.';return}
    if(end-start>24*3600000){$('laborError').textContent='A single entry cannot exceed 24 hours. Split the work into separate entries.';return}
    if(!user()?.id){$('laborError').textContent='Select a scout first.';return}
    const overlaps=currentLogs().filter(x=>x.approvedAt).some(x=>{const r=range(x);return r&&start<r[1]&&end>r[0]});
    if(overlaps){$('laborError').textContent='This time overlaps another approved labor entry. Edit the times to avoid double-counting.';return}
    const category=$('laborCategory').value,notes=$('laborNotes').value.trim();
    if(!notes){$('laborError').textContent='Describe the work completed before approval.';return}
    const t=totals(start,end);
    draft={id:crypto.randomUUID(),userId:user().id,userName:user().name,category,notes,start:new Date(start).toISOString(),end:new Date(end).toISOString()};
    spoken=category+' for '+user().name+'. From '+fmt(draft.start)+' to '+fmt(draft.end)+'. '+notes+
      '. Total '+hours(t.gross)+' hours. '+hours(t.overlap)+' hours overlap the scouting timer. Additional labor '+hours(t.additional)+' hours. Say approve or press Approve and save.';
    $('laborSummary').textContent=category+' — '+fmt(draft.start)+' to '+fmt(draft.end)+'\n'+notes+
      '\nGross: '+hours(t.gross)+' hr | Scouting overlap: '+hours(t.overlap)+' hr | Additional: '+hours(t.additional)+' hr';
    $('laborWarning').textContent=t.overlap?'Scouting overlap is excluded from additional labor totals.':'No scouting overlap found for this time interval.';
    $('laborError').textContent='';$('laborForm').hidden=true;$('laborReviewPanel').hidden=false;
    if(!isIOS)speak(spoken);
  };
  $('laborReadBack').onclick=()=>speak(spoken);
  if(isIOS){$('laborReadBack').textContent='Review text above';$('laborReadBack').onclick=()=>{$('laborSummary').scrollIntoView({block:'nearest'});};$('laborListenApprove').textContent='Approve using button';$('laborListenApprove').onclick=()=>{$('laborError').textContent='Tap Approve & save after reviewing the details.'};}
  $('laborEdit').onclick=()=>{$('laborForm').hidden=false;$('laborReviewPanel').hidden=true;draft=null};
  function approve(){
    if(!draft)return;
    const u=user();
    if(!u||u.id!==draft.userId){$('laborError').textContent='The selected scout changed. Review this entry again.';return}
    const now=new Date().toISOString();
    db.laborLogs.push({...draft,approvedAt:now,createdAt:now,revision:1});
    save();history();$('laborReviewPanel').hidden=true;$('laborForm').hidden=false;
    $('laborNotes').value='';$('laborStart').value=localTime(Date.now()-3600000);$('laborEnd').value=localTime(Date.now());
    $('laborError').style.color='#176333';$('laborError').textContent='Approved and saved. Synchronization will run automatically.';
    setTimeout(()=>{$('laborError').style.color='#a32222'},2500);
    draft=null;
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
