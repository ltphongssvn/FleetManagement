// workers/main-worker/test/extraction-flow.test.ts
// RED (phieu-can): runExtraction orchestrates getObject -> VLM port -> policy
// -> SSOT ExtractionResultWire build. Pure flow with injected ports (mirrors
// erp-send-flow): VLM/network failures -> outcome 'failed' (BullMQ retry);
// missing object / unreadable ticket / no-net-weight-found are DETERMINISTIC
// results that still callback (status not_found/unreadable), never retries.
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
function vlm(fields: { rawLabel: string; rawValue: string; twoPass?: boolean } | null): VlmExtractorPort {
  return { extractNetWeight: vi.fn().mockResolvedValue(fields) };
}

describe('runExtraction', () => {
  it('happy path: extracted + SSOT-valid result', async () => {
    const out = await runExtraction(JOB, stores(BYTES), vlm({ rawLabel: 'TL Hang', rawValue: '20.730 Kg' }));
    expect(out).toEqual({ kind: 'completed', result: { manifestId: JOB.manifestId, status: 'extracted', extractedNetWeightKg: 20730 } });
    if (out.kind === 'completed') expect(ExtractionResultWireSchema.safeParse(out.result).success).toBe(true);
  });

  it('VLM finds nothing -> not_found (deterministic, still completes)', async () => {
    const out = await runExtraction(JOB, stores(BYTES), vlm(null));
    expect(out).toEqual({ kind: 'completed', result: { manifestId: JOB.manifestId, status: 'not_found', extractedNetWeightKg: null } });
  });

  it('policy rejects (sanity) -> unreadable with null kg', async () => {
    const out = await runExtraction(JOB, stores(BYTES), vlm({ rawLabel: 'TL Hang', rawValue: '120.000 kg' }));
    expect(out).toEqual({ kind: 'completed', result: { manifestId: JOB.manifestId, status: 'unreadable', extractedNetWeightKg: null } });
  });

  it('object missing -> not_found (no VLM call)', async () => {
    const extractFn = vi.fn().mockResolvedValue({ rawLabel: 'x', rawValue: 'y' });
    const v: VlmExtractorPort = { extractNetWeight: extractFn };
    const out = await runExtraction(JOB, stores(null), v);
    expect(out).toEqual({ kind: 'completed', result: { manifestId: JOB.manifestId, status: 'not_found', extractedNetWeightKg: null } });
    expect(extractFn).not.toHaveBeenCalled();
  });

  it('VLM throw -> failed outcome (retryable), no result', async () => {
    const v: VlmExtractorPort = { extractNetWeight: vi.fn().mockRejectedValue(new Error('429 quota')) };
    const out = await runExtraction(JOB, stores(BYTES), v);
    expect(out.kind).toBe('failed');
  });
});
