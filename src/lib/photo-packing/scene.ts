import type { Raster } from './detect.ts';
import { areaRatio, envelope, hull, pixelScale, planeTransform, polygonArea, project, type Footprint, type Point } from './geometry.ts';
import { components, pixelOutline, type Component } from './regions.ts';
import type { Analysis } from './types.ts';
const dist=(a:number[],b:number[])=>a.reduce((sum,v,c)=>sum+(v-b[c])**2,0);
const chroma=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const vector=(data:Uint8ClampedArray,i:number)=>{const r=data[i*4],g=data[i*4+1],b=data[i*4+2],sum=Math.max(25,r+g+b);return [128*r/sum,128*g/sum,128*b/sum,(.2126*r+.7152*g+.0722*b)*.25];};
/** Deterministic coarse color families; luminance is separate from chromaticity. */
function sceneColors(raster:Raster){
 const {width:w,height:h,data}=raster,samples:number[][]=[];
 for(let y=1;y<h;y+=5)for(let x=1;x<w;x+=5)samples.push(vector(data,y*w+x));
 const average=[0,1,2,3].map(c=>samples.reduce((sum,s)=>sum+s[c],0)/samples.length),centers=[average];
 while(centers.length<9){let best=samples[0],score=-1;for(const sample of samples){const d=Math.min(...centers.map(c=>dist(c,sample)));if(d>score){score=d;best=sample;}}if(score<2)break;centers.push([...best]);}
 for(let pass=0;pass<8;pass++){const sums=centers.map(()=>[0,0,0,0,0]);for(const sample of samples){let k=0,best=Infinity;for(let j=0;j<centers.length;j++){const d=dist(sample,centers[j]);if(d<best){best=d;k=j;}}for(let c=0;c<4;c++)sums[k][c]+=sample[c];sums[k][4]++;}centers.forEach((c,k)=>{if(sums[k][4])centers[k]=c.map((_,j)=>sums[k][j]/sums[k][4]);});}
 const labels=new Uint8Array(w*h),counts=centers.map(()=>0),border=centers.map(()=>0);
 for(let i=0;i<labels.length;i++){const v=vector(data,i);let k=0,best=Infinity;for(let j=0;j<centers.length;j++){const d=dist(v,centers[j]);if(d<best){best=d;k=j;}}labels[i]=k;counts[k]++;if(i%w<3||i%w>w-4||i<3*w||i>labels.length-3*w)border[k]++;}
 const groups=centers.map((center,k)=>{const family=centers.flatMap((c,j)=>chroma(c,center)<7?[j]:[]);return {center,k,family,count:family.reduce((s,j)=>s+counts[j],0),border:family.reduce((s,j)=>s+border[j],0)};});
 groups.sort((a,b)=>b.border*Math.sqrt(b.count)-a.border*Math.sqrt(a.count));
 return {centers,labels,counts,border,background:groups[0]};
}
interface Candidate { quad:Point[]; pixels:number[]; box:ReturnType<typeof envelope>; score:number; parent:number }
const quantile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
function closeMask(mask:Uint8Array,w:number,h:number,closing=true,radius=1):Uint8Array {
 let current=mask;
 for(const dilate of closing?[true,false]:[false,true])for(const horizontal of [true,false]){const next=new Uint8Array(mask.length);for(let y=0;y<h;y++)for(let x=0;x<w;x++){let value=dilate?0:1;for(let d=-radius;d<=radius;d++){const xx=horizontal?x+d:x,yy=horizontal?y:y+d,v=xx<0||yy<0||xx>=w||yy>=h?0:current[yy*w+xx];value=dilate?Math.max(value,v):Math.min(value,v);}next[y*w+x]=value;}current=next;}
 return current;
}
function candidateFrom(pixels:number[],w:number,h:number,expected:number,parent:number):Candidate|undefined {
 if(pixels.length<w*h*.035)return;
 const step=Math.max(1,Math.floor(pixels.length/6000)),points=pixels.filter((_,i)=>i%step===0).map(i=>({x:i%w,y:Math.floor(i/w)}));
 let box=envelope(points);const c=Math.cos(box.angle),s=Math.sin(box.angle),xs=points.map(p=>p.x*c+p.y*s),ys=points.map(p=>-p.x*s+p.y*c);
 // Trim sparse straps, tags and isolated edge pixels; no hand-marked corners.
 const x0=quantile(xs,.015),x1=quantile(xs,.985),y0=quantile(ys,.015),y1=quantile(ys,.985);
 const quad=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>({x:x*c-y*s,y:x*s+y*c}));
 const longX=x1-x0>=y1-y0,longs=longX?xs:ys,shorts=longX?ys:xs,long0=longX?x0:y0,long1=longX?x1:y1;
 const span=(lo:number,hi:number)=>{const selected=shorts.filter((_,i)=>longs[i]>=long0+(long1-long0)*lo&&longs[i]<=long0+(long1-long0)*hi);return selected.length>20?quantile([...selected],.98)-quantile([...selected],.02):0;};
 const near=span(.15,.3),far=span(.7,.85);if(near&&far&&Math.max(near/far,far/near)>1.3)return;
 const a=x1-x0,b=y1-y0,ratio=Math.max(a/b,b/a),area=a*b,fill=pixels.length/(box.lengthCm*box.widthCm);
 if(Math.min(a,b)<35||Math.abs(ratio/expected-1)>.25||fill<.62||quad.some(p=>p.x<3||p.y<3||p.x>w-4||p.y>h-4))return;
 box={...box,lengthCm:a,widthCm:b,corners:quad};
 return {quad,pixels,box,score:area*fill/(1+Math.abs(ratio/expected-1)),parent};
}
function splitClamshell(region:Component,w:number,h:number,expected:number,parent:number):Candidate[]{
 const points=region.outline,box=envelope(points),c=Math.cos(box.angle),s=Math.sin(box.angle);
 const candidates:Candidate[][]=[];
 for(const axis of [0,1]){
  const coordinate=(i:number)=>{const x=i%w,y=Math.floor(i/w);return axis===0?x*c+y*s:-x*s+y*c;};
  const values=region.pixels.map(coordinate),lo=Math.min(...box.corners.map(p=>axis===0?p.x*c+p.y*s:-p.x*s+p.y*c)),hi=Math.max(...box.corners.map(p=>axis===0?p.x*c+p.y*s:-p.x*s+p.y*c));
  const bins=new Float64Array(80);values.forEach(v=>bins[Math.max(0,Math.min(79,Math.floor((v-lo)/(hi-lo)*80)))]++);
  let valley=30;for(let b=31;b<50;b++)if(bins[b]<bins[valley])valley=b;
  const sideMean=(Array.from(bins.slice(12,28)).reduce((a,b)=>a+b,0)+Array.from(bins.slice(52,68)).reduce((a,b)=>a+b,0))/32;
  if(bins[valley]>sideMean*.78)continue;
  const cut=lo+(valley+.5)/80*(hi-lo),halves=[region.pixels.filter((_,i)=>values[i]<cut),region.pixels.filter((_,i)=>values[i]>=cut)];
  const found=halves.map(p=>candidateFrom(p,w,h,expected,parent)).filter((v):v is Candidate=>!!v);
  if(found.length===2&&Math.min(found[0].pixels.length,found[1].pixels.length)/Math.max(found[0].pixels.length,found[1].pixels.length)>.6)candidates.push(found);
 }
 return candidates.sort((a,b)=>b[0].score+b[1].score-a[0].score-a[1].score)[0]??[];
}
function insideExpanded(point:Point,candidate:Candidate,padding=.12):boolean {
 const a=candidate.quad[0],b=candidate.quad[1],d=candidate.quad[3],ux=b.x-a.x,uy=b.y-a.y,vx=d.x-a.x,vy=d.y-a.y;
 const u=((point.x-a.x)*ux+(point.y-a.y)*uy)/(ux*ux+uy*uy),v=((point.x-a.x)*vx+(point.y-a.y)*vy)/(vx*vx+vy*vy);
 return u>=-padding&&u<=1+padding&&v>=-padding&&v<=1+padding;
}
/** Multisurface fallback: boundaries/areas still come from pixels, never from semantic guesses. */
export function detectScene(raster:Raster,interior:Footprint,id:string,original={width:raster.width,height:raster.height}):Analysis {
 const {width:w,height:h,data}=raster,n=w*h,colors=sceneColors(raster),expected=Math.max(interior.lengthCm/interior.widthCm,interior.widthCm/interior.lengthCm);
 const candidates:Candidate[]=[];
 const considered=new Set<string>();
 for(let k=0;k<colors.centers.length;k++){
  if(colors.counts[k]<n*.04||colors.background.family.includes(k))continue;
  const family=colors.centers.flatMap((c,j)=>chroma(c,colors.centers[k])<7?[j]:[]),key=family.join(',');if(considered.has(key))continue;considered.add(key);
  const members=new Set(family),minimum=Math.max(7,Math.min(...family.map(j=>colors.centers[j][3]))*.5),mask=closeMask(Uint8Array.from(colors.labels,(label,i)=>members.has(label)&&(.2126*data[i*4]+.7152*data[i*4+1]+.0722*data[i*4+2])*.25>minimum?1:0),w,h);
  const regions=components(w,h,(a,b)=>mask[a]===mask[b]).regions;
  regions.forEach((region,parent)=>{if(region.border||!mask[region.pixels[0]]||region.pixels.length<n*.04)return;const identity=k*30_000+parent,candidate=candidateFrom(region.pixels,w,h,expected,identity),pair=splitClamshell(region,w,h,expected,identity);if(pair.length&&pair.every(c=>Math.max(c.box.lengthCm/c.box.widthCm,c.box.widthCm/c.box.lengthCm)>1.32)){candidates.push(...pair);return;}if(candidate)candidates.push(candidate);});
 }
 const supported=candidates.filter(c=>rimSupported(raster,c));candidates.splice(0,candidates.length,...supported);
 candidates.sort((a,b)=>b.score-a.score);if(!candidates.length)throw new Error('The suitcase interior opening could not be separated from its lining or surroundings. Keep its rim visible and take a more overhead photo.');
 const first=candidates[0],other=candidates.find(c=>!insideExpanded({x:c.quad.reduce((s,p)=>s+p.x,0)/4,y:c.quad.reduce((s,p)=>s+p.y,0)/4},first,.2)&&c.score>first.score*.55);
 const pair=other&&other.parent===first.parent?other:undefined;
 if(other&&!pair)throw new Error('More than one unrelated possible suitcase opening was found. Show one suitcase at a time.');
 const chosen=first,halves=pair?[chosen,pair]:[chosen],a=chosen.quad;
 const edgeLength=Math.hypot(a[1].x-a[0].x,a[1].y-a[0].y),edgeWidth=Math.hypot(a[3].x-a[0].x,a[3].y-a[0].y);
 const quad=(edgeLength>=edgeWidth)===(interior.lengthCm>=interior.widthCm)?a:[a[1],a[2],a[3],a[0]],transform=planeTransform(quad,interior);
 const usable=edgeOutlines(raster,halves,colors).sort((a,b)=>Math.min(...a.map(p=>p.y))-Math.min(...b.map(p=>p.y))||Math.min(...a.map(p=>p.x))-Math.min(...b.map(p=>p.x)));
 if(!usable.length)throw new Error('The suitcase was found, but no complete separate item regions could be measured.');if(usable.length>40)throw new Error('The suitcase was found, but item outlines are still too fragmented.');
 const items=usable.map((rawOutline,index)=>{const rectifiedOutline=rawOutline.map(p=>project(transform,p)),box=envelope(rectifiedOutline),areaCm2=polygonArea(rectifiedOutline);return {id:`${id}-object-${index+1}`,number:index+1,rawOutline,rectifiedOutline,rawPixelArea:polygonArea(rawOutline),areaCm2,envelope:{lengthCm:box.lengthCm,widthCm:box.widthCm,angle:box.angle},suitcaseAreaRatio:areaRatio(areaCm2,interior.lengthCm*interior.widthCm),areaKind:'outline' as const,quality:'Conservative image-outline estimate: verify the complete silhouette. Low-contrast, transparent and touching items may be missed or grouped.'};});

 return {reviewNotes:['Scene-aware detection used multiple background colors. Check every outline: low-contrast, transparent or touching items may still be missed.',...(pair?['Two connected clamshell halves were found. The green opening is the measurement reference; the other half is excluded from the item list. Confirm your interior dimensions describe that green opening.']:[])],excludedBoundaries:pair?[pair.quad]:[],id,width:w,height:h,originalWidth:original.width,originalHeight:original.height,interior:{...interior},suitcaseBoundary:quad,suitcasePixelArea:polygonArea(quad),axisScale:pixelScale(interior,Math.hypot(quad[1].x-quad[0].x,quad[1].y-quad[0].y),Math.hypot(quad[3].x-quad[0].x,quad[3].y-quad[0].y)),transform,items,method:`Multi-surface color clustering and edge-guided outline detection with pixel-derived lining bounds${pair?'; adjacent connected clamshell halves found and excluded from the item list':''}. Approximate reference; verify that the green opening matches the entered interior dimensions.`};
}
/** Edge-guided closed silhouettes avoid joining pale objects to similarly colored wood. */
function edgeOutlines(raster:Raster,halves:Candidate[],colors:ReturnType<typeof sceneColors>):Point[][] {
 const {width:w,height:h,data}=raster,n=w*h,blur=new Float32Array(n*3),temporary=new Float32Array(n*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++)temporary[(y*w+x)*3+c]=(data[(y*w+Math.max(0,x-1))*4+c]+2*data[(y*w+x)*4+c]+data[(y*w+Math.min(w-1,x+1))*4+c])/4;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++)blur[(y*w+x)*3+c]=(temporary[(Math.max(0,y-1)*w+x)*3+c]+2*temporary[(y*w+x)*3+c]+temporary[(Math.min(h-1,y+1)*w+x)*3+c])/4;
 const strength=new Float32Array(n),values:number[]=[];
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;let squared=0;for(let c=0;c<3;c++){const gx=blur[((y-1)*w+x+1)*3+c]+2*blur[(y*w+x+1)*3+c]+blur[((y+1)*w+x+1)*3+c]-blur[((y-1)*w+x-1)*3+c]-2*blur[(y*w+x-1)*3+c]-blur[((y+1)*w+x-1)*3+c],gy=blur[((y+1)*w+x-1)*3+c]+2*blur[((y+1)*w+x)*3+c]+blur[((y+1)*w+x+1)*3+c]-blur[((y-1)*w+x-1)*3+c]-2*blur[((y-1)*w+x)*3+c]-blur[((y-1)*w+x+1)*3+c];squared+=gx*gx+gy*gy;}strength[i]=Math.sqrt(squared);if(i%17===0&&!halves.some(c=>insideExpanded({x,y},c,.14)))values.push(strength[i]);}
 const middle=quantile(values,.5),deviation=quantile(values.map(v=>Math.abs(v-middle)),.5),threshold=Math.min(90,Math.max(35,middle+3*deviation));
 const edges=closeMask(Uint8Array.from(strength,v=>v>threshold?1:0),w,h),spaces=components(w,h,(a,b)=>edges[a]===edges[b]);
 const expand=(outline:Point[])=>hull(outline.flatMap(p=>[{x:Math.max(0,p.x-2),y:Math.max(0,p.y-2)},{x:Math.min(w,p.x+2),y:Math.max(0,p.y-2)},{x:Math.min(w,p.x+2),y:Math.min(h,p.y+2)},{x:Math.max(0,p.x-2),y:Math.min(h,p.y+2)}]));
 const outlines=spaces.regions.filter(region=>!edges[region.pixels[0]]&&!region.border&&region.pixels.length>Math.max(90,n*.00018)&&region.pixels.length<n*.14&&!region.pixels.some(i=>halves.some(c=>insideExpanded({x:i%w,y:Math.floor(i/w)},c,.14))))
  .map(region=>expand(pixelOutline(region.outline)));
 // Whole color-connected bodies recover object exteriors around printed labels/graphics.
 const colorRegions=components(w,h,(a,b)=>colors.labels[a]===colors.labels[b]).regions;
 for(const region of colorRegions){if(region.border||colors.background.family.includes(colors.labels[region.pixels[0]])||region.pixels.length<Math.max(130,n*.00025)||region.pixels.length>n*.14||region.pixels.some(i=>halves.some(c=>insideExpanded({x:i%w,y:Math.floor(i/w)},c,.14))))continue;const outline=pixelOutline(region.outline);if(region.pixels.length/polygonArea(outline)<.4)continue;outlines.push(expand(outline));}
 outlines.sort((a,b)=>polygonArea(b)-polygonArea(a));

 // Merge intersecting fragments (e.g. print and body colors) before removing nested labels.
 const selected:Point[][]=[];
 for(const initial of outlines){let outline=initial;let changed=true;while(changed){changed=false;for(let i=selected.length-1;i>=0;i--){const other=selected[i],overlap=overlapArea(other,outline);if(overlap/Math.min(polygonArea(other),polygonArea(outline))>.06||overlapArea(envelope(other).corners,outline)/polygonArea(outline)>.75||overlapArea(envelope(outline).corners,other)/polygonArea(other)>.75){outline=hull([...outline,...other]);selected.splice(i,1);changed=true;}}}selected.push(outline);}

 return selected;
}

function overlapArea(a:Point[],b:Point[]):number {
 let clipped=[...a];
 for(let i=0;i<b.length&&clipped.length;i++){const u=b[i],v=b[(i+1)%b.length],cross=(p:Point)=>(v.x-u.x)*(p.y-u.y)-(v.y-u.y)*(p.x-u.x),next:Point[]=[];
 for(let j=0;j<clipped.length;j++){const p=clipped[j],q=clipped[(j+1)%clipped.length],cp=cross(p),cq=cross(q);if(cp>=0)next.push(p);if((cp>=0)!==(cq>=0)){const t=cp/(cp-cq);next.push({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t});}}clipped=next;}
 return clipped.length>2?polygonArea(clipped):0;
}

/** A plausible liner must have a darker enclosing rim, not just be a large folded cloth. */
function rimSupported(raster:Raster,candidate:Candidate):boolean {
 const {width:w,height:h,data}=raster,q=candidate.quad,center={x:q.reduce((s,p)=>s+p.x,0)/4,y:q.reduce((s,p)=>s+p.y,0)/4},margin=Math.min(candidate.box.lengthCm,candidate.box.widthCm);
 const luma=(p:Point)=>{const x=Math.round(p.x),y=Math.round(p.y);if(x<0||y<0||x>=w||y>=h)return NaN;const i=(y*w+x)*4;return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2];};let sides=0;
 for(let side=0;side<4;side++){let hits=0;for(const t of [.2,.4,.6,.8]){const a=q[side],b=q[(side+1)%4],p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},length=Math.hypot(p.x-center.x,p.y-center.y),ux=(p.x-center.x)/length,uy=(p.y-center.y)/length,inside=luma({x:p.x-ux*margin*.04,y:p.y-uy*margin*.04});if([.035,.07,.11,.15].some(f=>luma({x:p.x+ux*margin*f,y:p.y+uy*margin*f})<inside*.7))hits++;}if(hits>=2)sides++;}
 return sides>=3;
}
