import {
  MAX_OBJECT_IMAGE_BYTES, ObjectIdentificationError, validateObjectImage,
} from "../../../lib/vision/identify-objects.ts";
import { createClaudeObjectAgent } from "../../../lib/vision/claude-object-agent.ts";
import { identifyPackingInventoryInImage } from "../../../lib/vision/packing-inventory.ts";
import { BundleInvariantError } from "../../../lib/packing/bundles.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    let form: FormData;
    try { form = await request.formData(); } catch {
      throw new ObjectIdentificationError("Send multipart/form-data with one image file named image.", 400);
    }
    const images = form.getAll("image");
    const file = images[0];
    if (images.length !== 1 || !(file instanceof Blob)) {
      throw new ObjectIdentificationError("Upload exactly one image file named image.", 400);
    }
    if (file.size > MAX_OBJECT_IMAGE_BYTES) {
      throw new ObjectIdentificationError("The image must be 10 MiB or smaller.", 413);
    }
    // The provider is configured only on the server. Never use NEXT_PUBLIC_ keys.
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? "";
    const model = process.env.ANTHROPIC_MODEL ?? "";
    // Validate before configuration so malformed uploads get useful errors.
    const image = { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type };
    validateObjectImage(image);
    const agent = createClaudeObjectAgent({ apiKey, model, signal: request.signal });
    const inventory = await identifyPackingInventoryInImage(image, agent);
    return Response.json(inventory, { headers });
  } catch (error) {
    if (error instanceof BundleInvariantError) {
      return Response.json({ error: error.message }, { status: 422, headers });
    }
    if (error instanceof ObjectIdentificationError) {
      return Response.json({ error: error.message }, { status: error.status, headers });
    }
    return Response.json({ error: "Image identification failed. Try again." }, { status: 500, headers });
  }
}
