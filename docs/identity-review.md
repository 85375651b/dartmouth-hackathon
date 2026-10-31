# Identity, outfit review and Claude configuration

Preview at **http://localhost:3000/packing-review** with the existing `npm run dev` server. This isolated page starts with labeled demo items and sample bags; no teammates' dashboard/store/types were changed. State stays in browser memory and resets on reload.

## Review workflow

1. Edit names/attributes or individual container capacity and unit mass. Different facts produce separate display groups while each physical instance keeps its UUID.
2. Choose particular garments or a quantity from a garment group. Quantity selection keeps existing choices first, then chooses stable IDs deterministically. It never selects a synthetic count-margin instance. Renaming/regrouping does not lose a valid garment selection.
3. Preview packing. Only selected garment instances gain cabin/top preferences. Hard baggage rules still win; the unchanged layer solver can report an unmet top preference.
4. Optionally upload a photo to Claude. Confirm each incoming object as new or link it explicitly to an existing physical object. Same-label objects are never automatically considered identical. Existing items absent from the new photo remain listed; remove them explicitly if unwanted.

The identifier still produces counts without locations, so cross-photo matching is manual against the displayed photo. The library's `linkDetection` attaches existing dimension-detector IDs/regions to physical IDs and rejects duplicate ownership and margin links. No visual similarity matcher is claimed.

`identity-ledger.ts` provides import, edit, remove, grouping, explicit cross-photo linking, detection linking, exact outfit selection and quantity selection. Derived group IDs depend on the membership set, not labels. Per-instance facts—not merely label/attributes—form groups, so differently sized shampoo containers can take different baggage paths. Same-photo reimport is idempotent. Fully linked repeat photos reuse their existing count margin instead of accumulating imaginary items. Partial/new observations remain explicit inventory review work.

Pass `userInputs.identityLedger` to `run_pipeline`. Reviewed re-planning bypasses the identification agent and +1 count correction. Stable physical IDs flow through packing units, placements and fallback. The returned ledger remains the source of truth; legacy content-hashed upload IDs serve only as import aliases. Initial non-reviewed runs also return a ledger, retaining supplied instance measurements and detection references.

## Placeholder mode

As requested for this prototype, `run_pipeline` defaults `usePlaceholders` to true. `usePlaceholders: false` retains strict missing-input behavior. Named sample values are in `placeholders.ts`:

- Unknown height: **2 inches**; retain a real photo footprint if available.
- Entirely unknown shape: **8 × 5 × 2 inches**.
- Unknown unit weight without a matching reference: **1 kg**.
- Unknown liquid capacity: **100 ml**, explicitly `source: placeholder`.
- Unknown packing category: rigid category 1, explicitly marked placeholder.

These are development samples, not calibrated estimates or conservative guarantees. Any use makes the result `status: illustrative` unless unresolved issues require `needs_input`. Real user measurements and existing source data take precedence. Margin dimensions inherit the entry envelope without inventing image pixels. Known prohibited/review restrictions remain in force. Illustrative capacity tags are not rated-container/security clearance. The sample-bag preview is not applied to shared inventory or presented as a confirmed trip plan.

The review endpoint `/api/packing-preview` runs on reviewed ledger data only and never calls AI. It calls the existing Python liquid estimator through the server bridge, requiring `python3` as before.

## Why no averaged 3-axis scale

Visible suitcase walls can provide additional geometry, but their depth edges and floor edges experience different foreshortening. Averaging three pixels-per-inch ratios mixes different projections; it does not recover a universal image scale or hidden item thickness. A future calibrated multi-plane reconstruction can use those edges with camera/pose information. This change keeps Anna's floor-plane detector intact and uses labeled placeholder depths instead.

## Claude calls

Set server-only environment variables (see `.env.example`):

```text
ANTHROPIC_API_KEY=your-claude-api-key
ANTHROPIC_MODEL=your-claude-vision-model-id
```

`CLAUDE_API_KEY` is an optional key alias. No `NEXT_PUBLIC_` key or browser key field is used. Select an available Claude model supporting image inputs and structured JSON output; there is no guessed model default. Restart the dev server after changing environment settings.

The upload API, provider adapter and Python quickstart now accept this configuration. Earlier imports of `createOpenAIObjectAgent` are preserved as a documented alias to `createClaudeObjectAgent`; no requests are sent to OpenAI. Direct usage:

```ts
const agent = createClaudeObjectAgent({ apiKey, model });
const run = createPipeline({ identify: image => agent.identify(image) });
```

The adapter follows [Claude image blocks](https://platform.claude.com/docs/en/build-with-claude/vision) and [structured output](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) contracts. It sends `x-api-key`, an `anthropic-version` header, a base64 image, and `output_config.format`. Unsupported schema `minimum` constraints are omitted from the provider grammar but enforced by the existing runtime validator. The existing count/tag/bundle algorithms remain plain code. Refusals, truncation, malformed output, transport failures and oversized encoded images return sanitized errors.

## Verification

```sh
node --experimental-strip-types --test scripts/identity-ledger.test.ts scripts/identify-objects.test.ts
node --experimental-strip-types --test scripts/*.test.ts
python3 -B scripts/liquids_test.py
npm run check
```

Provider tests use mocked HTTP, never a real key or paid request. For manual browser verification: select one shirt, rename it to pants, confirm its short identity and selection remain; give two shampoo instances capacities 50 ml and 250 ml, confirm separate groups; preview and check selected garments alone prefer the cabin. The synthetic eighth shirt must remain disabled for outfit selection. Upload tests require Claude configuration, or a mocked browser route.

Verified locally: 134 TypeScript tests, the Python packer assert suite, `npm run check`, and headless Chromium checks of rename/identity preservation, outfit selection, disabled margin selection, capacity-based regrouping, live preview response, mobile overflow and browser errors. Both Python quickstart key names were checked with a mocked SDK. No paid Claude request was made. The build retains the five existing demo room-confirmation warnings.
