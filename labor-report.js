/* Read-only Labor Log report calculations and presentation. */
(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const day=d=>{const x=new Date(d);return Number.isFinite(+x)?[x.getFullYear(),String(x.getMonth()+1).padStart(2,'0'),String(x.getDate()).padStart(2,'0')].join('-'):'';};
 const span=x=>{const a=Date.parse(x.start),b=Date.parse(x.end);return Number.isFinite(a)&&Number.isFinite(b)&&b>a?[a,b]:null;};
 const fmt=d=>new Date(d).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});
 function overlap(start,end,sessions){
  const clips=sessions.map(span).filter(Boolean).map(([a,b])=>[Math.max(a,start),Math.min(b,end)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
  let total=0,last=start;for(const [a,b]of clips){total+=Math.max(0,b-Math.max(a,last));last=Math.max(last,b);}return total;
 }
 function build({logs,sessions,scout,from,to,category='',layout='detail'}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw Error('Choose a valid From and Through date.');
  if(!scout?.id)throw Error('Select a scout before building a report.');
  const scouting=(sessions||[]).filter(s=>s.userId===scout.id);
  const rows=(logs||[]).filter(x=>x.userId===scout.id&&x.approvedAt&&span(x)&&day(x.start)>=from&&day(x.start)<=to&&(!category||(x.category||'Other')===category)).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)).map(x=>{
   const [a,b]=span(x),gross=(b-a)/3600000,scoutingHours=overlap(a,b,scouting)/3600000;
   return {date:day(x.start),scout:x.userName||scout.name||'',category:x.category||'Other',start:fmt(x.start),end:fmt(x.end),gross,scouting:scoutingHours,additional:Math.max(0,gross-scoutingHours),description:x.notes||'',approved:fmt(x.approvedAt)};
  });
  const totals={gross:0,scouting:0,additional:0},groups=new Map();
  for(const r of rows){let g=groups.get(r.category)||{category:r.category,activities:0,gross:0,scouting:0,additional:0};g.activities++;for(const k of ['gross','scouting','additional']){totals[k]+=r[k];g[k]+=r[k];}groups.set(r.category,g);}
  return {from,to,scout:{id:scout.id,name:scout.name||'Unknown'},category,layout:layout==='summary'?'summary':'detail',rows,groups:[...groups.values()].sort((a,b)=>a.category.localeCompare(b.category)),...totals};
 }
 function table(data){
  const summary=data.layout==='summary';
  const headers=summary?['Activity category','Activities','Gross hours','Scouting overlap','Additional hours']:['Date','Category','Start','End','Gross hours','Scouting overlap','Additional hours','Activity'];
  const values=summary?data.groups.map(x=>[x.category,x.activities,x.gross.toFixed(2),x.scouting.toFixed(2),x.additional.toFixed(2)]):data.rows.map(x=>[x.date,x.category,x.start,x.end,x.gross.toFixed(2),x.scouting.toFixed(2),x.additional.toFixed(2),x.description]);
  return '<div class="table-scroll"><table><thead><tr>'+headers.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+values.map(row=>'<tr>'+row.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 }
 function body(data){
  return '<h1>Labor &amp; Management Report</h1><p class="muted">Sodville Farm Services · '+(data.layout==='summary'?'Category summary':'Detailed activity log')+'</p><p><b>Scout:</b> '+esc(data.scout.name)+'<br><b>Period:</b> '+esc(data.from)+' through '+esc(data.to)+(data.category?'<br><b>Category:</b> '+esc(data.category):'')+'</p><div class="labor-report-metrics grid2"><p><b>Approved activities</b><br>'+data.rows.length+'</p><p><b>Gross logged hours</b><br>'+data.gross.toFixed(2)+'</p><p><b>Scouting overlap hours</b><br>'+data.scouting.toFixed(2)+'</p><p><b>Additional labor hours</b><br>'+data.additional.toFixed(2)+'</p></div>'+table(data)+'<p class="muted">Only approved labor entries for the selected scout are included. Scouting overlap is deducted from additional labor hours to avoid double-counting scouting time. Hours are rounded for display. Review before using for FSA or payroll documentation.</p>';
 }
 function csv(data){
  const summary=data.layout==='summary',cols=summary?['category','activities','gross','scouting','additional']:['date','scout','category','start','end','gross','scouting','additional','description','approved'];
  const numeric=new Set(['activities','gross','scouting','additional']);
  return '\uFEFF'+[cols.join(','),...(summary?data.groups:data.rows).map(row=>cols.map(k=>{let v=numeric.has(k)&&k!=='activities'?row[k].toFixed(2):String(row[k]??'');if(!numeric.has(k)&&/^[\s]*[=+@-]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}).join(','))].join('\r\n');
 }
 const api={build,body,csv,day};if(typeof module==='object'&&module.exports)module.exports=api;else root.SodvilleLaborReport=api;
})(typeof window==='object'?window:globalThis);
