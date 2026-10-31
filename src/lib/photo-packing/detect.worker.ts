import { detectPhoto, type Raster } from './detect.ts';
import type { Footprint } from './geometry.ts';
self.onmessage=(event:MessageEvent<{raster:Raster;interior:Footprint;id:string;original:{width:number;height:number}}>)=>{
  try{const {raster,interior,id,original}=event.data;self.postMessage({analysis:detectPhoto(raster,interior,id,original)});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:'Image analysis failed. Retake the photograph.'});}
};
