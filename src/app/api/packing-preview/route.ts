import { run_pipeline } from '../../../lib/pipeline/run-pipeline.ts';
import type { IdentityLedger } from '../../../lib/pipeline/identity-ledger.ts';
import type { PipelineBag } from '../../../lib/pipeline/contracts.ts';

export const runtime = 'nodejs';
export const maxDuration = 30;
/** Reviewed ledger only: this endpoint never calls an AI agent or changes state. */
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const body = await request.json() as { ledger: IdentityLedger; bags: PipelineBag[]; photoId: string };
    if (!body.ledger || !Array.isArray(body.ledger.instances) || body.ledger.instances.length > 2000 || !Array.isArray(body.bags)
      || typeof body.photoId !== 'string' || !body.photoId) return Response.json({ error: 'Supply a reviewed ledger, two bags and a photo ID.' }, { status: 400, headers });
    // No image recognition is needed to replan already-reviewed identities.
    const result = await run_pipeline({ photoId: body.photoId, bytes: new Uint8Array([1]), mimeType: 'image/png' }, body.bags,
      { identityLedger: body.ledger, usePlaceholders: true });
    return Response.json(result, { headers });
  } catch {
    return Response.json({ error: 'Could not preview this inventory. Check item attributes, positive measurements, and unique instance selections.' }, { status: 400, headers });
  }
}
