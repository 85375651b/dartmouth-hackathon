/** Server-only transport. No keys, image contents or upstream bodies are logged. */
export class ServiceError extends Error { status:number; constructor(message:string,status=503){super(message);this.status=status;} }
export async function requestJson(url:string,init:RequestInit={},fetcher:typeof fetch=fetch):Promise<unknown>{
 let response:Response;
 try{response=await fetcher(url,{...init,cache:'no-store',signal:init.signal??AbortSignal.timeout(35_000)});}catch{throw new ServiceError('The external service did not respond. Try again later.');}
 if(!response.ok)throw new ServiceError(response.status===429?'The service is rate limited. Please try again later.':'The service is unavailable or its server credentials/plan need attention.');
 const text=await response.text();if(text.length>2_000_000)throw new ServiceError('The service returned too much data.');
 try{return JSON.parse(text);}catch{throw new ServiceError('The service returned an unreadable response.');}
}
export function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new ServiceError('The service returned an invalid result.');return value as Record<string,unknown>;}
export function text(value:unknown,max=300):string{return typeof value==='string'?value.slice(0,max):'';}
export async function claudeJson(content:unknown[],instruction:string,fetcher:typeof fetch=fetch):Promise<unknown>{
 const key=process.env.ANTHROPIC_API_KEY;if(!key)throw new ServiceError('Automatic recognition/policy extraction needs ANTHROPIC_API_KEY on the server.');
 const raw=record(await requestJson('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:process.env.CLAUDE_MODEL||'claude-sonnet-4-6',max_tokens:4096,system:instruction,messages:[{role:'user',content}]})},fetcher));
 if(raw.stop_reason!=='end_turn')throw new ServiceError('The recognition/extraction response was incomplete. Try a smaller set of items.');
 const blocks=Array.isArray(raw.content)?raw.content:[],answer=blocks.map(b=>text(record(b).text,40_000)).join('');
 try{return JSON.parse(answer.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw new ServiceError('The model did not return a usable structured result. Please retry.');}
}
export async function readBody(request:Request,limit=2_000_000):Promise<Record<string,unknown>>{
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new ServiceError('Cross-origin requests are not supported.',403);
 const reader=request.body?.getReader();if(!reader)throw new ServiceError('A JSON request body is required.',400);
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new ServiceError('The request is too large.',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return record(JSON.parse(new TextDecoder().decode(bytes)));}catch{throw new ServiceError('Invalid JSON request.',400);}
}
export function errorResponse(error:unknown){return Response.json({error:error instanceof ServiceError?error.message:'The request could not be completed.'},{status:error instanceof ServiceError?error.status:500,headers:{'Cache-Control':'no-store'}});}
