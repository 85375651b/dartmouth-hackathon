import type { Raster } from './detect.ts';
/** Robust per-channel illumination plane fitted to border pixels, not one global color. */
export function backgroundMask({width:w,height:h,data}:Raster):Uint8Array {
 const samples:{x:number;y:number;rgb:number[]}[]=[];
 const add=(x:number,y:number)=>{const i=(y*w+x)*4;samples.push({x:x/(w-1),y:y/(h-1),rgb:[data[i],data[i+1],data[i+2]]});};
 for(let x=0;x<w;x+=Math.max(1,Math.floor(w/80))){add(x,0);add(x,h-1);}for(let y=0;y<h;y+=Math.max(1,Math.floor(h/80))){add(0,y);add(w-1,y);}
 const median=[0,1,2].map(c=>samples.map(s=>s.rgb[c]).sort((a,b)=>a-b)[Math.floor(samples.length/2)]);
 let accepted=samples.filter(s=>Math.hypot(...s.rgb.map((v,c)=>v-median[c]))<85);
 if(accepted.length<samples.length*.85)return dominantBorderMask({width:w,height:h,data});
 let coefficients:number[][]=[];
 for(let pass=0;pass<3;pass++){
  coefficients=[0,1,2].map(channel=>{
   const rows=Array.from({length:3},()=>[0,0,0,0]);
   for(const s of accepted){const v=[1,s.x,s.y];for(let a=0;a<3;a++){for(let b=0;b<3;b++)rows[a][b]+=v[a]*v[b];rows[a][3]+=v[a]*s.rgb[channel];}}
   for(let col=0;col<3;col++){let pivot=col;for(let row=col+1;row<3;row++)if(Math.abs(rows[row][col])>Math.abs(rows[pivot][col]))pivot=row;[rows[pivot],rows[col]]=[rows[col],rows[pivot]];const divisor=rows[col][col];if(Math.abs(divisor)<1e-6)throw new Error('Background calibration is unstable. Retake the photograph.');rows[col]=rows[col].map(n=>n/divisor);for(let row=0;row<3;row++)if(row!==col){const f=rows[row][col];rows[row]=rows[row].map((n,i)=>n-f*rows[col][i]);}}
   return rows.map(r=>r[3]);
  });
  accepted=samples.filter(s=>Math.hypot(...s.rgb.map((v,c)=>v-(coefficients[c][0]+coefficients[c][1]*s.x+coefficients[c][2]*s.y)))<32);
  if(accepted.length<samples.length*.85)return dominantBorderMask({width:w,height:h,data});
 }
 return Uint8Array.from({length:w*h},(_,i)=>{const x=(i%w)/(w-1),y=Math.floor(i/w)/(h-1);let sum=0;for(let c=0;c<3;c++){const [a,b,d]=coefficients[c],difference=data[i*4+c]-(a+b*x+d*y);sum+=difference*difference;}return sum<35*35?1:0;});
}
/** A fallback only: suppress isolated sensor/lining noise, never split touching objects. */
export function denoise(raster:Raster):Raster {
 const {width:w,height:h,data}=raster,result=new Uint8ClampedArray(data);
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)for(let c=0;c<3;c++){const values:number[]=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)values.push(data[((y+dy)*w+x+dx)*4+c]);values.sort((a,b)=>a-b);result[(y*w+x)*4+c]=values[4];}
 return {width:w,height:h,data:result};
}

/** A wall/baseboard need not match the floor. Keep the dominant border color as one background mode. */
function dominantBorderMask({width:w,height:h,data}:Raster):Uint8Array {
 const bins=new Map<string,{pixels:number[];edges:Set<number>}>();
 const add=(i:number,edge:number)=>{const key=[0,1,2].map(c=>Math.floor(data[i*4+c]/32)).join(',');const bin=bins.get(key)??{pixels:[],edges:new Set<number>()};bin.pixels.push(i);bin.edges.add(edge);bins.set(key,bin);};
 for(let x=0;x<w;x+=Math.max(1,Math.floor(w/100))){add(x,0);add((h-1)*w+x,1);}for(let y=0;y<h;y+=Math.max(1,Math.floor(h/100))){add(y*w,2);add(y*w+w-1,3);}
 const ranked=[...bins.values()].filter(b=>b.edges.size>=2).sort((a,b)=>b.pixels.length-a.pixels.length),best=ranked[0];
 if(!best||best.pixels.length<25)throw new Error('No stable background region was found. Keep the suitcase rim and complete items visible.');
 const center=[0,1,2].map(c=>best.pixels.reduce((sum,i)=>sum+data[i*4+c],0)/best.pixels.length);
 return Uint8Array.from({length:w*h},(_,i)=>Math.hypot(...center.map((v,c)=>data[i*4+c]-v))<38?1:0);
}
