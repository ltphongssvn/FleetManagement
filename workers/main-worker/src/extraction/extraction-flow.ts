// workers/main-worker/src/extraction/extraction-flow.ts
// Orchestrates phieu-can net-weight extraction: injected object-store +
// VLM ports around the pure parsing policy (mirrors erp-send-flow).
// Outcome semantics:
//   completed -> ALWAYS callback the SSOT result (extracted | not_found |
//                unreadable). Deterministic; retrying cannot change it. Every
//                non-extracted result carries a `reason` so the cause survives
//                (parser refusal is never collapsed into a bare 'unreadable').
//   failed    -> infra/VLM transport error; surface to BullMQ for retry.
import type { ExtractionJobDataWire, ExtractionResultWire } from '@fleet/sync-protocol';
import { parseNetWeightKg } from './extraction-policy.js';

export interface ExtractionObjectStore {
  /** GET the object bytes. Returns null if absent; throws on other errors. */
  getObject(input: { readonly bucket: string; readonly key: string }): Promise<Uint8Array | null>;
}

export interface VlmRawNetWeight {
  readonly rawLabel: string;
  readonly rawValue: string;
  readonly twoPass?: boolean;
}

export interface VlmExtractorPort {
  /** Returns the raw net-weight field(s) read off the ticket image, or null
   *  when the model finds no net-weight field at all. Throws on transport/
   *  quota errors (retryable). */
  extractNetWeight(input: { readonly bytes: Uint8Array; readonly contentType: string }): Promise<VlmRawNetWeight | null>;
}

export type ExtractionOutcome =
  | { readonly kind: 'completed'; readonly result: ExtractionResultWire }
  | { readonly kind: 'failed'; readonly error: Error };

export async function runExtraction(
  job: ExtractionJobDataWire,
  store: ExtractionObjectStore,
  vlm: VlmExtractorPort,
): Promise<ExtractionOutcome> {
  try {
    const bytes = await store.getObject({ bucket: job.s3Bucket, key: job.s3Key });
    if (bytes === null) {
      return { kind: 'completed', result: { manifestId: job.manifestId, status: 'not_found', extractedNetWeightKg: null, reason: 'object_missing' } };
    }
    const raw = await vlm.extractNetWeight({ bytes, contentType: job.contentType });
    if (raw === null) {
      return { kind: 'completed', result: { manifestId: job.manifestId, status: 'not_found', extractedNetWeightKg: null, reason: 'no_field' } };
    }
    const parsed = parseNetWeightKg(raw);
    if (!parsed.ok) {
      return { kind: 'completed', result: { manifestId: job.manifestId, status: 'unreadable', extractedNetWeightKg: null, reason: parsed.reason } };
    }
    return { kind: 'completed', result: { manifestId: job.manifestId, status: 'extracted', extractedNetWeightKg: parsed.kg } };
  } catch (err: unknown) {
    return { kind: 'failed', error: err instanceof Error ? err : new Error(String(err)) };
  }
}
