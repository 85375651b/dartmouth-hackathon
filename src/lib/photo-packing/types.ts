import type { ItemId, SuitcaseId } from '../types.ts';
import type { Footprint, PlaneTransform, Point } from './geometry.ts';
export type Category = 1 | 2 | 3;
export interface DetectedItem {
  id: string;
  number: number;
  rawOutline: Point[];
  rectifiedOutline: Point[];
  rawPixelArea: number;
  areaCm2: number;
  envelope: Footprint & { angle: number };
  suitcaseAreaRatio: number;
  quality: string;
}
export interface Analysis {
  id:string;
  width:number;
  height:number;
  originalWidth:number;
  originalHeight:number;
  interior:Footprint;
  suitcaseBoundary:Point[];
  suitcasePixelArea:number;
  axisScale:{lengthCmPerPixel:number;widthCmPerPixel:number;cm2PerPixel:number};
  transform:PlaneTransform;
  items:DetectedItem[];
  method:string;
}
export interface Review { id:string; name:string; category:Category|0; confirmed:boolean; ignored:boolean; itemId?:ItemId }
export interface Rectangle { x:number; y:number; lengthCm:number; widthCm:number }
export interface Placement extends Rectangle { detectionId:string; rotated:boolean; category:Category }
export interface AreaLayer { placements:Placement[]; freeRegions:Rectangle[] }
export interface AreaPlan {
  suitcaseId:SuitcaseId;
  inputKey:string;
  analysis:Analysis;
  reviews:Review[];
  layers:AreaLayer[];
  unplaced:{detectionId:string;reason:string}[];
}
