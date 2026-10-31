"use client";
import { TripSettings } from '@/components/trip/TripSettings';
import { PhotoAreaPacking } from '@/components/photo-packing/PhotoAreaPacking';
import { InventoryEditor } from '@/components/InventoryEditor';
import { usePackWise } from '@/state/packwise-store';
export function PackWiseDashboard(){
 const {data,dispatch}=usePackWise();
 return <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-7 sm:px-6 lg:py-10">
  <header className="flex flex-wrap items-center justify-between gap-5"><a href="#" className="flex items-center gap-3" aria-label="ClaudePack home"><img src="/claudepack-mark.svg" width="58" height="58" alt=""/><div><h1 className="text-3xl font-semibold tracking-tight text-brand-900 sm:text-4xl">ClaudePack<span className="text-[#ba7953]">.</span></h1></div></a><nav aria-label="Main navigation" className="flex gap-5 text-sm font-medium text-brand-700"><a href="#flight-options">Flight limits (optional)</a><a href="#photo-area-heading">Pack your case ↗</a></nav></header>
  <div className="rounded-2xl bg-brand-900 px-6 py-7 text-[#f5f1e8] sm:px-8"><p className="text-xs font-medium uppercase tracking-[.18em] text-[#d9b89d]">A little order before takeoff</p><h2 className="mt-3 text-2xl font-medium tracking-tight sm:text-3xl">Your next adventure.<br/>Packed one layer at a time.</h2><p className="mt-3 max-w-xl text-sm leading-relaxed text-[#d4dfd6]">Start with a photo of your suitcase and the things coming with you. We’ll help turn the pile into a plan. Add a flight later if you want baggage checks.</p></div>
  <PhotoAreaPacking/>
  <details id="flight-options" className="rounded-2xl border border-stone-200 bg-white p-5"><summary className="cursor-pointer text-sm font-semibold">Optional flight &amp; baggage lookup</summary><div className="mt-4"><TripSettings/></div></details>
  <details className="rounded-2xl border border-stone-200 bg-white p-5"><summary className="cursor-pointer text-sm font-semibold">Optional inventory · {data.items.length} entries</summary><p className="mt-2 text-xs text-stone-500">Keep real known weights and handling notes here. Photo estimates never invent weights or update these measurements automatically.</p><div className="mt-4"><InventoryEditor items={data.items} onChange={items=>dispatch({type:'setItems',items})}/></div></details>
  <footer className="flex flex-wrap justify-between gap-2 border-t border-stone-200 pt-4 text-xs text-stone-500"><span>ClaudePack</span><span>Session-only · no account needed · no volume-based packing</span></footer>
 </div>;
}
