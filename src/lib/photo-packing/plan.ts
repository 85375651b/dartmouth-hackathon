import type { ItemId, PackWiseData, SuitcaseId } from '../types.ts';
import { positive } from './geometry.ts';
import type { Analysis, AreaLayer, AreaPlan, Placement, Rectangle, Review } from './types.ts';
const EPS=1e-7;
export const intersects=(a:Rectangle,b:Rectangle)=>a.x<b.x+b.lengthCm-EPS&&a.x+a.lengthCm>b.x+EPS&&a.y<b.y+b.widthCm-EPS&&a.y+a.widthCm>b.y+EPS;
export function subtract(regions:Rectangle[],used:Rectangle):Rectangle[] {
  return regions.flatMap(r=>{
    if(!intersects(r,used))return [r];
    const x0=Math.max(r.x,used.x),x1=Math.min(r.x+r.lengthCm,used.x+used.lengthCm),y0=Math.max(r.y,used.y),y1=Math.min(r.y+r.widthCm,used.y+used.widthCm);
    return [{x:r.x,y:r.y,lengthCm:x0-r.x,widthCm:r.widthCm},{x:x1,y:r.y,lengthCm:r.x+r.lengthCm-x1,widthCm:r.widthCm},
      {x:x0,y:r.y,lengthCm:x1-x0,widthCm:y0-r.y},{x:x0,y:y1,lengthCm:x1-x0,widthCm:r.y+r.widthCm-y1}].filter(p=>p.lengthCm>EPS&&p.widthCm>EPS);
  });
}
export function areaInputKey(data:PackWiseData,suitcaseId:SuitcaseId,analysis:Analysis,reviews:Review[]):string {
  return JSON.stringify([data.trip.id,data.suitcases.find(b=>b.id===suitcaseId),analysis,reviews,reviews.filter(r=>r.itemId).map(r=>data.items.find(i=>i.id===r.itemId)),data.packingPlan.assignments]);
}
function checkReviews(analysis:Analysis,reviews:Review[]) {
  if(new Set(analysis.items.map(i=>i.id)).size!==analysis.items.length||reviews.length!==analysis.items.length||new Set(reviews.map(r=>r.id)).size!==reviews.length||reviews.some(r=>!analysis.items.some(i=>i.id===r.id)))throw new Error('Detection reviews do not match this photograph. Analyze again.');
  const active=reviews.filter(r=>!r.ignored);
  if(!active.length)throw new Error('Include at least one detected item.');
  if(active.some(r=>!r.name.trim()||!r.confirmed||![1,2,3].includes(r.category)))throw new Error('Name and confirm a category for every included detection.');
  const ids=active.flatMap(r=>r.itemId?[r.itemId]:[]);if(new Set(ids).size!==ids.length)throw new Error('Link each inventory entry to only one complete detected bundle.');
  return active;
}
function handling(data:PackWiseData,suitcaseId:SuitcaseId,review:Review):string|undefined {
  const bag=data.suitcases.find(b=>b.id===suitcaseId);if(!bag)throw new Error('Choose an existing suitcase.');
  const item=review.itemId?data.items.find(i=>i.id===review.itemId):undefined;
  if(review.itemId&&!item)throw new Error('A linked inventory entry was deleted. Review associations again.');
  if(item?.carryOnRequired&&bag.kind!=='carry-on')return 'This linked inventory entry requires a carry-on.';
  // Unpictured existing bag contents remain assigned and keep their known handling restrictions.
  const inBag=data.packingPlan.assignments.filter(a=>a.suitcaseId===suitcaseId).map(a=>data.items.find(i=>i.id===a.itemId)).filter(i=>i&&i.id!==item?.id);
  if(item&&inBag.some(i=>(i!.cleanliness==='dirty')!==(item.cleanliness==='dirty')))return 'Known dirty and clean inventory must remain separate; this photograph cannot establish containment.';
}
export function planAreas(data:PackWiseData,suitcaseId:SuitcaseId,analysis:Analysis,reviews:Review[]):AreaPlan {
  const active=checkReviews(analysis,reviews),bag=data.suitcases.find(b=>b.id===suitcaseId);
  if(!bag)throw new Error('Choose an existing suitcase.');
  const base=analysis.interior;positive(base.lengthCm);positive(base.widthCm);positive(base.lengthCm*base.widthCm);
  const layers:AreaLayer[]=[],unplaced:AreaPlan['unplaced']=[];
  const full:Rectangle={x:0,y:0,...base};
  const reviewFor=(id:string)=>active.find(r=>r.id===id)!;
  const blocked=()=>layers.flatMap(l=>l.placements.filter(p=>data.items.some(i=>i.id===reviewFor(p.detectionId).itemId&&i.fragility==='fragile')));
  function candidate(item:Analysis['items'][number],free:Rectangle[]):Omit<Placement,'detectionId'|'category'>|undefined {
    positive(item.envelope.lengthCm);positive(item.envelope.widthCm);positive(item.areaCm2);
    const options=free.flatMap(r=>[false,true].flatMap(rotated=>{
      const lengthCm=rotated?item.envelope.widthCm:item.envelope.lengthCm,widthCm=rotated?item.envelope.lengthCm:item.envelope.widthCm;
      return lengthCm<=r.lengthCm+EPS&&widthCm<=r.widthCm+EPS?[{x:r.x,y:r.y,lengthCm,widthCm,rotated,waste:r.lengthCm*r.widthCm-lengthCm*widthCm}]:[];
    })).sort((a,b)=>a.waste-b.waste||a.y-b.y||a.x-b.x||Number(a.rotated)-Number(b.rotated));
    return options[0];
  }
  for(const category of [1,2,3] as const) {
    let pending=active.filter(r=>r.category===category).map(r=>analysis.items.find(i=>i.id===r.id)!).sort((a,b)=>b.envelope.lengthCm*b.envelope.widthCm-a.envelope.lengthCm*a.envelope.widthCm||a.id.localeCompare(b.id));
    pending=pending.filter(item=>{const reason=handling(data,suitcaseId,reviewFor(item.id));if(reason){unplaced.push({detectionId:item.id,reason});return false;}if(!candidate(item,[full])){unplaced.push({detectionId:item.id,reason:'Its conservative footprint does not fit inside even an empty layer, including a 90° turn.'});return false;}return true;});
    while(pending.length){
      if(!layers.length)layers.push({placements:[],freeRegions:[full]});
      const current=layers.at(-1)!,left:typeof pending=[];
      for(const item of pending){
        const review=reviewFor(item.id),source=data.items.find(i=>i.id===review.itemId);
        const otherDirty=layers.flatMap(l=>l.placements).some(p=>{const other=data.items.find(i=>i.id===reviewFor(p.detectionId).itemId);return source&&other&&(source.cleanliness==='dirty')!==(other.cleanliness==='dirty');});
        if(otherDirty){unplaced.push({detectionId:item.id,reason:'Known dirty and clean linked inventory cannot share this plan without verified separation.'});continue;}
        const position=candidate(item,current.freeRegions);
        if(position){const {x,y,lengthCm,widthCm,rotated}=position;const p:Placement={x,y,lengthCm,widthCm,rotated,detectionId:item.id,category};current.placements.push(p);current.freeRegions=subtract(current.freeRegions,p);}else left.push(item);
      }
      if(!left.length)break;
      const free=blocked().reduce((r,p)=>subtract(r,p),[full]);
      if(!left.some(item=>candidate(item,free))){unplaced.push(...left.map(item=>({detectionId:item.id,reason:'Known fragile-item footprints reserve space in later layers; no permitted footprint placement remains.'})));break;}
      layers.push({placements:[],freeRegions:free});pending=left;
    }
  }
  const plan={suitcaseId,inputKey:areaInputKey(data,suitcaseId,analysis,reviews),analysis:structuredClone(analysis),reviews:structuredClone(reviews),layers,unplaced};
  validateAreaPlan(data,plan);return plan;
}
/** Independently verify geometry, accounting and source fingerprints again before Apply. */
export function validateAreaPlan(data:PackWiseData,plan:AreaPlan):void {
  if(plan.inputKey!==areaInputKey(data,plan.suitcaseId,plan.analysis,plan.reviews))throw new Error('This proposal is stale. Review and generate again.');
  const active=checkReviews(plan.analysis,plan.reviews),seen=new Set<string>();let category=1;
  const base=plan.analysis.interior;positive(base.lengthCm);positive(base.widthCm);positive(base.lengthCm*base.widthCm);const previous:Placement[]=[];
  for(const item of plan.analysis.items){positive(item.areaCm2);positive(item.rawPixelArea);positive(item.envelope.lengthCm);positive(item.envelope.widthCm);if(item.areaCm2>item.envelope.lengthCm*item.envelope.widthCm+EPS*Math.max(1,item.areaCm2))throw new Error('Segmented area exceeds its bounding footprint.');}
  for(const layer of plan.layers){
    if(!layer.placements.length)throw new Error('An empty packing layer is invalid.');
    for(const p of layer.placements){
      const review=active.find(r=>r.id===p.detectionId),item=plan.analysis.items.find(i=>i.id===p.detectionId);
      if(!review||!item||seen.has(p.detectionId)||p.category!==review.category||p.category<category)throw new Error('Invalid or duplicate category placement.');
      seen.add(p.detectionId);category=p.category;
      if([p.x,p.y,p.lengthCm,p.widthCm].some(v=>!Number.isFinite(v))||p.x<0||p.y<0||p.lengthCm<=0||p.widthCm<=0||p.x+p.lengthCm>base.lengthCm+EPS||p.y+p.widthCm>base.widthCm+EPS)throw new Error('Placement is outside the usable footprint.');
      const l=p.rotated?item.envelope.widthCm:item.envelope.lengthCm,w=p.rotated?item.envelope.lengthCm:item.envelope.widthCm;
      if(Math.abs(l-p.lengthCm)>EPS||Math.abs(w-p.widthCm)>EPS)throw new Error('A measured footprint was reshaped.');
      if(handling(data,plan.suitcaseId,review))throw new Error('A linked handling restriction is violated.');
      if(previous.some(q=>data.items.some(i=>i.id===active.find(r=>r.id===q.detectionId)?.itemId&&i.fragility==='fragile')&&intersects(p,q)))throw new Error('A fragile entry would be covered.');
    }
    const regions=[...layer.placements,...layer.freeRegions];
    for(let i=0;i<regions.length;i++){const r=regions[i];if([r.x,r.y,r.lengthCm,r.widthCm].some(v=>!Number.isFinite(v))||r.x<0||r.y<0||r.lengthCm<=0||r.widthCm<=0||r.x+r.lengthCm>base.lengthCm+EPS||r.y+r.widthCm>base.widthCm+EPS)throw new Error('Invalid free region.');for(let j=i+1;j<regions.length;j++)if(intersects(r,regions[j]))throw new Error('Footprints or free regions overlap.');}
    const reserved=previous.filter(q=>data.items.some(i=>i.id===active.find(r=>r.id===q.detectionId)?.itemId&&i.fragility==='fragile'));
    if(layer.freeRegions.some(r=>reserved.some(q=>intersects(r,q))))throw new Error('A reserved fragile-item region was marked free.');
    const expected=layer.placements.reduce((free,p)=>subtract(free,p),reserved.reduce((free,p)=>subtract(free,p),[{x:0,y:0,...base}]));
    const area=(rectangles:Rectangle[])=>rectangles.reduce((sum,r)=>sum+r.lengthCm*r.widthCm,0);
    if(Math.abs(area(expected)-area(layer.freeRegions))>EPS*Math.max(1,base.lengthCm*base.widthCm))throw new Error('Free-region area accounting is incomplete.');
    previous.push(...layer.placements);
  }
  const linked=previous.flatMap(p=>{const source=data.items.find(i=>i.id===active.find(r=>r.id===p.detectionId)?.itemId);return source?[source]:[];});
  if(linked.some(i=>i.cleanliness==='dirty')&&linked.some(i=>i.cleanliness!=='dirty'))throw new Error('Known dirty and clean entries cannot share this plan.');
  for(const entry of plan.unplaced){if(!active.some(r=>r.id===entry.detectionId)||seen.has(entry.detectionId)||!entry.reason)throw new Error('Invalid unplaced accounting.');seen.add(entry.detectionId);}
  if(seen.size!==active.length)throw new Error('Some detections are missing from the result.');
}
export function applyAreaPlan(data:PackWiseData,plan:AreaPlan):PackWiseData {
  validateAreaPlan(data,plan);
  const mapped=plan.layers.flatMap(l=>l.placements).flatMap(p=>{const id=plan.reviews.find(r=>r.id===p.detectionId)?.itemId;return id?[id]:[];});
  const ids=new Set<ItemId>(mapped),others=data.packingPlan.assignments.filter(a=>!ids.has(a.itemId));
  const order=Math.max(0,...others.filter(a=>a.suitcaseId===plan.suitcaseId).map(a=>a.packOrder));
  const assignments=[...others,...mapped.map((itemId,index)=>({itemId,suitcaseId:plan.suitcaseId,packOrder:order+index+1}))];
  const packingPlan={...data.packingPlan,assignments,unassignedItemIds:data.items.filter(i=>!assignments.some(a=>a.itemId===i.id)).map(i=>i.id)};
  const next={...data,suitcases:data.suitcases.map(b=>b.id===plan.suitcaseId?{...b,interiorFootprintCm:{...plan.analysis.interior}}:b),packingPlan};
  const saved={...structuredClone(plan),inputKey:areaInputKey(next,plan.suitcaseId,plan.analysis,plan.reviews)};
  return {...next,packingPlan:{...packingPlan,areaPlans:[...(packingPlan.areaPlans??[]).filter(p=>p.suitcaseId!==plan.suitcaseId),saved]}};
}
/** One monotonic sequence for decode + worker results; invalidate on reset/unmount/input changes. */
export class AnalysisRequests { private value=0; next(){return ++this.value;} current(id:number){return id===this.value;} }
