// workers/main-worker/test/queue-router-extraction.test.ts
// RED (phieu-can): routeJob 'extraction' branch — strict-parse via SSOT schema,
// run the flow with injected ports, callback the SSOT result on completed,
// rethrow infra failures (BullMQ retry), dead-letter malformed payloads.
import { describe, expect, it, vi } from 'vitest';
import { routeJob, type DeadLetterSink } from '../src/queue-router.js';
import type { ExtractionCallback } from '../src/extraction/extraction-callback.js';
import type { ExtractionObjectStore, VlmExtractorPort } from '../src/extraction/extraction-flow.js';

const GOOD = {
  manifestId: '7b6a1c9e-2f4d-4a8b-9c0d-1e2f3a4b5c6d',
  uploadSessionId: '0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d',
  s3Key: 'tenant/m/x.jpg',
  s3Bucket: 'fleet-pilot-artifacts',
  contentType: 'image/jpeg',
};

function sink(): DeadLetterSink & { sent: unknown[] } {
  const sent: unknown[] = [];
  return { sent, send: vi.fn().mockImplementation((e: unknown) => { sent.push(e); return Promise.resolve(); }) };
}
function ports(value: string | null): { store: ExtractionObjectStore; vlm: VlmExtractorPort } {
  return {
    store: { getObject: vi.fn().mockResolvedValue(new Uint8Array([1])) },
    vlm: { extractNetWeight: vi.fn().mockResolvedValue(value === null ? null : { rawLabel: 'TL Hang', rawValue: value }) },
  };
}

describe('routeJob extraction branch', () => {
  it('completed extracted -> callbacks SSOT result, summary carries kg', async () => {
    const finalize = vi.fn().mockResolvedValue(undefined);
    const cb: ExtractionCallback = { finalize };
    const { store, vlm } = ports('20.730 Kg');
    const r = await routeJob('extraction', { id: '1', data: GOOD }, sink(), undefined, undefined, undefined, cb, store, vlm);
    expect(finalize).toHaveBeenCalledWith({ manifestId: GOOD.manifestId, status: 'extracted', extractedNetWeightKg: 20730 });
    expect(r).toMatchObject({ handled: true, deadLettered: false });
    expect(r.summary).toContain('extracted');
  });

  it('malformed payload -> dead-letter, no ports touched', async () => {
    const s = sink();
    const getObjectFn = vi.fn().mockResolvedValue(new Uint8Array([1]));
    const store: ExtractionObjectStore = { getObject: getObjectFn };
    const { vlm } = ports('20.730 Kg');
    const r = await routeJob('extraction', { id: '2', data: { nope: 1 } }, s, undefined, undefined, undefined, undefined, store, vlm);
    expect(r).toMatchObject({ handled: true, deadLettered: true });
    expect(s.sent).toHaveLength(1);
    expect(getObjectFn).not.toHaveBeenCalled();
  });

  it('flow failed (VLM throw) -> rethrows for BullMQ retry', async () => {
    const finalizeFn = vi.fn();
    const cb: ExtractionCallback = { finalize: finalizeFn };
    const store: ExtractionObjectStore = { getObject: vi.fn().mockResolvedValue(new Uint8Array([1])) };
    const vlm: VlmExtractorPort = { extractNetWeight: vi.fn().mockRejectedValue(new Error('quota')) };
    await expect(
      routeJob('extraction', { id: '3', data: GOOD }, sink(), undefined, undefined, undefined, cb, store, vlm),
    ).rejects.toThrow('quota');
    expect(finalizeFn).not.toHaveBeenCalled();
  });
});
