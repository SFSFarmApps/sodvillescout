/* Presentation-only polygon miniatures. Does not alter source geometry or records. */
(function(root){'use strict';
// North-up Web Mercator miniatures from the same GeoJSON used by the map.
function thumbnail(geometry){
 const polygons=geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:[];
 const project=point=>{const [lon,lat]=point;if(!Number.isFinite(lon)||!Number.isFinite(lat))throw Error('Invalid polygon coordinate');const phi=Math.max(-85,Math.min(85,lat))*Math.PI/180;return[lon*Math.PI/180,-Math.log(Math.tan(Math.PI/4+phi/2))];};
 try{
  const rings=polygons.flatMap(p=>p.map(r=>r.map(project))),points=rings.flat();if(!points.length)return '';
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const width=maxX-minX,height=maxY-minY;if(!width&&!height)return '';
  const scale=Math.min(50/(width||1e-12),50/(height||1e-12)),left=(64-width*scale)/2,top=(64-height*scale)/2;
  const path=rings.filter(r=>r.length>=3).map(r=>r.map((p,i)=>(i?'L':'M')+(left+(p[0]-minX)*scale).toFixed(2)+' '+(top+(p[1]-minY)*scale).toFixed(2)).join(' ')+'Z').join(' ');
  return '<svg class="sodville-polygon" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path d="'+path+'" fill-rule="evenodd"/></svg>';
 }catch{return '';}
}


root.SodvilleUI=Object.freeze({thumbnail:geometry=>'<span class="sodville-polygon-thumb">'+thumbnail(geometry)+'</span>'});
})(typeof window==='undefined'?globalThis:window);
