import type { AreaPlan } from './types.ts';
export interface PackingProgress { completed:number[];stopped:boolean;index:number }
export function remainingDetections(plan:AreaPlan,progress:PackingProgress):string[]{const packed=new Set(plan.layers.flatMap((l,i)=>progress.completed.includes(i)?l.placements.map(p=>p.detectionId):[]));return plan.reviews.filter(r=>!r.ignored&&!packed.has(r.id)).map(r=>r.id);}
export function nextLayer(progress:PackingProgress,direction:-1|1,count:number):number {
 const target=progress.index+direction,max=progress.stopped?Math.max(0,...progress.completed):count-1;
 if(target<0||target>max||direction===1&&!progress.completed.includes(progress.index))return progress.index;
 return target;
}
