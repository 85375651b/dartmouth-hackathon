import { areaRatio, envelope, hull, pixelScale, planeTransform, polygonArea, positive, project, type Footprint, type Point } from './geometry.ts';
import type { Analysis } from './types.ts';
export interface Raster { width:number; height:number; data:Uint8ClampedArray }
const colorDistance=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const RETAKE=' Retake straight from above on a plain contrasting surface, with an empty, clearly framed interior and separated items.';
interface Component { pixels:number[]; outline:Point[]; border:boolean }
/** 4-connected regions. No semantic labels or learned confidence are fabricated. */
function components(width:number,height:number,accept:(a:number,b:number)=>boolean):{regions:Component[];labels:Int32Array} {
  const labels=new Int32Array(width*height).fill(-1),regions:Component[]=[];
  for(let seed=0;seed<labels.length;seed++) {
    if(labels[seed]!==-1)continue;
    const id=regions.length,queue=[seed],outline:Point[]=[];labels[seed]=id;let border=false;
    for(let cursor=0;cursor<queue.length;cursor++) {
      const i=queue[cursor],x=i%width,y=Math.floor(i/width);let edge=false;
      if(x===0||y===0||x===width-1||y===height-1)border=true;
      for(const j of [x>0?i-1:-1,x<width-1?i+1:-1,y>0?i-width:-1,y<height-1?i+width:-1]) {
        if(j<0||!accept(seed,j)){edge=true;continue;}
        if(labels[j]===-1){labels[j]=id;queue.push(j);}
      }
      if(edge)outline.push({x,y});
    }
    regions.push({pixels:queue,outline,border});
  }
  return {regions,labels};
}
function pixelOutline(points:Point[]):Point[] {
  // Pixel centers alone underestimate envelopes; include the full pixel cells.
  return hull(points.flatMap(p=>[{x:p.x,y:p.y},{x:p.x+1,y:p.y},{x:p.x+1,y:p.y+1},{x:p.x,y:p.y+1}]));
}
/** Restricted, image-grounded CV. Designed to fail closed outside controlled captures. */
export function detectPhoto(raster:Raster,interior:Footprint,id:string,original={width:raster.width,height:raster.height}):Analysis {
  const {width:w,height:h,data}=raster,n=w*h;positive(interior.lengthCm);positive(interior.widthCm);positive(interior.lengthCm*interior.widthCm);
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<80||h<80||n>1_000_000||data.length!==n*4)throw new Error('Use a clear photograph at least 80 pixels on each side.');
  const rgb=(i:number)=>[data[4*i],data[4*i+1],data[4*i+2]];
  const border:number[][]=[];for(let x=0;x<w;x+=Math.max(1,Math.floor(w/80))){border.push(rgb(x),rgb((h-1)*w+x));}for(let y=0;y<h;y+=Math.max(1,Math.floor(h/80)))border.push(rgb(y*w),rgb(y*w+w-1));
  const background=[0,1,2].map(c=>[...border.map(p=>p[c])].sort((a,b)=>a-b)[Math.floor(border.length/2)]);
  if(border.filter(p=>colorDistance(p,background)<35).length/border.length<0.85)throw new Error('The background or photo edges are too cluttered.'+RETAKE);
  if(data.some((v,i)=>i%4===3&&v!==255))throw new Error('Use an opaque photograph, not a transparent cutout.');
  const bgLike=Uint8Array.from({length:n},(_,i)=>colorDistance(rgb(i),background)<35?1:0);
  const binary=components(w,h,(a,b)=>bgLike[a]===bgLike[b]);
  const outside=new Uint8Array(n);binary.regions.filter(r=>r.border&&bgLike[r.pixels[0]]).forEach(r=>r.pixels.forEach(i=>outside[i]=1));
  const foreground=components(w,h,(a,b)=>outside[a]===outside[b]);
  const colorRegions=components(w,h,(a,b)=>colorDistance(rgb(a),rgb(b))<30);
  const candidates:{quad:Point[];region:Component;outer:number;area:number}[]=[];
  for(const region of colorRegions.regions) {
    if(region.border||region.pixels.length<n*0.025||region.pixels.length>n*0.65)continue;
    const outline=pixelOutline(region.outline),box=envelope(outline),fill=region.pixels.length/(box.lengthCm*box.widthCm);
    if(fill<0.83)continue;
    // Fit four extremal corners in the oriented box's frame; reject curved/irregular boundaries.
    const quad=box.corners.map(c=>outline.reduce((best,p)=>Math.hypot(p.x-c.x,p.y-c.y)<Math.hypot(best.x-c.x,best.y-c.y)?p:best));
    const qa=polygonArea(quad);if(qa<=0||Math.abs(region.pixels.length/qa-1)>0.08)continue;
    const edges=quad.map((p,i)=>Math.hypot(p.x-quad[(i+1)%4].x,p.y-quad[(i+1)%4].y));
    if(Math.min(...edges)<30||Math.max(edges[0]/edges[2],edges[2]/edges[0],edges[1]/edges[3],edges[3]/edges[1])>1.18)continue;
    const ratio=Math.max((edges[0]+edges[2])/(edges[1]+edges[3]),(edges[1]+edges[3])/(edges[0]+edges[2]));
    const expected=Math.max(interior.lengthCm/interior.widthCm,interior.widthCm/interior.lengthCm);
    if(Math.abs(ratio/expected-1)>0.13)continue;
    const mid=region.pixels[Math.floor(region.pixels.length/2)],outer=foreground.labels[mid];
    if(outside[mid]||foreground.regions[outer].border||foreground.regions[outer].pixels.length<region.pixels.length*1.1)continue;
    const center={x:quad.reduce((s,p)=>s+p.x,0)/4,y:quad.reduce((s,p)=>s+p.y,0)/4};
    let contrasts=0,total=0;
    for(let side=0;side<4;side++)for(const t of [.2,.4,.6,.8]){
      const a=quad[side],b=quad[(side+1)%4],p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
      const length=Math.hypot(p.x-center.x,p.y-center.y),margin=Math.max(3,Math.min(...edges)*0.035);
      const x=Math.round(p.x+(p.x-center.x)/length*margin),y=Math.round(p.y+(p.y-center.y)/length*margin);
      if(x>=0&&y>=0&&x<w&&y<h){total++;if(colorDistance(rgb(y*w+x),rgb(mid))>45&&!outside[y*w+x])contrasts++;}
    }
    if(total!==16||contrasts/total<0.8)continue;
    // Align the physical length with the detected corresponding axis.
    const horizontal=(edges[0]+edges[2])>=(edges[1]+edges[3]);
    const lengthLonger=interior.lengthCm>=interior.widthCm;
    const aligned=horizontal===lengthLonger?quad:[quad[1],quad[2],quad[3],quad[0]];
    candidates.push({quad:aligned,region,outer,area:qa});
  }
  candidates.sort((a,b)=>b.area-a.area);
  if(!candidates.length)throw new Error('No unambiguous empty rectangular suitcase interior was detected.'+RETAKE);
  if(candidates.length>1&&candidates[1].area>candidates[0].area*0.55)throw new Error('More than one possible suitcase interior was detected. Keep only one open interior visible.'+RETAKE);
  const suitcase=candidates[0],transform=planeTransform(suitcase.quad,interior);
  const minPixels=Math.max(30,n*0.0008),regions=foreground.regions.filter((r,i)=>i!==suitcase.outer&&!outside[r.pixels[0]]&&r.pixels.length>=minPixels);
  if(!regions.length)throw new Error('No separate items were detected beside the suitcase.'+RETAKE);
  if(regions.length>40)throw new Error('Too many disconnected regions: the background, shadows or item separation are unclear.'+RETAKE);
  const ordered=regions.sort((a,b)=>Math.min(...a.outline.map(p=>p.y))-Math.min(...b.outline.map(p=>p.y))||Math.min(...a.outline.map(p=>p.x))-Math.min(...b.outline.map(p=>p.x)));
  const baseArea=interior.lengthCm*interior.widthCm,nominal=baseArea/suitcase.area;
  const items=ordered.map((region,index)=>{
    if(region.border)throw new Error('An item touches the photo edge and may be cropped.'+RETAKE);
    const rawOutline=pixelOutline(region.outline),rectifiedOutline=rawOutline.map(p=>project(transform,p));
    if(region.pixels.length/polygonArea(rawOutline)<0.62)throw new Error('An item region is fragmented or may contain touching/overlapping objects.'+RETAKE);
    if(region.pixels.some(i=>{const p=project(transform,{x:i%w+.5,y:Math.floor(i/w)+.5});return p.x>0&&p.y>0&&p.x<interior.lengthCm&&p.y<interior.widthCm;}))throw new Error('The suitcase opening may not be empty or item boundaries are unclear.'+RETAKE);
    let areaCm2=0;
    for(const i of region.pixels){const x=i%w,y=Math.floor(i/w);areaCm2+=polygonArea([{x,y},{x:x+1,y},{x:x+1,y:y+1},{x,y:y+1}].map(p=>project(transform,p)));}
    const scale=areaCm2/region.pixels.length;if(scale/nominal<0.55||scale/nominal>1.8)throw new Error('Perspective differs too much between the suitcase and an item.'+RETAKE);
    const box=envelope(rectifiedOutline);
    return {id:`${id}-object-${index+1}`,number:index+1,rawOutline,rectifiedOutline,rawPixelArea:region.pixels.length,areaCm2:positive(areaCm2),envelope:{lengthCm:box.lengthCm,widthCm:box.widthCm,angle:box.angle},suitcaseAreaRatio:areaRatio(areaCm2,baseArea),quality:'Geometry checks passed; identity and object separation require your review.'};
  });
  // Keep reproducible axis ratios as well as the full transform for perspective-varying areas.
  const axisScale=pixelScale(interior,Math.hypot(suitcase.quad[1].x-suitcase.quad[0].x,suitcase.quad[1].y-suitcase.quad[0].y),Math.hypot(suitcase.quad[3].x-suitcase.quad[0].x,suitcase.quad[3].y-suitcase.quad[0].y));
  return {id,width:w,height:h,originalWidth:original.width,originalHeight:original.height,interior:{...interior},suitcaseBoundary:suitcase.quad,suitcasePixelArea:suitcase.area,axisScale,transform,items,method:'Border-background separation, connected components, uniform framed quadrilateral detection, planar correction and conservative oriented envelopes. Geometry checks are not calibrated confidence scores.'};
}
