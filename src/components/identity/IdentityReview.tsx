'use client';

import { useEffect, useRef, useState } from 'react';
import { editInstance, groupInstances, importIdentifiedItems, isGarment, removeInstance, selectGarments, selectGarmentQuantity,
  type IdentityLedger } from '../../lib/pipeline/identity-ledger';
import { attributeRuleForLabel, normalizeObjectLabel, type ObjectAttributes } from '../../lib/vision/object-contract';
import type { PackingInventoryItem } from '../../lib/packing/bundles';
import type { PipelineBag, PipelineResult } from '../../lib/pipeline/contracts';

const bags: PipelineBag[] = [
  { id: 'case-review-cabin', kind: 'carry-on', interiorIn: { lengthIn: 22, widthIn: 14, heightIn: 9 }, emptyWeightKg: 2, maxWeightKg: 10, capacityLiters: 40 },
  { id: 'case-review-checked', kind: 'checked', interiorIn: { lengthIn: 28, widthIn: 18, heightIn: 12 }, emptyWeightKg: 4, maxWeightKg: 23, capacityLiters: 90 },
];
const field = 'rounded border border-slate-300 bg-white px-2 py-1 text-slate-900';
export function IdentityReview({ initialLedger }: { initialLedger: IdentityLedger }) {
  const [ledger, setLedger] = useState(initialLedger), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [pending, setPending] = useState<{ photoId: string; items: PackingInventoryItem[] } | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const revision = useRef(0);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);
  const { groups } = groupInstances(ledger);
  function change(action: () => IdentityLedger) {
    try { setLedger(action()); revision.current++; setResult(null); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Please check your edits.'); }
  }
  async function identify(file: File) {
    setBusy(true); setError(''); setPending(null);
    setPhotoUrl(URL.createObjectURL(file));
    try {
      const form = new FormData(); form.append('image', file);
      const response = await fetch('/api/identify-objects', { method: 'POST', body: form });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setPending({ photoId: `photo-${crypto.randomUUID()}`, items: data.items }); setLinks({});
    } catch (e) { setError(e instanceof Error ? e.message : 'Identification failed.'); } finally { setBusy(false); }
  }
  async function preview() {
    setBusy(true); setError(''); setResult(null);
    const requestRevision = revision.current;
    try {
      const response = await fetch('/api/packing-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ledger, bags, photoId: 'review-demo' }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (requestRevision === revision.current) setResult(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Preview failed.'); } finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-5xl space-y-6 p-6 text-slate-900">
    <a href="/" className="text-blue-700 underline">Back to PackWise</a>
    <h1 className="text-3xl font-bold">Review items and choose a change of clothes</h1>
    <p>Demo inventory · Edits stay in this tab. Each object keeps its identity when you rename it or change its measurements.</p>
    <p className="rounded bg-amber-100 p-3">Packing previews use sample suitcases and labeled placeholder measurements. They are illustrative, not verified fit or baggage clearance.</p>
    <label className="block">Identify another photo with Claude <input aria-label="Identify photo" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
      onChange={e => { const file = e.target.files?.[0]; if (file) void identify(file); }} className="block py-2" /></label>
    {pending && <section className="space-y-3 rounded border p-4"><h2 className="text-xl font-semibold">Confirm identities in the new photo</h2>
      {photoUrl && <img src={photoUrl} alt="Your uploaded belongings, for manual identity review" className="max-h-80 max-w-full rounded object-contain" />}
      <p>The identifier reports counts, not object locations. Match objects manually against your photo; no automatic cross-photo match is assumed.</p>
      <p>Choose an existing object only when it is the same physical object. Unlinked entries are added; objects absent from this photo remain in your inventory.</p>
      {pending.items.flatMap(item => Array.from({ length: item.count }, (_, index) => {
        const slot = `${item.id}:${index + 1}`, margin = item.label !== 'shoes' && item.count > 5 && index === item.count - 1;
        return <label key={slot} className="flex flex-wrap items-center gap-3">{item.label} #{index + 1}{margin ? ' (count margin)' : ''}
          <select aria-label={`Match ${item.label} ${index + 1}`} className={field} value={links[slot] ?? ''} disabled={margin}
            onChange={e => setLinks({ ...links, [slot]: e.target.value })}>
            <option value="">New {margin ? 'margin estimate' : 'object'}</option>
            {ledger.instances.filter(i => i.origin === 'observed').map(i => <option key={i.id} value={i.id}>{i.label} · {i.id.slice(-6)}</option>)}
          </select></label>;
      }))}
      <button className="rounded bg-blue-700 px-3 py-2 text-white" onClick={() => {
        try { const next = importIdentifiedItems(pending.items, pending.photoId, ledger, Object.fromEntries(Object.entries(links).filter(([, id]) => id)));
          setLedger(next); revision.current++; setPending(null); setResult(null); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Invalid identity links.'); }
      }}>Confirm photo identities</button>
    </section>}
    {groups.map(group => <section key={group.id} className="space-y-3 rounded border border-slate-300 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{group.label} × {group.count}</h2>
        {isGarment(group.label) && <label>Change-of-clothes quantity <select aria-label={`Outfit quantity ${group.id}`} className={field}
          value={group.instanceIds.filter(id => ledger.changeOfClothes.includes(id)).length}
          onChange={e => change(() => selectGarmentQuantity(ledger, group.id, Number(e.target.value)))}>
          {Array.from({ length: group.observedCount + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
        </select></label>}
      </div>
      {group.instanceIds.map(id => {
        const instance = ledger.instances.find(i => i.id === id)!, rule = attributeRuleForLabel(instance.label);
        return <div key={id} data-instance-id={id} className="flex flex-wrap items-end gap-3 border-t border-slate-200 pt-3">
          <span className="w-full text-sm text-slate-600">Object {id.slice(-6)} · {instance.origin === 'count_margin' ? 'Synthetic count margin—not a photographed garment' : 'Observed object'}</span>
          <label>Name <input aria-label={`Name ${id}`} className={`${field} block w-36`} defaultValue={instance.label} key={`${id}:${instance.label}`}
            onBlur={e => { const label = normalizeObjectLabel(e.target.value), nextRule = attributeRuleForLabel(label);
              if (label !== instance.label) change(() => editInstance(ledger, id, { label, attributes: nextRule ? { [nextRule.key]: null } as ObjectAttributes : {} })); }} /></label>
          {rule && <label>{rule.key}<select aria-label={`Attribute ${id}`} className={`${field} block`} value={Object.values(instance.attributes)[0] ?? ''}
            onChange={e => change(() => editInstance(ledger, id, { attributes: { [rule.key]: e.target.value || null } as ObjectAttributes }))}>
            <option value="">Unknown</option>{rule.values.map(value => <option key={value}>{value}</option>)}
          </select></label>}
          <label>Container ml <input aria-label={`Capacity ${id}`} type="number" min="1" className={`${field} block w-28`}
            defaultValue={instance.facts.baggage?.containerCapacityLiters == null ? '' : instance.facts.baggage.containerCapacityLiters * 1000}
            onBlur={e => { const value = e.target.value === '' ? undefined : Number(e.target.value) / 1000;
              if (value !== undefined && (!Number.isFinite(value) || value <= 0)) { setError('Capacity must be positive.'); return; }
              change(() => editInstance(ledger, id, { facts: { baggage: { ...instance.facts.baggage, containerCapacityLiters: value } } })); }} /></label>
          <label>Unit kg <input aria-label={`Weight ${id}`} type="number" min="0.001" step="any" className={`${field} block w-24`} defaultValue={instance.facts.unitWeightKg ?? ''}
            onBlur={e => { const value = e.target.value === '' ? undefined : Number(e.target.value);
              if (value !== undefined && (!Number.isFinite(value) || value <= 0)) { setError('Weight must be positive.'); return; }
              change(() => editInstance(ledger, id, { facts: { unitWeightKg: value } })); }} /></label>
          {isGarment(instance.label) && <label className="py-1"><input aria-label={`Outfit ${id}`} type="checkbox" disabled={instance.origin === 'count_margin'}
            checked={ledger.changeOfClothes.includes(id)} onChange={e => change(() => selectGarments(ledger, e.target.checked
              ? [...ledger.changeOfClothes, id] : ledger.changeOfClothes.filter(selected => selected !== id)))} /> Change of clothes</label>}
          <button className="text-red-700 underline" aria-label={`Remove ${id}`} onClick={() => change(() => removeInstance(ledger, id))}>Remove</button>
        </div>;
      })}
    </section>)}
    <p>{ledger.changeOfClothes.length} observed garments selected. Their packing units prefer the carry-on and the top; hard baggage restrictions still take precedence.</p>
    <button disabled={busy || ledger.instances.length === 0} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50" onClick={() => void preview()}>{busy ? 'Working…' : 'Preview packing with sample measurements'}</button>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {result && <section aria-live="polite" className="space-y-2 rounded bg-slate-100 p-4"><h2 className="text-xl font-semibold">{result.status === 'illustrative' ? 'Illustrative packing preview' : 'Packing review'}</h2>
      <p>{result.placements.length} units placed · {result.fallback.length} unassigned · {result.items.length} derived groups</p>
      {result.issues.map((issue, i) => <p key={i}>{issue}</p>)}
      <ul>{result.units.map(unit => <li key={unit.id}>{result.items.filter(item => item.instances.some(i => unit.instance_ids.includes(i.id))).map(i => i.label).join(', ')}
        {' → '}{result.placements.find(p => p.unit_id === unit.id)?.bag_id === 'case-review-cabin' ? 'Carry-on' : result.placements.some(p => p.unit_id === unit.id) ? 'Checked bag' : 'Unassigned'}
        {unit.preferCarryOn ? ' · carry-on preferred' : ''}</li>)}</ul>
      <details><summary>Estimate details</summary>{result.warnings.map((warning, i) => <p key={i} className="py-1 text-sm">{warning}</p>)}</details>
    </section>}
  </main>;
}
