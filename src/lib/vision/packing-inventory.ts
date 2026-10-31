import { bundlePackingItems, type PackingInventory } from "../packing/bundles.ts";
import { identifyObjectsInImage, type ObjectIdentificationAgent, type ObjectImage } from "./identify-objects.ts";

/** Existing identification/count/tagging stages run unchanged; F is appended. */
export async function identifyPackingInventoryInImage(image: ObjectImage, agent: ObjectIdentificationAgent): Promise<PackingInventory> {
  return bundlePackingItems(await identifyObjectsInImage(image, agent));
}
