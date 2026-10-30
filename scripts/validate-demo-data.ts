/**
 * Checks the bundled demo dataset: required counts, ID integrity, and limits.
 * Run with `npm run validate:data`. Exits with status 1 on any error.
 */
import { createDemoData } from "../src/lib/demo-data.ts";
import { roomZoneLoads, suitcaseLoads } from "../src/lib/loads.ts";
import { validatePackWiseData } from "../src/lib/validate.ts";

const data = createDemoData();
const { errors, warnings } = validatePackWiseData(data);

if (!data.trip.isDemo) errors.push("Demo trip must have isDemo: true.");
if (data.items.length < 15 || data.items.length > 20) {
  errors.push(`Demo data needs 15–20 items; found ${data.items.length}.`);
}
if (data.suitcases.length !== 2) errors.push(`Demo data needs 2 suitcases; found ${data.suitcases.length}.`);
if (data.roomZones.length !== 5) errors.push(`Demo data needs 5 room zones; found ${data.roomZones.length}.`);

console.log(`Trip: ${data.trip.name} (${data.items.length} items)`);
for (const load of suitcaseLoads(data)) {
  console.log(
    `  ${load.suitcase.name}: ${load.totalWeightKg}/${load.suitcase.maxWeightKg} kg, ` +
      `${load.usedLiters}/${load.suitcase.capacityLiters} L, ${load.items.length} items`,
  );
}
for (const load of roomZoneLoads(data)) {
  console.log(`  ${load.zone.name}: ${load.usedLiters}/${load.zone.capacityLiters} L, ${load.items.length} items`);
}

for (const warning of warnings) console.warn(`warning: ${warning}`);
for (const error of errors) console.error(`error: ${error}`);

if (errors.length > 0) {
  console.error(`Demo data validation failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log(`Demo data is valid (${warnings.length} warning(s)).`);
