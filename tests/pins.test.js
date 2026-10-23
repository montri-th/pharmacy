import test from 'node:test';
import assert from 'node:assert/strict';
import {separatePins,isSourceVisible,detailCandidates,pointCollection,DETAIL_MIN_ZOOM,MAX_DETAIL_PINS} from '../js/pins.js';

const desktop={left:12,right:1012,top:78,bottom:658};
const repeated=(count,x=512,y=368)=>Array.from({length:count},(_,i)=>({id:`pos-${String(i).padStart(4,'0')}`,x,y}));
const markBox=p=>({left:p.x-p.spacing/2,right:p.x+p.spacing/2,top:p.y-p.spacing/2,bottom:p.y+p.spacing/2});
const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
function assertEveryPinPresent(input,output){
 assert.equal(output.length,input.length,'no visible observation may disappear or become an aggregate');
 assert.deepEqual(output.map(p=>p.id).sort(),input.map(p=>p.id).sort());
 assert.equal(new Set(output.map(p=>p.id)).size,input.length);
}
function assertLocalSlots(pins,bounds,maxOffset){
 for(const pin of pins){
  const box=markBox(pin);
  assert.ok(box.left>=bounds.left-1e-8&&box.right<=bounds.right+1e-8);
  assert.ok(box.top>=bounds.top-1e-8&&box.bottom<=bounds.bottom+1e-8);
  assert.ok(Math.hypot(pin.x-pin.anchorX,pin.y-pin.anchorY)<=maxOffset+1e-8,`${pin.id} must stay near its own source anchor`);
  for(const obstacle of bounds.exclusions||[])assert.equal(overlaps(box,obstacle),false);
 }
 for(let i=0;i<pins.length;i++)for(let j=i+1;j<pins.length;j++){
  const pitch=Math.min(pins[i].spacing,pins[j].spacing);
  assert.ok(Math.abs(pins[i].x-pins[j].x)+1e-8>=pitch||Math.abs(pins[i].y-pins[j].y)+1e-8>=pitch,
   `${pins[i].id} and ${pins[j].id} must remain separate local slots`);
 }
}
test('55 co-located observations retain separate identities within a local source-distance cap',()=>{
 const input=repeated(55),output=separatePins(input,desktop,8,{maxOffset:36,minSpacing:.5});
 assertEveryPinPresent(input,output);
 assertLocalSlots(output,desktop,36);
 assert.ok(output.every(p=>p.anchorX===512&&p.anchorY===368));
});

test('dense corner and narrow layouts reduce pitch without spreading across the viewport',()=>{
 const bounds={left:10,right:434,top:10,bottom:300,exclusions:[{left:180,right:190,top:150,bottom:250}]};
 for(const input of [repeated(562,200,220),repeated(55,11,11)]){
  const output=separatePins(input,bounds,8,{maxOffset:24,minSpacing:.125});
  assertEveryPinPresent(input,output);
  assertLocalSlots(output,bounds,24);
  assert.ok(output.every(p=>p.spacing<8));
 }
});

test('placement is deterministic and leaves frozen geographic evidence untouched',()=>{
 const input=Object.freeze(repeated(30,200,200).map(p=>Object.freeze({...p,longitude:100.54321,latitude:13.75432,geometryRole:'host_representative'})));
 const before=JSON.stringify(input),options={maxOffset:24,minSpacing:.5};
 const output=separatePins(input,desktop,8,options);
 assert.deepEqual(separatePins(input,desktop,8,options),output);
 assert.deepEqual(separatePins([...input].reverse(),desktop,8,options),output);
 assert.equal(JSON.stringify(input),before);
 for(const pin of output){assert.equal(pin.anchorX,200);assert.equal(pin.anchorY,200);assert.equal(pin.longitude,100.54321);assert.equal(pin.latitude,13.75432);assert.equal(pin.geometryRole,'host_representative');}
 assertEveryPinPresent(input,output);assertLocalSlots(output,desktop,24);
});

test('source anchors behind panels, UI or outside the usable map are not pulled into view',()=>{
 const bounds={left:5,right:995,top:5,bottom:400,exclusions:[{left:5,right:300,top:5,bottom:70}]};
 const source=[{id:'visible',x:400,y:200},{id:'under-chart',x:400,y:600},{id:'under-toolbar',x:100,y:40},{id:'off-map',x:-50,y:200}];
 const before=JSON.stringify(source),visible=source.filter(point=>isSourceVisible(point,bounds));
 assert.deepEqual(visible.map(p=>p.id),['visible']);
 const output=separatePins(visible,bounds,8,{maxOffset:24});
 assert.deepEqual(output.map(p=>p.id),['visible']);assert.equal(output[0].x,400);assert.equal(output[0].y,200);
 assert.equal(JSON.stringify(source),before);
 assert.throws(()=>separatePins([source[1]],bounds,8,{maxOffset:24,minSpacing:.5}),/too small for individual pins/);
});

test('only rows with a published point become symbols: one feature per row, coordinates unchanged, never aggregated',()=>{
 const rows=[{id:'a',longitude:100.5,latitude:13.7,series:8},{id:'b',longitude:null,latitude:null,series:7},{id:'c',longitude:100.51,latitude:13.71,series:7},{id:'d',longitude:100.5,latitude:13.7,series:1}];
 const fc=pointCollection(rows);
 assert.deepEqual(fc.features.map(f=>f.properties.k),['a','c','d'],'a row without a point is not drawn (it still counts in its area)');
 assert.deepEqual(fc.features[0].geometry.coordinates,[100.5,13.7]);
 assert.deepEqual(fc.features[2].geometry.coordinates,[100.5,13.7],'co-located rows stay two symbols');
 assert.deepEqual(fc.features.map(f=>f.properties.s),[8,7,1]);
});

test('detail pins: nearest the centre first, inside the usable map only, bounded',()=>{
 const rows=Array.from({length:400},(_,i)=>({id:`r${String(i).padStart(3,'0')}`,longitude:100+i/1000,latitude:13.7}));
 const project=([lon])=>({x:Math.round((lon-100)*2000)+10,y:300});
 const picked=detailCandidates(rows,project,{left:0,right:1000,top:0,bottom:600});
 assert.equal(picked.length,MAX_DETAIL_PINS);
 assert.equal(picked[0].row.id,'r245','the row projected nearest the centre comes first');
 assert.ok(picked.every(p=>p.x>=0&&p.x<=1000));
 assert.equal(DETAIL_MIN_ZOOM,15.5);
});
