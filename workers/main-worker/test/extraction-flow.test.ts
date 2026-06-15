// workers/main-worker/test/extraction-flow.test.ts
// runExtraction orchestrates getObject -> VLM port -> policy -> SSOT
// ExtractionResultWire build. Pure flow with injected ports (mirrors
// erp-send-flow): VLM/network failures -> outcome 'failed' (BullMQ retry);
// missing object / no-field / unreadable are DETERMINISTIC results that still
// callback, each carrying the failure `reason` so the cause is never lost.
// VLM raw output is the decomposed rawValues array (no twoPass boolean).
import { describe, expect, it, vi } from 'vitest';
import { ExtractionResultWireSchema } from '@fleet/sync-protocol';
import { runExtraction, type VlmExtractorPort, type ExtractionObjectStore } from '../src/extraction/extraction-flow.js';
import type { ExtractionJobDataWire } from '@fleet/sync-protocol';

const JOB: ExtractionJobDataWire = {
  manifestId: '7b6a1c9e-2f4d-4a8b-9c0d-1e2f3a4b5c6d',
  uploadSessionId: '0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d',
  s3Key: 'tenant/m/x.jpg',
  s3Bucket: 'fleet-pilot-artifacts',
  contentType: 'image/jpeg',
};
const BYTES = new Uint8Array([1, 2, 3]);

function stores(bytes: Uint8Array | null): ExtractionObjectStore {
  return { getObject: vi.fn().mockResolvedValue(bytes) };
}
function vlm(fields: { rawLabel: string; rawValues: readonly string[] } | null): VlmExtractorPort {
  return { extractNetWeight: vi.fn().mockResolvedValue(fields) };
}

describe('runExtraction', () => {
  it('happy path: extracted + SSOT-valid result, no reason', async () => {
    const out = await runExtraction(JOB, stores(BYTES), vlm({ rawLabel: 'TL Hang', rawValues: ['20.730 Kg'] }));
    expect(out).toEqual({ kind: 'completed', result: { manifestId: JOB.manifestId, status: 'extracted', extractedNetWeightKg: 20730 } });
    if (out.kind === 'completed') expect(ExtractionResultWireSchema.safeParse(out.result).success).toBe(true);
  });

  it('two-pass: sums the decomposed components', async () => {
    const out = await runExtraction(JOB, stores(BYTES), vlm({ rawLabel: 'TL hang lan 1 / lan 2', rawValues: ['10.500', '9.730'] }));
    expect(out).toEqual({ kind: 'completed', result: { manifestId: JOB.manifestId, status: 'extracted', extractedNetWeightKg: 20230 } });
    if (out.kind === 'completed') expect(ExtractionResultWireSchema.safeParse(out.result).success).toBe(true);
  });

  it('VLM finds nothing -> not_found, reason no_field', async () => {
    const out = await runExtraction(JOB, stores(BYTES), vlm(null));
    expect(out).toEqual({ kind: 'completed', result: { manifestId: JOB.manifestId, status: 'not_found', extractedNetWeightKg: null, reason: 'no_field' } });
    if (out.kind === 'completed') expect(ExtractionResultWireSchema.safeParse(out.result).success).toBe(true);
  });

  it('policy rejects over-max -> unreadable, reason above_sanity_max', async () => {
    const out = await runExtraction(JOB, stores(BYTES), vlm({ rawLabel: 'TL Hang', rawValues: ['120.000 kg'] }));
    expect(out).toEqual({ kind: 'completed', result: { manifestId: JOB.manifestId, status: 'unreadable', extractedNetWeightKg: null, reason: 'above_sanity_max' } });
    if (out.kind === 'completed') expect(ExtractionResultWireSchema.safeParse(out.result).success).toBe(true);
  });

  it('policy rejects under-min -> unreadable, reason below_sanity_min', async () => {
    const out = await runExtraction(JOB, stores(BYTES), vlm({ rawLabel: 'TL Hang', rawValues: ['50 kg'] }));
    expect(out).toEqual({ kind: 'completed', result: { manifestId: JOB.manifestId, status: 'unreadable', extractedNetWeightKg: null, reason: 'below_sanity_min' } });
    if (out.kind === 'completed') expect(ExtractionResultWireSchema.safeParse(out.result).success).toBe(true);
  });

  it('policy cannot parse the value -> unreadable, reason unparseable', async () => {
    const out = await runExtraction(JOB, stores(BYTES), vlm({ rawLabel: 'TL Hang', rawValues: ['O.OOO'] }));
    expect(out).toEqual({ kind: 'completed', result: { manifestId: JOB.manifestId, status: 'unreadable', extractedNetWeightKg: null, reason: 'unparseable' } });
    if (out.kind === 'completed') expect(ExtractionResultWireSchema.safeParse(out.result).success).toBe(true);
  });

  it('object missing -> not_found, reason object_missing (no VLM call)', async () => {
    const extractFn = vi.fn().mockResolvedValue({ rawLabel: 'x', rawValues: ['y'] });
    const v: VlmExtractorPort = { extractNetWeight: extractFn };
    const out = await runExtraction(JOB, stores(null), v);
    expect(out).toEqual({ kind: 'completed', result: { manifestId: JOB.manifestId, status: 'not_found', extractedNetWeightKg: null, reason: 'object_missing' } });
    expect(extractFn).not.toHaveBeenCalled();
    if (out.kind === 'completed') expect(ExtractionResultWireSchema.safeParse(out.result).success).toBe(true);
  });

  it('VLM throw -> failed outcome (retryable), no result', async () => {
    const v: VlmExtractorPort = { extractNetWeight: vi.fn().mockRejectedValue(new Error('429 quota')) };
    const out = await runExtraction(JOB, stores(BYTES), v);
    expect(out.kind).toBe('failed');
  });
});
