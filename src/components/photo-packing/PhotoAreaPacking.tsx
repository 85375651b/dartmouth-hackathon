"use client";

import { useEffect, useRef, useState } from 'react';
import { usePackWise } from '@/state/packwise-store';
import { interiorFromInput, areaRatio, CM2_PER_IN2, type Footprint } from '@/lib/photo-packing/geometry';
import { AnalysisRequests, applyAreaPlan, areaInputKey, planAreas } from '@/lib/photo-packing/plan';
import type { Analysis, AreaPlan, Review } from '@/lib/photo-packing/types';
import type { ItemId, Suitcase, SuitcaseId } from '@/lib/types';
import { LayerViewer } from './LayerViewer';
import { baggageWarnings } from '@/lib/flights/warnings';
import type { Recognition } from '@/lib/photo-packing/recognize';

const field='mt-1 block w-full min-w-0 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm';
const button='rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-45';
const fmt=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n);
function savedInterior(bag:Suitcase|undefined):Footprint|undefined {
  // Old in-memory objects may carry a previously confirmed interior. Read only its two axes.
  const value=bag?.interiorFootprintCm??(bag as (Suitcase&{interiorDimensionsCm?:Footprint})|undefined)?.interiorDimensionsCm;
  return value&&value.lengthCm>0&&value.widthCm>0?{lengthCm:value.lengthCm,widthCm:value.widthCm}:undefined;
}
export function PhotoAreaPacking(){const {resetVersion}=usePackWise();return <PhotoAreaPackingInner key={resetVersion}/>;}
function PhotoAreaPackingInner(){
  const {data,dispatch}=usePackWise();
  const [bagId,setBagId]=useState<SuitcaseId>(data.suitcases[0]?.id);
  const initial=savedInterior(data.suitcases[0]);
  const [length,setLength]=useState(initial?String(initial.lengthCm):''),[width,setWidth]=useState(initial?String(initial.widthCm):'');
  const [unit,setUnit]=useState<'cm'|'in'>('cm'),[file,setFile]=useState<File|null>(null),[photo,setPhoto]=useState(''),[uploadVersion,setUploadVersion]=useState(0);
  const [analysis,setAnalysis]=useState<Analysis|null>(null),[reviews,setReviews]=useState<Review[]>([]),[preview,setPreview]=useState<AreaPlan|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[sceneReviewed,setSceneReviewed]=useState(false);
  const [recognitionStatus,setRecognitionStatus]=useState(''),[geometryIssues,setGeometryIssues]=useState<string[]>([]),[compare,setCompare]=useState<string[]>(['','']);
  const recognitionAbort=useRef<AbortController|null>(null);const reviewEdits=useRef(new Set<string>());
  const requests=useRef(new AnalysisRequests()),worker=useRef<Worker|null>(null);
  const clearAnalysis=()=>{requests.current.next();worker.current?.terminate();recognitionAbort.current?.abort();worker.current=null;setBusy(false);setRecognitionStatus('');setGeometryIssues([]);reviewEdits.current.clear();setAnalysis(null);setReviews([]);setPreview(null);setSceneReviewed(false);setCompare(['','']);setError('');setMessage('');};
  useEffect(()=>()=>{requests.current.next();worker.current?.terminate();recognitionAbort.current?.abort();},[]);
  function changeDimensions(which:'length'|'width',value:string){clearAnalysis();if(which==='length')setLength(value);else setWidth(value);}
  function updateReview(id:string,patch:Partial<Review>){reviewEdits.current.add(id);setReviews(old=>old.map(r=>r.id===id?{...r,...patch}:r));setMessage('');}
  let inputValid=false,dimensions:Footprint|undefined;
  try{dimensions=interiorFromInput(length,width,unit);inputValid=true;}catch{/* Fields announce errors when analysis is requested. */}
  const currentKey=analysis?areaInputKey(data,bagId,analysis,reviews):'';
  const stale=!!preview&&preview.inputKey!==currentKey;
  const geometryIssue=geometryIssues.some(id=>reviews.some(r=>r.id===id&&!r.ignored));
  const ready=analysis&&sceneReviewed&&!geometryIssue&&reviews.some(r=>!r.ignored)&&reviews.filter(r=>!r.ignored).every(r=>r.confirmed&&r.name.trim()&&r.category>0);
  async function analyze(){
    recognitionAbort.current?.abort();reviewEdits.current.clear();setRecognitionStatus('');setGeometryIssues([]);setError('');setMessage('');setPreview(null);setAnalysis(null);setReviews([]);setSceneReviewed(false);
    let base:Footprint;try{base=interiorFromInput(length,width,unit);if(!file)throw new Error('Upload a top-down photograph.');}catch(e){setError((e as Error).message);return;}
    const ticket=requests.current.next();worker.current?.terminate();setBusy(true);
    try{
      if(file!.size>20*1024*1024)throw new Error('Use a photograph smaller than 20 MB.');
      const bitmap=await createImageBitmap(file!,{imageOrientation:'from-image'});
      if(!requests.current.current(ticket)){bitmap.close();return;}
      if(bitmap.width*bitmap.height>40_000_000){bitmap.close();throw new Error('Use a photograph no larger than 40 megapixels.');}
      const original={width:bitmap.width,height:bitmap.height},scale=Math.min(1,1000/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
      const context=canvas.getContext('2d',{willReadFrequently:true});if(!context){bitmap.close();throw new Error('This browser cannot read photograph pixels.');}
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      const raster=context.getImageData(0,0,canvas.width,canvas.height);setPhoto(canvas.toDataURL('image/jpeg',0.9));
      const active=new Worker(new URL('../../lib/photo-packing/detect.worker.ts',import.meta.url));worker.current=active;
      active.onmessage=(event:MessageEvent<{analysis?:Analysis;error?:string}>)=>{
        active.terminate();if(!requests.current.current(ticket))return;worker.current=null;setBusy(false);
        if(event.data.error){setError(event.data.error);return;}
        const result=event.data.analysis;if(!result){setError('No usable detection result. Retake the photograph.');return;}
        setAnalysis(result);setReviews(result.items.map(item=>({id:item.id,name:`Item ${item.number}`,category:0,confirmed:false,ignored:false})));void identify(result,canvas,ticket);
      };
      active.onerror=()=>{active.terminate();if(requests.current.current(ticket)){worker.current=null;setBusy(false);setError('The local image processor could not run. Retry in a browser supporting image decoding and workers.');}};
      active.postMessage({raster:{width:raster.width,height:raster.height,data:raster.data},interior:base,id:`photo-${crypto.randomUUID()}`,original},[raster.data.buffer]);
    }catch(e){if(requests.current.current(ticket)){setBusy(false);setError(e instanceof Error?e.message:'Photo analysis failed. Retake the photograph.');}}
  }
  async function identify(result:Analysis,source:HTMLCanvasElement,ticket:number){
    setRecognitionStatus('Claude is identifying the measured item regions…');const abort=new AbortController();recognitionAbort.current=abort;
    try{
      const crops=result.items.map(item=>{const xs=item.rawOutline.map(p=>p.x),ys=item.rawOutline.map(p=>p.y),x=Math.max(0,Math.floor(Math.min(...xs))-5),y=Math.max(0,Math.floor(Math.min(...ys))-5),w=Math.min(source.width-x,Math.ceil(Math.max(...xs))-x+5),h=Math.min(source.height-y,Math.ceil(Math.max(...ys))-y+5);const crop=document.createElement('canvas'),scale=Math.min(1,256/Math.max(w,h));crop.width=Math.max(1,Math.round(w*scale));crop.height=Math.max(1,Math.round(h*scale));crop.getContext('2d')!.drawImage(source,x,y,w,h,0,0,crop.width,crop.height);return {id:item.id,image:crop.toDataURL('image/jpeg',.82)};});
      const response=await fetch('/api/recognize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({crops}),signal:abort.signal});const body=await response.json();if(!requests.current.current(ticket))return;if(!response.ok)throw new Error(body.error||'Automatic recognition failed.');
      const suggestions=body.items as Recognition[];
      setReviews(old=>old.map(r=>{const suggestion=suggestions.find(s=>s.id===r.id);return suggestion&&!reviewEdits.current.has(r.id)?{...r,name:suggestion.name,category:suggestion.category,uncertainty:suggestion.uncertainty}:r;}));
      const badIds=suggestions.filter(s=>s.geometryIssue).map(s=>s.id),bad=badIds.length>0;setGeometryIssues(badIds);if(bad){setPreview(null);setSceneReviewed(false);}
      setRecognitionStatus(bad?'Recognition flagged a partial or merged region. Retake the photo before generating a plan.':'Claude suggestions are ready. Confirm or correct each identity and category; no dimensions were supplied by the model.');
    }catch(e){if(requests.current.current(ticket))setRecognitionStatus(e instanceof Error?e.message:'Automatic identification failed; review names and categories manually.');}
  }
  function generate(){try{if(!analysis||!sceneReviewed||geometryIssue)throw new Error('Review the complete detection overlay first.');setPreview(planAreas(data,bagId,analysis,reviews));setError('');setMessage('2D proposal generated. Review each layer before applying.');}catch(e){setError((e as Error).message);}}
  function apply(){try{if(!preview||stale||!sceneReviewed)throw new Error('Review and regenerate the current proposal first.');const next=applyAreaPlan(data,preview);dispatch({type:'applyAreaPlan',plan:preview});setPreview(next.packingPlan.areaPlans!.find(p=>p.suitcaseId===bagId)!);setError('');setMessage('Area plan saved locally. Only explicitly linked, placed inventory entries were moved. No new inventory measurements or entries were created.');}catch(e){setError((e as Error).message);}}
  const stored=data.packingPlan.areaPlans?.find(p=>p.suitcaseId===bagId);
  const storedCurrent=stored&&stored.inputKey===areaInputKey(data,bagId,stored.analysis,stored.reviews);
  const showArea=(value:number)=>`${fmt(unit==='in'?value/CM2_PER_IN2:value)} ${unit==='in'?'in²':'cm²'}`;
  return <section aria-labelledby="photo-area-heading" className="min-w-0 space-y-5 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
    <header><p className="text-xs font-medium uppercase tracking-wide text-brand-600">Your photo → your packing plan</p><h2 id="photo-area-heading" className="mt-1 text-xl font-semibold">Pack from a top-down photo</h2><p className="mt-2 text-sm text-stone-600">No flight number needed. Start with one photo for automatic boundaries, reviewed categories, and layer arrangements. Pixel measurements run on this device. After analysis, item crops are sent to Anthropic’s Claude API for name and category suggestions; review every suggestion.</p></header>
    <div className="rounded-lg bg-stone-50 p-4 text-sm leading-relaxed"><p>Open your suitcase and photograph its empty interior straight from above. Place the items you want to pack beside it, on the same flat surface, with space between them. Keep the whole suitcase opening and every item visible. Avoid overlapping items, strong shadows, wide-angle distortion, and tilted camera angles.</p><p className="mt-2">Use a plain contrasting background and a clearly visible suitcase rim. Fold or roll items into their actual packing shape first. Keep the interior and items as close as practical to the same reference plane. Raised objects and suitcase walls introduce perspective error. These are footprint estimates, not a 3D fit guarantee.</p><p className="mt-2">This local detector supports clear, separated regions and a nearly rectangular, relatively uniform empty interior. It cannot measure hidden edges or safely separate touching items. Lighting gradients, multiple background colors and connected clamshell halves have automatic fallback handling; unclear boundaries can still require a retake. Retake unclear scenes; no manual tracing is required.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">Suitcase for this photo<select aria-label="Suitcase for this photo" className={field} value={bagId} onChange={e=>{clearAnalysis();const id=e.target.value as SuitcaseId;setBagId(id);setUnit('cm');const saved=savedInterior(data.suitcases.find(b=>b.id===id));setLength(saved?String(saved.lengthCm):'');setWidth(saved?String(saved.widthCm):'');}}>{data.suitcases.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="text-sm">Interior units<select aria-label="Interior units" className={field} value={unit} onChange={e=>{const next=e.target.value as 'cm'|'in';const factor=next==='in'?1/2.54:2.54;setLength(length&&Number.isFinite(Number(length))?String(Number(length)*factor):length);setWidth(width&&Number.isFinite(Number(width))?String(Number(width)*factor):width);setUnit(next);}}><option value="cm">Centimeters</option><option value="in">Inches</option></select></label>
      <label className="text-sm">Usable interior length ({unit})<input className={field} aria-label={`Usable interior length (${unit})`} inputMode="decimal" value={length} onChange={e=>changeDimensions('length',e.target.value)}/></label>
      <label className="text-sm">Usable interior width ({unit})<input className={field} aria-label={`Usable interior width (${unit})`} inputMode="decimal" value={width} onChange={e=>changeDimensions('width',e.target.value)}/></label>
    </div>
    {length.trim()&&width.trim()&&!inputValid&&<p role="alert" className="text-sm text-amber-900">Enter positive, finite interior length and width before analyzing the photo.</p>}
    <p className="text-xs text-stone-600">Measure the usable flat interior, excluding wheels, handles, lining, dividers and curved edges. Exterior dimensions are not used. {dimensions&&`Layer base area: ${showArea(dimensions.lengthCm*dimensions.widthCm)}.`}</p>
    <label className="block rounded-lg border border-dashed border-brand-300 p-4 text-sm font-medium">Top-down suitcase and items photo<input aria-label="Top-down suitcase and items photo" key={uploadVersion} type="file" accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full min-w-0 text-sm" onChange={e=>{clearAnalysis();setPhoto('');setFile(e.target.files?.[0]??null);}}/><span className="mt-2 block text-xs font-normal text-stone-500">JPEG, PNG or WebP; up to 20 MB. Analyze sends measured item crops to Claude through this app’s server. Photos are not saved by this app.</span></label>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!file||busy||!inputValid} onClick={analyze}>{busy?'Analyzing image locally…':'Analyze photo'}</button><button type="button" className="rounded-md border border-stone-300 px-4 py-2 text-sm" onClick={()=>{clearAnalysis();dispatch({type:'clearAreaPlan',suitcaseId:bagId});setFile(null);setPhoto('');setUploadVersion(v=>v+1);}}>Clear photo and results</button></div>
    {busy&&<p role="status" className="text-sm">Reading image regions and calculating footprint ratios…</p>}
    {error&&<p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
    {recognitionStatus&&<p role="status" className="rounded-lg bg-stone-50 p-3 text-sm text-stone-700">{recognitionStatus}</p>}
    {message&&<p role="status" className="text-sm text-brand-700">{message}</p>}
    {analysis?.reviewNotes&&<div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{analysis.reviewNotes.map(note=><p key={note} className="mb-1 last:mb-0">{note}</p>)}</div>}
    {photo&&<figure><svg role="img" aria-label="Photograph with automatic suitcase and numbered item outlines" viewBox={`0 0 ${analysis?.width??800} ${analysis?.height??600}`} className="max-h-[550px] w-full rounded-lg border border-stone-200 bg-stone-50"><image href={photo} width="100%" height="100%" preserveAspectRatio="xMidYMid meet"/>{analysis&&<>{analysis.excludedBoundaries?.map((boundary,index)=><polygon key={index} points={boundary.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#64748b" strokeWidth="2" strokeDasharray="6 4"/>)}<polygon points={analysis.suitcaseBoundary.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#087f5b" strokeWidth="3"/>{[0,1].map(axis=>{const a=analysis.suitcaseBoundary[axis],b=analysis.suitcaseBoundary[axis+1];return <text key={axis} x={(a.x+b.x)/2} y={(a.y+b.y)/2-5} textAnchor="middle" fontSize="13" fill="#065f46" stroke="white" strokeWidth=".5" paintOrder="stroke">{axis===0?'Length':'Width'}</text>;})}{analysis.items.map(item=>{const ignored=reviews.find(r=>r.id===item.id)?.ignored;const p=item.rawOutline[0];return <g key={item.id} opacity={ignored?.3:1}><polygon points={item.rawOutline.map(p=>`${p.x},${p.y}`).join(' ')} fill="#f59e0b" fillOpacity=".15" stroke="#b45309" strokeWidth="2"/><circle cx={p.x+9} cy={p.y+9} r="12" fill="#fff"/><text x={p.x+9} y={p.y+13} textAnchor="middle" fontSize="14" fill="#1c1917">{item.number}</text></g>;})}</>}</svg><figcaption className="mt-2 text-xs text-stone-600">Green: automatically detected usable opening. Numbered orange regions: detected item outlines. Dashed gray, when shown: the other detected suitcase half. Verify every region; boundaries are not manually editable.</figcaption></figure>}
    {analysis&&<>
      <div className="rounded-lg border border-stone-200 p-4 text-sm"><h3 className="font-semibold">Review detections and categories</h3><p className="mt-1">{analysis.items.length} item regions detected. Areas come from transformed image pixels. Packing uses conservative oriented bounding footprints, including gaps inside irregular shapes.</p><p className="mt-2 text-xs text-stone-600">Claude suggests names and categories from the item crops. Confirm each suggestion; unknown constructions and contents can change the category.</p></div>
      <div className="grid gap-3 md:grid-cols-2">{analysis.items.map(item=>{const review=reviews.find(r=>r.id===item.id)!;return <article key={item.id} aria-label={`Detected item ${item.number}`} className={`min-w-0 space-y-3 rounded-lg border border-stone-200 p-4 ${review.ignored?'opacity-60':''}`}>
        <h4 className="font-semibold">{item.number}. {review.name}</h4>{geometryIssues.includes(item.id)&&!review.ignored&&<p role="alert" className="text-sm text-amber-900">This region may be incomplete or merged. Retake if it is an intended item, or ignore it if it is a false-positive/background region.</p>}<p className="text-sm">{item.areaKind==='outline'?'Conservative outline area':'Estimated segmented footprint'}: {showArea(item.areaCm2)} · {fmt(item.suitcaseAreaRatio*100)}% of suitcase base.<br/>Conservative bounding footprint: {showArea(item.envelope.lengthCm*item.envelope.widthCm)}.</p><p className="text-xs text-stone-500">{review.uncertainty??item.quality}</p>
        <label className="block text-sm">Item {item.number} name<input aria-label={`Item ${item.number} name`} className={field} value={review.name} maxLength={120} onChange={e=>updateReview(item.id,{name:e.target.value,confirmed:false})}/></label>
        <label className="block text-sm">Item {item.number} category<select aria-label={`Item ${item.number} category`} className={field} value={review.category} onChange={e=>updateReview(item.id,{category:Number(e.target.value) as Review['category'],confirmed:false})}><option value={0}>Choose category if uncertain</option><option value={1}>1 · Rigid</option><option value={2}>2 · Semi-rigid / foldable</option><option value={3}>3 · Puffy</option></select></label>
        <details><summary className="cursor-pointer text-sm">Optional: associate item {item.number} with inventory</summary><label className="mt-2 block text-sm">Inventory entry for item {item.number}<select aria-label={`Inventory entry for item ${item.number}`} className={field} value={review.itemId??''} onChange={e=>updateReview(item.id,{itemId:(e.target.value||undefined) as ItemId|undefined,confirmed:false})}><option value="">Keep photo-only; do not change inventory</option>{data.items.map(i=><option key={i.id} value={i.id}>{i.name} · bundle of {i.quantity} · {i.id}</option>)}</select></label><p className="mt-2 text-xs text-stone-600">Link only if this region shows the whole entry/bundle. Names are not matched automatically. Known carry-on, fragility and cleanliness restrictions remain in force.</p></details>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={review.confirmed} disabled={review.ignored||!review.category||!review.name.trim()||geometryIssues.includes(item.id)} onChange={e=>updateReview(item.id,{confirmed:e.target.checked})}/><span>I confirm item {item.number}’s identity, complete region and category.</span></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={review.ignored} onChange={e=>updateReview(item.id,{ignored:e.target.checked,confirmed:false})}/><span>Ignore item {item.number} — false-positive detection.</span></label>
      </article>;})}</div>
      <div className="flex flex-wrap gap-3 text-sm">{[0,1].map((n)=><label key={n} className="min-w-0 flex-1">Compare item {n===0?'A':'B'}<select aria-label={`Compare item ${n===0?'A':'B'}`} className={field} value={compare[n]} onChange={e=>setCompare(old=>old.map((v,i)=>i===n?e.target.value:v))}><option value="">Choose detected item</option>{analysis.items.map(i=><option key={i.id} value={i.id}>{i.number}. {reviews.find(r=>r.id===i.id)?.name}</option>)}</select></label>)}</div>
      {compare.every(Boolean)&&<p className="text-sm">Item A / item B footprint ratio: {fmt(areaRatio(analysis.items.find(i=>i.id===compare[0])!.areaCm2,analysis.items.find(i=>i.id===compare[1])!.areaCm2))}. Perspective-corrected areas are compared, rather than raw image counts when scale varies.</p>}
      <label className="flex items-start gap-2 rounded-lg bg-stone-50 p-3 text-sm"><input type="checkbox" checked={sceneReviewed} onChange={e=>{setSceneReviewed(e.target.checked);setPreview(null);}}/><span>I reviewed the overlay: the green boundary follows the empty usable interior, and every included numbered region contains exactly one complete item or bundle. No items are missing, merged, cropped or obscured.</span></label>
      <button type="button" className="text-sm font-medium text-amber-900 underline" onClick={()=>{clearAnalysis();setError('Detection is incomplete or unclear. Retake the photograph with more separation, contrast and a clearly empty interior. Do not rely on the previous estimates.');}}>Something is missing, merged or incorrectly outlined — retake photo</button>
      <div><button type="button" className={button} disabled={!ready} onClick={generate}>Generate 2D layer plan</button></div>
    </>}
    {preview&&<div aria-label="2D layer proposal" className="space-y-4 border-t border-stone-200 pt-4"><h3 className="text-lg font-semibold">Your 2D layer proposal</h3><p className="text-sm font-medium text-amber-900">These layers show footprint arrangements only. Check the suitcase’s real height and ability to close as you pack.</p><p className="text-sm text-stone-600">Rigid → semi-rigid → puffy, sharing partially occupied layers. Rectangular envelopes intentionally leave gaps. This deterministic heuristic does not guarantee the best possible arrangement. No physical stacking or closure is verified.</p>
      {stale&&<p role="alert" className="text-sm text-amber-900">Inputs or inventory changed. This proposal is stale; generate it again before Apply.</p>}
      <LayerViewer key={JSON.stringify([preview.analysis.id,preview.analysis.interior,preview.reviews,preview.layers,data.items.filter(i=>preview.reviews.some(r=>r.itemId===i.id))])} plan={preview} stale={stale}/>
      {!!preview.unplaced.length&&<div><h4 className="font-semibold">Unplaced items</h4><ul className="mt-2 list-disc pl-5 text-sm">{preview.unplaced.map(p=><li key={p.detectionId}>{preview.reviews.find(r=>r.id===p.detectionId)?.name}: {p.reason}</li>)}</ul></div>}
      <p className="text-xs text-stone-600">Apply saves this area blueprint and the confirmed interior footprint. Only explicitly linked, placed entries move to this suitcase; other contents, unplaced entries, other assignments and all inventory measurements remain unchanged. Unpictured contents are not represented in these diagrams. Existing weight and stored-estimate meters are separate legacy inventory features.</p>
      <button type="button" className={button} disabled={stale||!sceneReviewed||stored?.inputKey===preview.inputKey} onClick={apply}>{stored?.inputKey===preview.inputKey?'Applied locally':'Apply 2D packing plan'}</button>
    </div>}
    {dimensions&&data.flightLookup&&<div className="rounded-lg border border-stone-200 p-3 text-sm"><h3 className="font-semibold">Baggage cross-check</h3>{baggageWarnings(data,bagId,dimensions,data.flightLookup.rules).map((warning,i)=><p role="alert" key={i} className="mt-2 text-amber-900">{warning}</p>)}<p className="mt-2 text-xs text-stone-500">Your measured interior footprint is only a lower bound for exterior size. Exterior dimensions, complete weight, travel date and ticket entitlement remain unverified. No warning is not airline clearance.</p></div>}
    {stored&&<p className="text-sm text-brand-700">{storedCurrent?`Saved area blueprint: ${stored.layers.length} proposed layers. Physical fit is unverified.`:'Saved area blueprint needs review after inventory or assignment changes.'}</p>}
    <p className="text-xs leading-relaxed text-stone-500">Two-dimensional ratios assume a shared flat reference plane. Planar correction does not fix raised objects, curved geometry, lens distortion, uncertain edges or differences between reference planes. Neither segmented areas nor envelope arrangements prove physical fit. Review the actual arrangement as you pack.</p>
  </section>;
}
