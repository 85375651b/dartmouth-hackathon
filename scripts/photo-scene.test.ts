import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPhoto, type Raster } from '../src/lib/photo-packing/detect.ts';
import { detectScene } from '../src/lib/photo-packing/scene.ts';
import { polygonArea } from '../src/lib/photo-packing/geometry.ts';
function scene():Raster {
 const width=700,height=650,data=new Uint8ClampedArray(width*height*4),r={width,height,data};
 paint(r,0,0,width,height,[183,149,111]);paint(r,0,0,width,30,[164,161,158]);paint(r,0,30,width,52,[55,40,30]);paint(r,0,0,28,height,[75,49,32]);
 paint(r,60,70,245,350,[23,23,26]);paint(r,245,70,430,350,[23,23,26]);paint(r,80,90,225,330,[118,116,119]);paint(r,260,90,405,330,[118,116,119]);paint(r,218,175,270,240,[118,116,119]);
 paint(r,480,100,575,205,[35,85,180]);paint(r,495,265,600,335,[195,45,55]);paint(r,90,425,215,535,[220,218,210]);return r;
}
function paint(r:Raster,x0:number,y0:number,x1:number,y1:number,color:number[]){for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)r.data.set([...color,255],(y*r.width+x)*4);}
const dimensions={lengthCm:48,widthCm:30};
test('wall, skirting and connected clamshell halves produce a reviewable single-opening reference',()=>{
 const r=scene(),a=detectScene(r,dimensions,'scene');assert.equal(a.excludedBoundaries?.length,1);assert.ok(a.items.length>=3&&a.items.length<=8);
 assert.ok(a.suitcasePixelArea<45_000,'must not calibrate against the combined two-half footprint');assert.ok(a.reviewNotes?.some(n=>n.includes('clamshell')));
 assert.ok(a.items.every(i=>i.areaKind==='outline'&&Number.isFinite(i.areaCm2)&&i.areaCm2>0));
 assert.deepEqual(detectScene(r,dimensions,'scene'),a,'fallback must be deterministic');
 for(const item of a.items)assert.ok(item.areaCm2<=item.envelope.lengthCm*item.envelope.widthCm+1e-6);
});
test('scene detection rejects an unframed folded cloth as a suitcase reference',()=>{
 const r=scene();paint(r,60,65,440,360,[183,149,111]);assert.throws(()=>detectScene(r,dimensions,'no-case'),/suitcase|opening/i);
});
test('existing opaque-image and numeric guards still run before scene fallback',()=>{
 const r=scene();assert.throws(()=>detectPhoto(r,{lengthCm:NaN,widthCm:30},'bad'),/finite/);r.data[3]=0;assert.throws(()=>detectPhoto(r,dimensions,'alpha'),/opaque/);
 const a=detectScene(scene(),dimensions,'ratios');for(const item of a.items)assert.ok(Math.abs(item.suitcaseAreaRatio-item.areaCm2/(48*30))<1e-9);assert.ok(polygonArea(a.suitcaseBoundary)>0);
});
