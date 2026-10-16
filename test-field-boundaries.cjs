const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'land/fields.js'),'utf8'),context);
const fields = context.window.SODVILLE_LAND_FIELDS;
const flat = fields.features.find(f=>f.properties.FIELD_ID==='8fbdfa87-8c6a-418e-add2-7ac09856336c');
function inRing([x,y],ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
  }
  return inside;
}
function svgEvenOddHit(point,geometry) {
  return geometry.coordinates.flat().reduce((n,ring)=>n+Number(inRing(point,ring)),0)%2===1;
}
test('Headquarters Flat interior is selectable under Leaflet SVG evenodd fill',()=>{
  assert.equal(flat.geometry.coordinates.length,1);
  assert.equal(svgEvenOddHit([-97.55,27.95],flat.geometry),true);
  const duplicate={coordinates:[flat.geometry.coordinates[0],flat.geometry.coordinates[0]]};
  assert.equal(svgEvenOddHit([-97.55,27.95],duplicate),false,'duplicate reproduces the original dead interior');
  assert.equal(flat.properties.ACRES,329.6752202105078);
});
test('approved set retains all 116 fields with unique polygon parts',()=>{
  assert.equal(fields.features.length,116);
  assert.equal(new Set(fields.features.map(f=>f.properties.FIELD_ID)).size,116);
  for(const f of fields.features)if(f.geometry.type==='MultiPolygon') {
    assert.equal(new Set(f.geometry.coordinates.map(JSON.stringify)).size,f.geometry.coordinates.length,f.properties.FIELD_NAME);
  }
});
test('Scout fallback also has a selectable Headquarters Flat and loads fresh shared data',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  const script=html.match(/<script>window\.SODVILLE_FIELDS = ([\s\S]*?)<\/script>/)[0].replace(/^<script>|<\/script>$/g,'');
  const fallback={window:{}};
  vm.runInNewContext(script,fallback);
  const f=fallback.window.SODVILLE_FIELDS.features.find(f=>f.properties.FIELD_ID===flat.properties.FIELD_ID);
  assert.equal(svgEvenOddHit([-97.55,27.95],f.geometry),true);
  assert.match(html,/fields\.js\?build=20261016-headquarters-fix/);
  for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
});
