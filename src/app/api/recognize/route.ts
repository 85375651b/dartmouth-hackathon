import { recognizeCrops, type RecognitionCrop } from '@/lib/photo-packing/recognize';
import { errorResponse, readBody, ServiceError } from '@/lib/server/services';
export const runtime='nodejs';
export async function POST(request:Request){try{if(!process.env.ANTHROPIC_API_KEY)throw new ServiceError('Automatic item identification is not configured. Add ANTHROPIC_API_KEY on the server; you can still review items manually.');const body=await readBody(request);if(!Array.isArray(body.crops)||body.crops.some(c=>!c||typeof c.id!=='string'||typeof c.image!=='string'))throw new ServiceError('Invalid item crops.',400);return Response.json({items:await recognizeCrops(body.crops as RecognitionCrop[])},{headers:{'Cache-Control':'no-store'}});}catch(e){return errorResponse(e);}}
