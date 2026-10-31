/** Pure planar geometry; inputs and output are lengths/areas only. */
export interface Point { x: number; y: number }
export interface Footprint { lengthCm: number; widthCm: number }
export const CM_PER_INCH = 2.54;
export const CM2_PER_IN2 = 6.4516;
export function positive(value: number, label = "Measurement"): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive and finite.`);
  return value;
}
export function interiorFromInput(length: string, width: string, unit: "cm" | "in"): Footprint {
  if (!length.trim() || !width.trim()) throw new Error("Enter usable interior length and width.");
  const factor = unit === "in" ? CM_PER_INCH : 1;
  const result = { lengthCm: positive(Number(length) * factor, "Length"), widthCm: positive(Number(width) * factor, "Width") };
  positive(result.lengthCm * result.widthCm, "Interior area");
  return result;
}
export function pixelScale(base: Footprint, pixelLength: number, pixelWidth: number) {
  const lengthCmPerPixel = positive(base.lengthCm) / positive(pixelLength);
  const widthCmPerPixel = positive(base.widthCm) / positive(pixelWidth);
  return { lengthCmPerPixel, widthCmPerPixel, cm2PerPixel: positive(lengthCmPerPixel * widthCmPerPixel) };
}
export function areaRatio(a: number, b: number) { return positive(positive(a) / positive(b), "Area ratio"); }
export function polygonArea(points: Point[]): number {
  return Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;
}
const cross = (o: Point, a: Point, b: Point) => (a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
export function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a,b)=>a.x-b.x || a.y-b.y);
  const half = (list: Point[]) => { const result: Point[]=[]; for(const p of list) { while(result.length>1 && cross(result.at(-2)!,result.at(-1)!,p)<=0) result.pop(); result.push(p); } return result; };
  return [...half(sorted).slice(0,-1),...half(sorted.reverse()).slice(0,-1)];
}
/** Minimum-area oriented bounding rectangle, conservative over the supplied polygon. */
export function envelope(points: Point[]) {
  if(points.length<3 || points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))) throw new Error("Detection has no usable outline. Retake the photo.");
  const boundary=hull(points); let best: { lengthCm:number;widthCm:number;angle:number;corners:Point[] } | undefined;
  for(let i=0;i<boundary.length;i++) {
    const p=boundary[i],q=boundary[(i+1)%boundary.length],angle=Math.atan2(q.y-p.y,q.x-p.x),c=Math.cos(angle),s=Math.sin(angle);
    const xs=boundary.map(p=>p.x*c+p.y*s),ys=boundary.map(p=>-p.x*s+p.y*c);
    const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
    if(!best || (x1-x0)*(y1-y0)<best.lengthCm*best.widthCm-1e-8) {
      best={lengthCm:x1-x0,widthCm:y1-y0,angle,corners:[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>({x:x*c-y*s,y:x*s+y*c}))};
    }
  }
  positive(best!.lengthCm); positive(best!.widthCm); return best!;
}
export interface PlaneTransform { h:number[] }
/** Four detected image corners -> a physical plane. No user annotation. */
export function planeTransform(corners: Point[], base: Footprint): PlaneTransform {
  positive(base.lengthCm);positive(base.widthCm);
  if(corners.length!==4 || corners.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))) throw new Error("Unusable suitcase boundary. Retake the photo.");
  let winding=0;
  for(let i=0;i<4;i++){const v=cross(corners[i],corners[(i+1)%4],corners[(i+2)%4]);if(Math.abs(v)<1e-6 || winding&&Math.sign(v)!==winding)throw new Error("Unstable suitcase boundary. Retake the photo.");winding=Math.sign(v);}
  const target=[{x:0,y:0},{x:base.lengthCm,y:0},{x:base.lengthCm,y:base.widthCm},{x:0,y:base.widthCm}];
  const rows=corners.flatMap((p,i)=>{const q=target[i];return [[p.x,p.y,1,0,0,0,-q.x*p.x,-q.x*p.y,q.x],[0,0,0,p.x,p.y,1,-q.y*p.x,-q.y*p.y,q.y]];});
  for(let col=0;col<8;col++) {let pivot=col;for(let r=col+1;r<8;r++)if(Math.abs(rows[r][col])>Math.abs(rows[pivot][col]))pivot=r;
    if(Math.abs(rows[pivot][col])<1e-9)throw new Error("Perspective is unstable. Retake the photo straight from above.");
    [rows[col],rows[pivot]]=[rows[pivot],rows[col]];const v=rows[col][col];rows[col]=rows[col].map(x=>x/v);
    for(let r=0;r<8;r++)if(r!==col){const f=rows[r][col];rows[r]=rows[r].map((x,i)=>x-f*rows[col][i]);}
  }
  const transform={h:rows.map(r=>r[8])};corners.forEach((p,i)=>{if(Math.hypot(project(transform,p).x-target[i].x,project(transform,p).y-target[i].y)>1e-5)throw new Error("Calibration failed. Retake the photo.");});return transform;
}
export function project({h}:PlaneTransform,p:Point):Point {
  const d=h[6]*p.x+h[7]*p.y+1;
  if(!Number.isFinite(d)||d<0.15)throw new Error("An item is too far from a reliable reference plane. Retake with a more overhead camera and items nearer the suitcase.");
  const result={x:(h[0]*p.x+h[1]*p.y+h[2])/d,y:(h[3]*p.x+h[4]*p.y+h[5])/d};
  if(!Number.isFinite(result.x)||!Number.isFinite(result.y))throw new Error("Non-finite photo measurement.");return result;
}
