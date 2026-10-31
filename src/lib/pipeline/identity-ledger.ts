import type { ItemId } from '../types.ts';
import type { PackingInventoryItem } from '../packing/bundles.ts';
import type { ObjectAttributes } from '../vision/object-contract.ts';
import { attributeRuleForLabel, normalizeObjectLabel } from '../vision/object-contract.ts';
import type { ItemInput, Instance } from './contracts.ts';

export interface PhysicalInstance {
  id: string; label: string; attributes: ObjectAttributes;
  origin: 'observed' | 'count_margin'; facts: ItemInput;
  observations: { photo_id: string; source_item_id: ItemId; source_ordinal: number; detection_id?: string; region?: Instance['region'] }[];
}
export interface IdentityLedger {
  instances: PhysicalInstance[];
  /** Membership -> derived group ID. Labels/attributes are never identity keys. */
  groupIds: Record<string, ItemId>;
  changeOfClothes: string[];
}
export interface IdentityGroup {
  id: ItemId; label: string; attributes: ObjectAttributes; count: number;
  observedCount: number; instanceIds: string[]; facts: ItemInput;
}
const newId = () => globalThis.crypto.randomUUID();
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return JSON.stringify(value.map(v => JSON.parse(canonical(v))));
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, JSON.parse(canonical(v))])));
  return JSON.stringify(value);
};
export const emptyLedger = (): IdentityLedger => ({ instances: [], groupIds: {}, changeOfClothes: [] });

function validate(ledger: IdentityLedger) {
  if (new Set(ledger.instances.map(i => i.id)).size !== ledger.instances.length) throw new Error('Duplicate physical instance ID.');
  if (new Set(ledger.changeOfClothes).size !== ledger.changeOfClothes.length) throw new Error('Duplicate garment selection.');
  for (const id of ledger.changeOfClothes) {
    const instance = ledger.instances.find(i => i.id === id);
    if (!instance || instance.origin !== 'observed' || !isGarment(instance.label)) throw new Error('Outfit selection must reference real observed garments.');
  }
}
export function isGarment(label: string) {
  return /^(shirt|t-shirt|pants|trousers|shorts|skirt|dress|underwear|sock|socks|jacket|coat|sweater|pajamas)$/.test(label);
}

/** Input counts already passed through count correction and F. Never rerun +1.
 * Reimporting the SAME photo/source slot is idempotent. Across photos only an
 * explicit reviewed link reuses an ID; no label/order-based physical matching.
 */
export function importIdentifiedItems(
  items: PackingInventoryItem[], photoId: string, previous: IdentityLedger = emptyLedger(),
  links: Record<string, string> = {}, facts: Record<string, ItemInput> = {}, allocate = newId,
): IdentityLedger {
  const ledger = structuredClone(previous); validate(ledger);
  const used = new Set<string>(), slots = new Set<string>();
  if (!photoId || new Set(items.map(i => i.id)).size !== items.length) throw new Error('A photo ID and unique source entries are required.');
  for (const item of items) {
    if (!Number.isSafeInteger(item.count) || item.count < 1 || item.count > 2000) throw new Error('Invalid source count.');
    const observedCount = item.label === 'shoes' || item.flags.includes('shoe_count_correction_removed') ? item.count : item.count > 5 ? item.count - 1 : item.count;
    const entryObserved: string[] = [];
    for (let ordinal = 1; ordinal <= item.count; ordinal++) {
      const slot = `${item.id}:${ordinal}`; slots.add(slot);
      const origin = ordinal <= observedCount ? 'observed' : 'count_margin';
      const observed = ledger.instances.find(i => i.observations.some(o => o.photo_id === photoId && o.source_item_id === item.id && o.source_ordinal === ordinal));
      const linked = links[slot] ? ledger.instances.find(i => i.id === links[slot]) : undefined;
      if (links[slot] && !linked) throw new Error('Photo link references an unknown instance.');
      if (linked && observed && linked.id !== observed.id) throw new Error('Photo slot already belongs to another instance.');
      // A repeated full observation of the same reviewed physical set reuses
      // its existing count margin. Rephotographing seven linked shirts must not
      // accumulate a second imaginary eighth shirt.
      const priorMargin = origin === 'count_margin' ? ledger.instances.find(i => i.origin === 'count_margin' && i.observations.some(o => {
        const siblings = ledger.instances.filter(s => s.origin === 'observed' && s.observations.some(ref => ref.photo_id === o.photo_id && ref.source_item_id === o.source_item_id)).map(s => s.id).sort();
        return canonical(siblings) === canonical([...entryObserved].sort());
      })) : undefined;
      const existing = linked ?? observed ?? priorMargin;
      if (existing) {
        if (used.has(existing.id) || existing.origin !== origin) throw new Error('A photo cannot claim an instance twice or link a margin to a real item.');
        used.add(existing.id);
        if (origin === 'observed') entryObserved.push(existing.id);
        if (!observed) existing.observations.push({ photo_id: photoId, source_item_id: item.id, source_ordinal: ordinal });
        // Preserve confirmed edits, measurements and usage; new AI text is not identity.
      } else {
        const id = `instance-${allocate()}`;
        if (ledger.instances.some(i => i.id === id)) throw new Error('ID allocator returned a duplicate instance ID.');
        ledger.instances.push({ id, label: item.label, attributes: structuredClone(item.attributes), origin,
          facts: structuredClone(facts[item.id] ?? {}), observations: [{ photo_id: photoId, source_item_id: item.id, source_ordinal: ordinal }] });
        used.add(id);
        if (origin === 'observed') entryObserved.push(id);
      }
    }
  }
  if (Object.keys(links).some(slot => !slots.has(slot))) throw new Error('Photo link references an unknown incoming slot.');
  return groupInstances(ledger, allocate).ledger;
}

export function groupInstances(source: IdentityLedger, allocate = newId): { ledger: IdentityLedger; groups: IdentityGroup[] } {
  validate(source);
  const ledger = structuredClone(source), byFacts = new Map<string, PhysicalInstance[]>();
  for (const instance of ledger.instances) {
    const key = canonical([instance.label, instance.attributes, instance.facts]);
    if (!byFacts.has(key)) byFacts.set(key, []);
    byFacts.get(key)!.push(instance);
  }
  const groups = [...byFacts.values()].map(instances => {
    instances.sort((a, b) => Number(a.origin === 'count_margin') - Number(b.origin === 'count_margin') || a.id.localeCompare(b.id));
    const membership = canonical(instances.map(i => i.id).sort());
    const id = ledger.groupIds[membership] ?? `item-group-${allocate()}`;
    ledger.groupIds[membership] = id;
    return { id, label: instances[0].label, attributes: instances[0].attributes, count: instances.length,
      observedCount: instances.filter(i => i.origin === 'observed').length, instanceIds: instances.map(i => i.id), facts: instances[0].facts };
  });
  if (new Set(groups.map(g => g.id)).size !== groups.length) throw new Error('Duplicate derived group ID.');
  return { ledger, groups };
}

export function editInstance(source: IdentityLedger, id: string, patch: { label?: string; attributes?: ObjectAttributes; facts?: ItemInput }): IdentityLedger {
  const ledger = structuredClone(source), instance = ledger.instances.find(i => i.id === id);
  if (!instance) throw new Error('Unknown physical instance.');
  const label = normalizeObjectLabel(patch.label ?? instance.label), attributes = patch.attributes ?? instance.attributes;
  const rule = attributeRuleForLabel(label);
  if (!label || (rule ? Object.keys(attributes).length !== 1 || !Object.hasOwn(attributes, rule.key)
    || ![...rule.values, null].includes((attributes as Record<string, never>)[rule.key]) : Object.keys(attributes).length > 0)) throw new Error('Attributes must match the label; unknown values must be null.');
  instance.label = label; instance.attributes = structuredClone(attributes);
  if (patch.facts) instance.facts = { ...instance.facts, ...structuredClone(patch.facts) };
  if (!isGarment(label)) ledger.changeOfClothes = ledger.changeOfClothes.filter(selected => selected !== id);
  return groupInstances(ledger).ledger;
}

export function selectGarments(source: IdentityLedger, ids: string[]): IdentityLedger {
  const ledger = { ...structuredClone(source), changeOfClothes: [...ids] }; validate(ledger); return ledger;
}
export function removeInstance(source: IdentityLedger, id: string): IdentityLedger {
  if (!source.instances.some(i => i.id === id)) throw new Error('Unknown physical instance.');
  return groupInstances({ ...source, instances: source.instances.filter(i => i.id !== id), changeOfClothes: source.changeOfClothes.filter(i => i !== id) }).ledger;
}
export function selectGarmentQuantity(source: IdentityLedger, groupId: ItemId, quantity: number): IdentityLedger {
  const { ledger, groups } = groupInstances(source), group = groups.find(g => g.id === groupId);
  if (!group || !isGarment(group.label) || !Number.isInteger(quantity) || quantity < 0 || quantity > group.observedCount) throw new Error('Choose an available quantity of observed garments.');
  const candidates = group.instanceIds.filter(id => ledger.instances.find(i => i.id === id)!.origin === 'observed');
  const chosen = [...candidates.filter(id => ledger.changeOfClothes.includes(id)), ...candidates.filter(id => !ledger.changeOfClothes.includes(id))].slice(0, quantity);
  return selectGarments(ledger, [...ledger.changeOfClothes.filter(id => !group.instanceIds.includes(id)), ...chosen]);
}

export function linkDetection(source: IdentityLedger, instanceId: string, photoId: string, detectionId: string): IdentityLedger {
  const ledger = structuredClone(source), instance = ledger.instances.find(i => i.id === instanceId);
  if (!instance || instance.origin !== 'observed' || !photoId || !detectionId) throw new Error('Only real observed instances can own a photo detection.');
  if (ledger.instances.some(i => i.id !== instanceId && i.observations.some(o => o.photo_id === photoId && o.detection_id === detectionId))) throw new Error('Detection already belongs to another instance.');
  const observation = instance.observations.find(o => o.photo_id === photoId);
  if (!observation) throw new Error('Confirm the cross-photo instance link before attaching its detection.');
  observation.detection_id = detectionId;
  return ledger;
}

export function projectLedger(source: IdentityLedger, photoId: string) {
  const { ledger, groups } = groupInstances(source);
  const instances = new Map<ItemId, Instance[]>();
  const matches: Record<string, string> = {};
  for (const group of groups) instances.set(group.id, group.instanceIds.map(id => {
    const instance = ledger.instances.find(i => i.id === id)!;
    const detection = instance.observations.find(o => o.photo_id === photoId)?.detection_id;
    if (detection) matches[detection] = id;
    return { id, item_id: group.id, origin: instance.origin };
  }));
  return { ledger, groups, instances, matches, itemInputs: Object.fromEntries(groups.map(g => [g.id, g.facts])) };
}
