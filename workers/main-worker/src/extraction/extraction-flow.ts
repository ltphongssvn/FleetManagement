// workers/main-worker/src/extraction/extraction-flow.ts
// Orchestrates phieu-can net-weight extraction: injected object-store +
// VLM ports around the pure parsing + recognition policies (mirrors erp-send-flow).
// Outcome semantics:
//   completed -> ALWAYS callback the SSOT result (extracted | not_found |
//                unreadable). Deterministic; retrying cannot change it. Every
//                non-extracted result carries a `reason` so the cause survives
//                (parser refusal is never collapsed into a bare unreadable).
//   failed    -> infra/VLM transport error; surface to BullMQ for retry.
//
// T33 recognition (2026 tolerant-reader EXPAND): the VLM MAY additionally report
// a recognition signal (slipCount + matched standard format + the component
// value strings). When present (format key = the discriminator), runExtraction
// enforces the standard-format rule via recognizePhieuCan BEFORE parsing:
//   - multiple_slips      -> not_found  (ambiguous: several tickets in one photo)
//   - non_standard_format -> unreadable (layout outside the three standard forms)
//   - truck_only          -> not_found / no_field (no goods weight; manual entry)
// When the signal is ABSENT (legacy producers), behaviour is exactly as before:
// parse rawValues directly. Additive + backward-compatible; old callers untouched.
import type { ExtractionJobDataWire, ExtractionResultWire } from '@fleet/sync-protocol';
import { deriveGoodsKg, type PhieuCanFormat } from '@fleet/domain';
import { parseNetWeightKg } from './extraction-policy.js';
import { recognizePhieuCan } from './extraction-recognition-policy.js';

export interface ExtractionObjectStore {
  /** GET the object bytes. Returns null if absent; throws on other errors. */
  getObject(input: { readonly bucket: string; readonly key: string }): Promise<Uint8Array | null>;
}

export interface VlmRawNetWeight {
  readonly rawLabel: string;
  /** One verbatim net value per weighing: length 1 = single-pass, length 2 =
   *  lan-1/lan-2 (summed by the policy). Decomposed, never a delimited
   *  string — removes the twoPass boolean/string contradiction at the boundary. */
  readonly rawValues: readonly string[];
  // T33 recognition signal (all optional = backward-compatible EXPAND). A legacy
  // producer omits every field below and keeps the pre-T33 rawValues-only path.
  /** How many distinct tickets the model saw in the image. >1 => multiple_slips. */
  readonly slipCount?: number;
  /** Which standard layout matched, or null when none did. Presence of this key
   *  is the discriminator that engages recognition. */
  readonly format?: PhieuCanFormat | null;
  /** Verbatim gross (xe+hang) value string for truck_and_goods, else null. */
  readonly grossRaw?: string | null;
  /** Verbatim tare (xe) value string for truck_and_goods / truck_only, else null. */
  readonly tareRaw?: string | null;
  /** Verbatim goods value string for goods_only, else null. */
  readonly goodsRaw?: string | null;
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

function completed(result: ExtractionResultWire): ExtractionOutcome {
  return { kind: 'completed', result };
}

// Build the extracted/unreadable result from a set of verbatim component strings
// that must be SUMMED then sanity-bounded (goods_only = one component; a two-pass
// legacy pair = two components). Single numeric authority stays parseNetWeightKg.
function parseAndBound(manifestId: string, rawLabel: string, rawValues: readonly string[]): ExtractionResultWire {
  const parsed = parseNetWeightKg({ rawLabel, rawValues });
  if (!parsed.ok) {
    return { manifestId, status: 'unreadable', extractedNetWeightKg: null, reason: parsed.reason };
  }
  return { manifestId, status: 'extracted', extractedNetWeightKg: parsed.kg };
}

// Recognition path: turn the standard-format signal into a wire result. Numeric
// interpretation still flows through parseNetWeightKg (one authority); this only
// decides WHICH components feed it and maps cannot-recognize reasons.
function runRecognition(manifestId: string, raw: VlmRawNetWeight, format: PhieuCanFormat | null): ExtractionResultWire {
  const recognition = recognizePhieuCan({
    slipCount: raw.slipCount ?? 1,
    format,
    grossRaw: raw.grossRaw ?? null,
    tareRaw: raw.tareRaw ?? null,
    goodsRaw: raw.goodsRaw ?? null,
  });
  if (!recognition.ok) {
    if (recognition.reason === 'multiple_slips') {
      return { manifestId, status: 'not_found', extractedNetWeightKg: null, reason: 'multiple_slips' };
    }
    if (recognition.reason === 'non_standard_format') {
      return { manifestId, status: 'unreadable', extractedNetWeightKg: null, reason: 'non_standard_format' };
    }
    // no_goods_weight (truck_only): correctly recognised but the ticket carries no
    // goods weight -> surface as not_found/no_field so the board offers manual entry.
    return { manifestId, status: 'not_found', extractedNetWeightKg: null, reason: 'no_field' };
  }
  if (recognition.format === 'truck_and_goods') {
    // Net the two components first (gross - tare) via the domain rule, parsing each
    // through the number authority, then sanity-bound the derived goods weight.
    const gross = parseNetWeightKg({ rawLabel: 'gross', rawValues: [recognition.rawValues[0] ?? ''] });
    const tare = parseNetWeightKg({ rawLabel: 'tare', rawValues: [recognition.rawValues[1] ?? ''] });
    if (!gross.ok) return { manifestId, status: 'unreadable', extractedNetWeightKg: null, reason: gross.reason };
    if (!tare.ok) return { manifestId, status: 'unreadable', extractedNetWeightKg: null, reason: tare.reason };
    const derived = deriveGoodsKg({ format: 'truck_and_goods', grossKg: gross.kg, tareKg: tare.kg, goodsKg: null });
    if (!derived.ok) return { manifestId, status: 'unreadable', extractedNetWeightKg: null, reason: 'unparseable' };
    // Re-bound the derived goods weight against the same sanity policy.
    return parseAndBound(manifestId, 'goods', [String(derived.kg)]);
  }
  // goods_only: the single component IS the goods weight; parse + sanity-bound it.
  return parseAndBound(manifestId, 'goods', recognition.rawValues);
}

export async function runExtraction(
  job: ExtractionJobDataWire,
  store: ExtractionObjectStore,
  vlm: VlmExtractorPort,
): Promise<ExtractionOutcome> {
  try {
    const bytes = await store.getObject({ bucket: job.s3Bucket, key: job.s3Key });
    if (bytes === null) {
      return completed({ manifestId: job.manifestId, status: 'not_found', extractedNetWeightKg: null, reason: 'object_missing' });
    }
    const raw = await vlm.extractNetWeight({ bytes, contentType: job.contentType });
    if (raw === null) {
      return completed({ manifestId: job.manifestId, status: 'not_found', extractedNetWeightKg: null, reason: 'no_field' });
    }
    // Discriminator: a producer that reports the recognition signal includes the
    // format key (value may be null = no standard layout). Absent => legacy path.
    if (Object.prototype.hasOwnProperty.call(raw, 'format')) {
      return completed(runRecognition(job.manifestId, raw, raw.format ?? null));
    }
    return completed(parseAndBound(job.manifestId, raw.rawLabel, raw.rawValues));
  } catch (err: unknown) {
    return { kind: 'failed', error: err instanceof Error ? err : new Error(String(err)) };
  }
}
