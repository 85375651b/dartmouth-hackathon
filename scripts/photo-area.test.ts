import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDemoData } from '../src/lib/demo-data.ts';
import { areaRatio, CM2_PER_IN2, envelope, interiorFromInput, pixelScale, planeTransform, polygonArea, project } from '../src/lib/photo-packing/geometry.ts';
import { detectPhoto, type Raster } from '../src/lib/photo-packing/detect.ts';
import { AnalysisRequests, applyAreaPlan, areaInputKey, planAreas, subtract, validateAreaPlan } from '../src/lib/photo-packing/plan.ts';
import type { Analysis, Review } from '../src/lib/photo-packing/types.ts';
function fixture():Raster {
 const width=640,height=400,data=new Uint8ClampedArray(width*height*4);
 for(let i=0;i<data.length;i+=4){data[i]=245;data[i+1]=245;data[i+2]=245;data[i+3]=255;}
 const raster={width,height,data};rect(raster,40,90,340,270,[30,30,35]);rect(raster,60,110,320,250,[155,155,160]);
 rect(raster,390,90,455,160,[30,70,170]);rect(raster,490,100,555,170,[190,70,40]);rect(raster,400,220,530,290,[50,140,60]);return raster;
}
function rect(r:Raster,x0:number,y0:number,x1:number,y1:number,c:number[]){for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*r.width+x)*4;r.data.set([...c,255],i);}}
const base={lengthCm:52,widthCm:28};
function analyzed(){return detectPhoto(fixture(),base,'photo-test');}
function reviewed(a:Analysis):Review[]{return a.items.map((i,index)=>({id:i.id,name:`Object ${index+1}`,category:(index+1) as 1|2|3,confirmed:true,ignored:false}));}
function custom(sizes:number[][],categories:(1|2|3)[]){const a=analyzed();a.interior={lengthCm:20,widthCm:10};a.items=sizes.map(([l,w],index)=>({...a.items[0],id:`object-${index}`,number:index+1,areaCm2:l*w,rawPixelArea:l*w,envelope:{lengthCm:l,widthCm:w,angle:0},suitcaseAreaRatio:l*w/200}));const reviews:Review[]=a.items.map((i,index)=>({id:i.id,name:i.id,category:categories[index],confirmed:true,ignored:false}));return {a,reviews};}
test('exact unit conversions, axis scale, relative areas and invalid values',()=>{
 assert.deepEqual(interiorFromInput('10','5','in'),{lengthCm:25.4,widthCm:12.7});assert.equal(CM2_PER_IN2,6.4516);
 const s=pixelScale({lengthCm:50,widthCm:20},500,100);assert.deepEqual(s,{lengthCmPerPixel:.1,widthCmPerPixel:.2,cm2PerPixel:.020000000000000004});
 assert.equal(areaRatio(100,400),.25);assert.equal(areaRatio(100,50),2);for(const n of ['','0','-1','Infinity','NaN'])assert.throws(()=>interiorFromInput(n,'10','cm'));assert.throws(()=>areaRatio(1,0));
});
test('automatic boundary, true pixel components, masks and ratios on a controlled raster',()=>{
 const a=analyzed();assert.equal(a.items.length,3);assert.equal(a.suitcasePixelArea,260*140);
 assert.deepEqual(a.items.map(i=>i.rawPixelArea),[65*70,65*70,130*70]);
 assert.ok(Math.abs(a.items[0].areaCm2-182)<1e-6);assert.ok(Math.abs(a.items[2].areaCm2-364)<1e-6);
 assert.ok(Math.abs(a.items[0].suitcaseAreaRatio-.125)<1e-8);assert.ok(Math.abs(areaRatio(a.items[2].areaCm2,a.items[0].areaCm2)-2)<1e-8);
 assert.ok(a.items.every(i=>i.id.startsWith('photo-test-object-')));assert.deepEqual(analyzed(),a);
});
test('homography handles mild planar perspective and rejects degenerate/horizon geometry',()=>{
 const q=[{x:10,y:10},{x:210,y:20},{x:200,y:120},{x:15,y:110}],b={lengthCm:40,widthCm:20};const t=planeTransform(q,b);
 assert.ok(Math.abs(polygonArea(q.map(p=>project(t,p)))-800)<1e-6);assert.throws(()=>planeTransform([q[0],q[0],q[1],q[2]],b));assert.throws(()=>project({h:[1,0,0,0,1,0,1,0]}, {x:-2,y:0}));
 const e=envelope([{x:0,y:1},{x:1,y:0},{x:3,y:2},{x:2,y:3}]);assert.ok(Math.abs(e.lengthCm*e.widthCm-4)<1e-7);
});
test('missing interior/items, crop, clutter, low contrast and mismatched geometry reject rather than fabricate',()=>{
 let r=fixture();rect(r,40,90,340,270,[245,245,245]);assert.throws(()=>detectPhoto(r,base,'x'),/interior/);
 r=fixture();rect(r,380,80,570,310,[245,245,245]);assert.throws(()=>detectPhoto(r,base,'x'),/No separate items/);
 r=fixture();rect(r,600,80,640,130,[40,40,40]);assert.throws(()=>detectPhoto(r,base,'x'),/crop/);
 assert.throws(()=>detectPhoto(fixture(),{lengthCm:10,widthCm:10},'x'),/interior/);
 r=fixture();rect(r,0,0,640,10,[0,0,0]);assert.equal(detectPhoto(r,base,'x').items.length,3,'a background edge band must not reject otherwise measurable objects');
 r=fixture();rect(r,40,90,340,270,[150,150,155]);assert.throws(()=>detectPhoto(r,base,'x'),/interior/);
});
test('merged/fragmented regions and multiple possible interiors reject',()=>{
 const r=fixture();rect(r,380,70,570,310,[245,245,245]);rect(r,390,80,530,100,[40,80,180]);rect(r,390,80,410,220,[40,80,180]);assert.throws(()=>detectPhoto(r,base,'x'),/fragmented/);
 const r2=fixture();rect(r2,370,70,630,230,[30,30,35]);rect(r2,390,90,610,210,[155,155,160]);assert.throws(()=>detectPhoto(r2,base,'x'),/More than one/);
});
test('mixed categories share a partial layer and a later full footprint opens a new layer',()=>{
 const {a,reviews}=custom([[10,10],[10,10],[20,10]],[1,2,3]);const d=createDemoData(),p=planAreas(d,d.suitcases[0].id,a,reviews);
 assert.deepEqual(p.layers.map(l=>l.placements.map(i=>i.category)),[[1,2],[3]]);assert.equal(p.layers[0].freeRegions.length,0);validateAreaPlan(d,p);assert.deepEqual(planAreas(d,d.suitcases[0].id,a,reviews),p);
});
test('tries remaining same-category entries, allows in-plane rotation, distinguishes shape from area',()=>{
 const {a,reviews}=custom([[21,1],[5,15],[5,10],[5,10]],[1,1,1,2]);const d=createDemoData(),p=planAreas(d,d.suitcases[0].id,a,reviews);
 assert.match(p.unplaced[0].reason,/empty layer/);assert.equal(p.unplaced.length,1);assert.ok(p.layers.flatMap(l=>l.placements).some(i=>i.rotated));
 assert.deepEqual(p.layers.flatMap(l=>l.placements.map(i=>i.category)),[1,1,2]);
 const free=subtract([{x:0,y:0,lengthCm:20,widthCm:10}],{x:5,y:2,lengthCm:4,widthCm:3});assert.equal(free.reduce((s,r)=>s+r.lengthCm*r.widthCm,0),188);
});
test('Apply preserves unrelated objects, requires explicit association and invalidates on source changes',()=>{
 const {a,reviews}=custom([[10,10],[10,10]],[1,2]);const d=createDemoData();let p=planAreas(d,d.suitcases[0].id,a,reviews);
 const original=structuredClone(d),next=applyAreaPlan(d,p);assert.deepEqual(d,original);assert.deepEqual(next.packingPlan.assignments,d.packingPlan.assignments);assert.strictEqual(next.items,d.items);assert.strictEqual(next.trip,d.trip);assert.strictEqual(next.unpackingPlan,d.unpackingPlan);
 assert.deepEqual(next.suitcases[0].interiorFootprintCm,a.interior);assert.ok(next.packingPlan.areaPlans?.length);assert.equal(next.packingPlan.areaPlans![0].inputKey,areaInputKey(next,p.suitcaseId,a,reviews));
 const id=d.items.find(i=>!i.carryOnRequired&&i.cleanliness!=='dirty')!.id;reviews[0].itemId=id;p=planAreas(d,d.suitcases[0].id,a,reviews);const linked=applyAreaPlan(d,p);assert.equal(linked.packingPlan.assignments.filter(i=>i.itemId===id).length,1);
 const changed=structuredClone(d);changed.items.find(i=>i.id===id)!.name='changed';assert.throws(()=>applyAreaPlan(changed,p),/stale/);
 const changedReviews=structuredClone(p);changedReviews.reviews[0].category=3;assert.throws(()=>applyAreaPlan(d,changedReviews),/stale/);
});
test('carry-on and known fragile restrictions survive; unmatched photos never create stock measurements',()=>{
 const {a,reviews}=custom([[20,10],[20,10]],[1,2]),d=createDemoData();reviews[0].itemId=d.items.find(i=>i.carryOnRequired)!.id;
 let p=planAreas(d,d.suitcases[0].id,a,reviews);assert.match(p.unplaced[0].reason,/carry-on/);
 const source=d.items.find(i=>!i.carryOnRequired)!;source.fragility='fragile';reviews[0].itemId=source.id;p=planAreas(d,d.suitcases[0].id,a,reviews);assert.equal(p.layers.length,1);assert.match(p.unplaced[0].reason,/fragile/);
});
test('unreviewed/duplicate associations and malformed independent placements cannot Apply',()=>{
 const {a,reviews}=custom([[10,10],[10,10]],[1,2]),d=createDemoData();reviews[0].confirmed=false;assert.throws(()=>planAreas(d,d.suitcases[0].id,a,reviews),/confirm/);reviews[0].confirmed=true;
 const p=planAreas(d,d.suitcases[0].id,a,reviews);for(const mutate of [(q:typeof p)=>{q.layers[0].placements[1].x=0;},(q:typeof p)=>{q.layers[0].placements[0].x=99;},(q:typeof p)=>{q.layers[0].placements[0].lengthCm=NaN;}]){const q=structuredClone(p);mutate(q);assert.throws(()=>validateAreaPlan(d,q));}
 reviews.forEach(r=>r.itemId=d.items[0].id);assert.throws(()=>planAreas(d,d.suitcases[0].id,a,reviews),/only one/);
});
test('new decode, dimension change, reset and unmount cancel old asynchronous results',()=>{
 const r=new AnalysisRequests(),first=r.next(),second=r.next();assert.equal(r.current(first),false);assert.equal(r.current(second),true);r.next();assert.equal(r.current(second),false);
 const d=createDemoData();assert.equal(d.packingPlan.areaPlans,undefined);
});
test('one unified section, with no old manual or depth-only controls',()=>{
 const dashboard=readFileSync(new URL('../src/components/PackWiseDashboard.tsx',import.meta.url),'utf8'),ui=readFileSync(new URL('../src/components/photo-packing/PhotoAreaPacking.tsx',import.meta.url),'utf8');
 assert.match(dashboard,/<PhotoAreaPacking/);for(const old of ['PhotoMeasurement','PairedPhotoReview','LayerPackingPlanner'])assert.ok(!dashboard.includes(old));
 for(const old of ['thickness','depthCm','heightCm','volumeLiters','reference-width','endpoint'])assert.ok(!ui.includes(old),old);
 assert.match(ui,/new Worker/);assert.match(ui,/requests.current.current\(ticket\)/);
});
function polygon(r:Raster,points:{x:number;y:number}[],color:number[]){
 for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){
  let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>y+.5)!==(b.y>y+.5)&&(x+.5)<(b.x-a.x)*(y+.5-a.y)/(b.y-a.y)+a.x)inside=!inside;}
  if(inside)r.data.set([...color,255],(y*r.width+x)*4);
 }
}
test('detector supports a portrait/rotated capture without reusing raw image axes',()=>{
 const original=fixture(),r:Raster={width:original.height,height:original.width,data:new Uint8ClampedArray(original.data.length)};
 for(let y=0;y<original.height;y++)for(let x=0;x<original.width;x++)r.data.set(original.data.subarray((y*original.width+x)*4,(y*original.width+x)*4+4),(x*r.width+(original.height-1-y))*4);
 const a=detectPhoto(r,base,'rotated');assert.equal(a.items.length,3);assert.ok(Math.abs(a.items.reduce((s,i)=>s+i.areaCm2,0)-728)<1e-6);assert.ok(Math.abs(a.axisScale.lengthCmPerPixel-.2)<1e-8);
});
test('automatic mild-perspective quad fitting maps individual pixels; strong tilt is rejected',()=>{
 const r=fixture();rect(r,40,90,340,270,[30,30,35]);polygon(r,[{x:60,y:110},{x:320,y:120},{x:310,y:250},{x:65,y:245}],[155,155,160]);
 const a=detectPhoto(r,base,'perspective');assert.equal(a.items.length,3);assert.ok(Math.abs(a.items[0].areaCm2-a.items[1].areaCm2)>1);assert.equal(a.items[0].rawPixelArea,a.items[1].rawPixelArea);
 const strong=fixture();rect(strong,40,90,340,270,[30,30,35]);polygon(strong,[{x:60,y:110},{x:320,y:110},{x:260,y:250},{x:110,y:250}],[155,155,160]);assert.throws(()=>detectPhoto(strong,base,'strong'),/interior/);
});
test('invalid numeric geometry, transparent cutouts, free-region omissions and stale assignments fail closed',()=>{
 const r=fixture();r.data[3]=0;assert.throws(()=>detectPhoto(r,base,'alpha'),/opaque/);assert.throws(()=>detectPhoto(fixture(),{lengthCm:Infinity,widthCm:20},'bad'),/finite/);
 const {a,reviews}=custom([[5,5]],[1]),d=createDemoData(),p=planAreas(d,d.suitcases[0].id,a,reviews);
 const bad=structuredClone(p);bad.layers[0].freeRegions=[];assert.throws(()=>validateAreaPlan(d,bad),/accounting/);
 const changed=structuredClone(d);changed.packingPlan.assignments.pop();assert.throws(()=>applyAreaPlan(changed,p),/stale/);
 const badAnalysis=structuredClone(a);badAnalysis.items[0].areaCm2=NaN;assert.throws(()=>planAreas(d,d.suitcases[0].id,badAnalysis,reviews),/finite/);
});
