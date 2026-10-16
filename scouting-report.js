/* Shared readable tank mixes and checked-field scouting reports. */
(function(root){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const units={gal1ac1:'gal/ac',floz1ac1:'fl oz/ac',oz1ac1:'oz/ac',lb1ac1:'lb/ac',lbs1ac1:'lb/ac',qt1ac1:'qt/ac',pt1ac1:'pt/ac',l1ha1:'L/ha',kg1ha1:'kg/ha',ml1ha1:'mL/ha',gal:'gal',floz:'fl oz'};
  function readableUnit(value){
    const raw=String(value??'').trim();
    return units[raw.toLowerCase().replace(/[^a-z0-9]/g,'')]||raw;
  }
  function number(value){
    if(value===null||value===undefined||value==='')return '';
    const n=Number(value);return Number.isFinite(n)?String(n):'';
  }
  function productText(product){
    if(typeof product==='string')return product;
    if(!product||typeof product!=='object')return '';
    const name=product.product_name||product.productName||product.name||product.chemical||
      (typeof product.product==='string'?product.product:product.product?.name)||'Unnamed product';
    const rate=product.rate??product.amount;
    const amount=typeof rate==='object'&&rate!==null?(rate.value??rate.valueAsDouble):rate;
    const unit=product.rate_unit??product.rateUnit??product.unit??product.units??rate?.unitId??'';
    return [name,number(amount),readableUnit(unit)].filter(v=>v!=='').join(' ');
  }
  function formatTankMix(task){
    const values=[task?.tankMix,task?.tankmix,task?.mix,task?.products,task?.chemicals,
      task?.application?.tankMix,task?.application?.products];
    const value=values.find(v=>v!==undefined&&v!==null&&v!==''&&(!Array.isArray(v)||v.length));
    if(value===undefined)return 'Not entered';
    if(typeof value==='string')return value;
    if(Array.isArray(value))return value.map(productText).filter(Boolean).join(' + ')||'Not entered';
    if(typeof value!=='object')return 'Not entered';
    const components=value.components||value.products||value.chemicals;
    if(Array.isArray(components)){
      const recipe=components.map(productText).filter(Boolean).join(' + ');
      const rate=number(value.solutionRate??value.solution_rate);
      const unit=readableUnit(value.solutionRateUnit??value.solution_rate_unit);
      const heading=[value.name,rate?[rate,unit].filter(Boolean).join(' ')+' spray volume':''].filter(Boolean).join(' — ');
      return [heading,recipe].filter(Boolean).join(': ')||'Not entered';
    }
    if(value.name||value.product_name||value.productName)return productText(value);
    // Older keyed product lists: inspect named product objects, never IDs/metadata.
    const products=Object.values(value).filter(x=>x&&typeof x==='object'&&!Array.isArray(x)&&
      (x.name||x.product_name||x.productName||x.chemical||x.product));
    return products.map(productText).filter(Boolean).join(' + ')||'Not entered';
  }
  const date=value=>new Date(value).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  const duration=ms=>{const minutes=Math.max(0,Math.round(ms/60000));return Math.floor(minutes/60)+' hr '+minutes%60+' min';};
  function buildModel({db,fields,from,to,now=new Date()}){
    const start=new Date(from+'T00:00:00'),end=new Date(to+'T23:59:59.999');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||!Number.isFinite(+start)||!Number.isFinite(+end)||start>end)throw Error('Choose a valid From and Through date.');
    const byId=new Map((fields?.features||[]).map(f=>[String(f.properties.FIELD_ID||f.properties.fieldId),f.properties]));
    const uniqueChecked=new Set(),uniqueRecords=new Set(),entities=new Map();
    let totalMs=0,observations=0,tasks=0,unallocatedMs=0;
    const sessions=(db.sessions||[]).filter(s=>new Date(s.start)>=start&&new Date(s.start)<=end).sort((a,b)=>new Date(a.start)-new Date(b.start)).map(session=>{
      const finish=session.end?new Date(session.end):new Date(now);
      const ms=Math.max(0,Number(finish)-Number(new Date(session.start)))||0;
      totalMs+=ms;
      const belongs=x=>x.sessionId?x.sessionId===session.id:
        x.time&&new Date(x.time)>=new Date(session.start)&&new Date(x.time)<=finish&&
        (!x.userId||!session.userId||x.userId===session.userId);
      const obs=(db.observations||[]).filter(belongs),work=(db.tasks||[]).filter(belongs);
      observations+=obs.length;tasks+=work.length;
      const checked=[...new Set((Array.isArray(session.checkedFieldIds)?session.checkedFieldIds:[]).filter(x=>x!==null&&x!==undefined&&String(x)!=='').map(String))];
      checked.forEach(id=>uniqueChecked.add(id));
      const recordIds=[...new Set([...obs,...work].filter(x=>x.fieldId!==null&&x.fieldId!==undefined&&String(x.fieldId)!=='').map(x=>String(x.fieldId)))];
      recordIds.forEach(id=>uniqueRecords.add(id));
      const confirmed=new Set(checked),ids=[...checked,...recordIds.filter(id=>!confirmed.has(id))];
      const details=ids.map(id=>({id,checked:confirmed.has(id),properties:byId.get(id)||{},observations:obs.filter(x=>String(x.fieldId)===id),tasks:work.filter(x=>String(x.fieldId)===id)}));
      const allocations=[];
      if(checked.length&&session.allocationMethod==='equal-per-checked-field'){
        const groups=new Map();
        for(const id of checked){const p=byId.get(id);const entity=p?(p.CLIENT_NAM||p.clientName||'Unassigned entity'):'Unmatched field';groups.set(entity,(groups.get(entity)||0)+1);}
        for(const [entity,count] of groups){const amount=ms*count/checked.length;allocations.push({entity,count,percentage:100*count/checked.length,ms:amount});const sum=entities.get(entity)||{entity,count:0,ms:0};sum.count+=count;sum.ms+=amount;entities.set(entity,sum);}
      }else unallocatedMs+=ms;
      return {session,ms,checked,details,allocations};
    });
    return {sessions,totalMs,observations,tasks,checkedCount:uniqueChecked.size,recordCount:uniqueRecords.size,entities:[...entities.values()],unallocatedMs};
  }
  function allocationTable(rows,summary=false){
    if(!rows.length)return '';
    return '<table style="width:100%;border-collapse:collapse"><thead><tr><th align="left">Farm entity</th><th>Checked '+(summary?'field visits':'fields')+'</th>'+(summary?'':'<th>Share</th>')+'<th>Allocated hours</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+escape(r.entity)+'</td><td align="center">'+r.count+'</td>'+(summary?'':'<td align="center">'+r.percentage.toFixed(1)+'%</td>')+'<td align="center">'+(r.ms/3600000).toFixed(2)+'</td></tr>').join('')+'</tbody></table>';
  }
  function renderReport(input){
    const m=buildModel(input);
    if(!m.sessions.length)return '<p><b>No scouting sessions were found in that date range on this device.</b></p>';
    const sections=m.sessions.map(({session,ms,checked,details,allocations})=>{
      const fieldHtml=details.map(f=>{
        const p=f.properties;
        const name=p.FIELD_NAME||p.fieldName||'Unmatched field '+f.id;
        const context=[p.CLIENT_NAM||p.clientName,p.FARM_NAME||p.farmName].filter(Boolean).join(' • ');
        const obs=f.observations.map(o=>'<div class="item"><b>Observation</b> — Weeds: '+escape(o.weed||'—')+'; Insects: '+escape(o.insect||'—')+(o.notes?'<br>'+escape(o.notes):'')+'</div>').join('');
        const work=f.tasks.map(t=>'<div class="item"><b>'+escape(t.type||'Task')+': '+escape(t.name||'')+'</b> — '+escape(t.priority||'Normal')+(String(t.type||'').toLowerCase()==='application'?'<br>Tank mix: '+escape(formatTankMix(t)):'')+(t.notes?'<br>'+escape(t.notes):'')+'</div>').join('');
        return '<div style="margin:10px 0 10px 14px;break-inside:avoid"><b>'+escape(name)+'</b><div class="muted">'+escape(context)+'</div><div><b>'+ (f.checked?'Checked / scouted':'Task or observation recorded — not confirmed checked')+'</b></div>'+obs+work+(!obs&&!work?'<p class="muted">Checked; no observations or tasks entered.</p>':'')+'</div>';
      }).join('');
      return '<section style="border:1px solid #d7ddd8;border-radius:8px;padding:11px;margin:12px 0"><h3>'+escape(date(session.start))+'</h3><p><b>Scout:</b> '+escape(session.userName||'Not recorded')+' &nbsp; <b>Start:</b> '+escape(date(session.start))+' &nbsp; <b>End:</b> '+escape(session.end?date(session.end):'In progress')+' &nbsp; <b>Time:</b> '+duration(ms)+'</p><p><b>Fields confirmed checked:</b> '+checked.length+'</p>'+(!checked.length?'<p class="muted">No checked-field selection was saved for this session. Fields below have task or observation records only.</p>':'')+allocationTable(allocations)+fieldHtml+(!fieldHtml?'<p class="muted">No field records entered.</p>':'')+'</section>';
    }).join('');
    return '<hr><h1>Sodville Scouting & Labor/Management Log</h1><p><b>Reporting period:</b> '+escape(input.from)+' through '+escape(input.to)+'</p><div class="grid2"><div><b>Scouting sessions:</b> '+m.sessions.length+'<br><b>Unique fields confirmed checked:</b> '+m.checkedCount+'<br><b>Unique fields with observations/tasks:</b> '+m.recordCount+'</div><div><b>Total observations:</b> '+m.observations+'<br><b>Total tasks identified:</b> '+m.tasks+'</div></div><h2>Total Scouting / Management Time: '+duration(m.totalMs)+'</h2>'+sections+'<hr><h2>Period Summary — Time by Farm Entity</h2>'+allocationTable(m.entities,true)+(m.unallocatedMs?'<p><b>Time without a saved field allocation:</b> '+(m.unallocatedMs/3600000).toFixed(2)+' hours</p>':'')+'<p><b>Total documented scouting/management time:</b> '+duration(m.totalMs)+'<br><b>Unique fields confirmed checked:</b> '+m.checkedCount+'<br><b>Observations recorded:</b> '+m.observations+'<br><b>Tasks identified:</b> '+m.tasks+'</p><p class="muted">The timer covers the entire scouting trip. For sessions saved with field selection, time is allocated equally across checked fields and totaled by farm entity; these are estimated allocations, not measured time at each field. Older sessions without saved selections remain unallocated. Hours are rounded for display.</p><div class="noprint" style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0"><button type="button" class="primary" onclick="scoutingReportAction(\'print\')">Print / Save PDF</button><button type="button" onclick="scoutingReportAction(\'download\')">Download Report</button></div><p id="scoutingExportStatus" class="noprint" role="status"></p>';
  }
  const api={formatTankMix,readableUnit,productText,buildModel,renderReport};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SodvilleReports=api;
})(typeof window==='object'?window:globalThis);
