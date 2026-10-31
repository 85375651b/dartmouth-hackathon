import type { PackWiseData } from './types.ts';
/** A real empty session, with one unnamed physical bag slot and no assumed measurements. */
export function createEmptyData():PackWiseData {
 return {
  trip:{id:'trip-current',name:'Your packing plan',origin:'',destination:'',purpose:'',departureDate:'',durationDays:null,itemIds:[],suitcaseIds:['case-current'],roomZoneIds:[],isDemo:false},
  items:[],suitcases:[{id:'case-current',name:'Your suitcase',kind:'unknown',emptyWeightKg:null,maxWeightKg:null,capacityLiters:null,dimensionsCm:null}],roomZones:[],
  packingPlan:{id:'pack-current',tripId:'trip-current',assignments:[],unassignedItemIds:[]},
  unpackingPlan:{id:'unpack-current',tripId:'trip-current',packingPlanId:'pack-current',assignments:[],unassignedItemIds:[]},
 };
}
