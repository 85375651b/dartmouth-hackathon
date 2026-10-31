import { hull, type Point } from './geometry.ts';
export interface Component { pixels:number[]; outline:Point[]; border:boolean }
/** Four-connected regions, with a complexity cap for noisy images. */
export function components(width:number,height:number,accept:(a:number,b:number)=>boolean):{regions:Component[];labels:Int32Array} {
 const labels=new Int32Array(width*height).fill(-1),regions:Component[]=[];
 for(let seed=0;seed<labels.length;seed++){
  if(labels[seed]!==-1)continue;
  if(regions.length>=30_000)throw new Error('Fine image texture prevents stable boundaries. Use softer lighting or a less textured background.');
  const id=regions.length,queue=[seed],outline:Point[]=[];labels[seed]=id;let border=false;
  for(let cursor=0;cursor<queue.length;cursor++){
   const i=queue[cursor],x=i%width,y=Math.floor(i/width);let edge=false;
   if(x===0||y===0||x===width-1||y===height-1)border=true;
   for(const j of [x>0?i-1:-1,x<width-1?i+1:-1,y>0?i-width:-1,y<height-1?i+width:-1]){if(j<0||!accept(seed,j)){edge=true;continue;}if(labels[j]===-1){labels[j]=id;queue.push(j);}}
   if(edge)outline.push({x,y});
  }
  regions.push({pixels:queue,outline,border});
 }
 return {regions,labels};
}
export function pixelOutline(points:Point[]):Point[]{return hull(points.flatMap(p=>[{x:p.x,y:p.y},{x:p.x+1,y:p.y},{x:p.x+1,y:p.y+1},{x:p.x,y:p.y+1}]));}
