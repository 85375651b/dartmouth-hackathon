import type { PackWiseData, SuitcaseId } from '../types.ts';
import type { Footprint } from '../photo-packing/geometry.ts';
import type { BaggageRule } from './types.ts';
/** Warnings are conditional, never clearance. Interior axes are only exterior lower bounds. */
export function baggageWarnings(data:PackWiseData,id:SuitcaseId,interior:Footprint|undefined,rules:BaggageRule[]):string[]{
 const bag=data.suitcases.find(b=>b.id===id);if(!bag)return [];
 const messages:string[]=[];
 for(const rule of rules){
  if(bag.kind!=='unknown'&&((bag.kind==='checked')!==(rule.type==='checked')))continue;
  const prefix=`If this ${rule.type} rule applies to your ticket`;
  if(interior&&rule.dimensionsCm?.length===3){const allowed=[...rule.dimensionsCm].sort((a,b)=>b-a),known=[interior.lengthCm,interior.widthCm].sort((a,b)=>b-a);if(known[0]>allowed[0]+1e-7||known[1]>allowed[1]+1e-7)messages.push(`${prefix}, even the usable interior footprint exceeds its exterior size bounds. Check a different bag or the airline directly.`);}
  if(rule.weightKg!==null){
   const items=data.packingPlan.assignments.filter(a=>a.suitcaseId===id).flatMap(a=>{const i=data.items.find(i=>i.id===a.itemId);return i?[i]:[];});
   const known=items.reduce((s,i)=>s+(i.weightKg??0),0)+(bag.emptyWeightKg??0);
   if(known>rule.weightKg+1e-7)messages.push(`${prefix}, known weights alone exceed ${rule.weightKg.toFixed(1)} kg. ${bag.emptyWeightKg===null||items.some(i=>i.weightKg===null)?'The complete loaded weight is still unknown.':'Weigh the loaded case to verify.'}`);
  }
 }
 return [...new Set(messages)];
}
