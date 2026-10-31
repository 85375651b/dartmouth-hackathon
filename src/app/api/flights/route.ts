import { lookupFlight } from '@/lib/flights/lookup';
import { errorResponse, readBody, ServiceError } from '@/lib/server/services';
export const runtime='nodejs';
export async function POST(request:Request){try{const body=await readBody(request,1000);if(typeof body.flightNumber!=='string')throw new ServiceError('Enter a flight number.',400);return Response.json(await lookupFlight(body.flightNumber),{headers:{'Cache-Control':'no-store'}});}catch(e){return errorResponse(e);}}
