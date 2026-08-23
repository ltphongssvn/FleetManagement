// apps/api/test/manifest.extraction-callback-controller.test.ts
// RED (phieu-can): POST /upload/extraction-result controller must strict-parse
// the body against the SSOT ExtractionResultWireSchema (@fleet/sync-protocol)
// and dispatch to ManifestService.finalizeExtraction with the operator context.
import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import { ExtractionCallbackController } from '../src/manifest/manifest.controller.js';
import type { ManifestService } from '../src/manifest/manifest.service.js';
import { createOperatorContext } from '@fleet/test-fixtures';

const OP = createOperatorContext();
const MID = '7b6a1c9e-2f4d-4a8b-9c0d-1e2f3a4b5c6d';

function makeController(): {
  controller: ExtractionCallbackController;
  finalizeExtraction: ReturnType<typeof vi.fn>;
} {
  const finalizeExtraction = vi.fn().mockResolvedValue({ manifestId: MID, status: 'extracted' });
  const svc = { finalizeExtraction } as unknown as ManifestService;
  return { controller: new ExtractionCallbackController(svc), finalizeExtraction };
}

describe('@fleet/api - ExtractionCallbackController', () => {
  it('parses a valid body via SSOT schema and dispatches to the service', async () => {
    const { controller, finalizeExtraction } = makeController();
    const body = { manifestId: MID, status: 'extracted', extractedNetWeightKg: 20730 };
    const r = await controller.finalize(body, OP);
    expect(finalizeExtraction).toHaveBeenCalledWith(body, OP);
    expect(r).toMatchObject({ manifestId: MID, status: 'extracted' });
  });

  it('rejects schema-invalid bodies (extracted with null kg) without dispatching', async () => {
    const { controller, finalizeExtraction } = makeController();
    await expect(
      controller.finalize({ manifestId: MID, status: 'extracted', extractedNetWeightKg: null }, OP),
    ).rejects.toBeInstanceOf(ZodError);
    expect(finalizeExtraction).not.toHaveBeenCalled();
  });

  it('rejects unknown keys (strict)', async () => {
    const { controller, finalizeExtraction } = makeController();
    await expect(
      controller.finalize(
        { manifestId: MID, status: 'not_found', extractedNetWeightKg: null, extra: 1 },
        OP,
      ),
    ).rejects.toBeInstanceOf(ZodError);
    expect(finalizeExtraction).not.toHaveBeenCalled();
  });
});
