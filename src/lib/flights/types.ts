export interface FlightOccurrence { date:string; airline:string; airlineIata:string; operatingFlight:string|null; origin:string;destination:string;departure:string|null;arrival:string|null;departureZone:string;arrivalZone:string;status:string;codeshare:boolean }
export interface BaggageRule {
 type:'carry-on'|'personal'|'checked'; label:string; dimensionsCm:number[]|null;linearCm:number|null;weightKg:number|null;includedBags:number|null;
 applicability:'conditional'; condition:string; sourceUrl:string;retrievedAt:string;evidence:string;
}
export interface FlightLookup { original:string;normalized:string;retrievedAt:string;occurrences:FlightOccurrence[];rules:BaggageRule[];policyMessage:string; sources:{url:string;title:string}[]; }
