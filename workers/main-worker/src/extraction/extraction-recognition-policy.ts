// workers/main-worker/src/extraction/extraction-recognition-policy.ts
// Pure phieu-can RECOGNITION policy (T33). Runs BEFORE net-weight parsing and is
// the single deterministic place that enforces the standard-format rule over the
// VLM signal. Hexagonal: no SDK/transport imports; fully unit-testable.
//
// The adapter reports what it SEES on the image, verbatim: how many distinct
// tickets (slipCount) and which standard layout matched (format, or null), plus
// the component value strings for that layout. This policy converts that into:
//   - a recognised outcome carrying the component string(s) parseNetWeightKg
//     will consume (goods for goods_only; gross+tare for truck_and_goods), or
//   - a terminal cannot-recognize reason.
//
// Rules (2026, gated deterministically — VLM self-confidence is miscalibrated,
// so we never trust a confidence float, only the structural signal):
//   slipCount > 1                      -> multiple_slips (checked FIRST).
//   format not one of the three        -> non_standard_format.
//   truck_only                         -> recognised layout, but no goods weight
//                                         is derivable -> no_goods_weight (the
//                                         manual-entry path, not an error).
//   goods_only / truck_and_goods with
//     a required component missing      -> non_standard_format (the claimed
//                                         layout is not actually present).
import { PHIEU_CAN_FORMATS, type PhieuCanFormat } from '@fleet/domain';

// The verbatim VLM signal this policy consumes. All fields are what the model
// reports it saw; null means that field was absent/illegible. Internal,
// single-use, no trust boundary -> plain TypeScript (two-axis rule); the VLM
// adapter validates the raw model JSON at its own boundary with Zod.
export interface PhieuCanVisionSignal {
  readonly slipCount: number;
  readonly format: PhieuCanFormat | null;
  readonly grossRaw: string | null;
  readonly tareRaw: string | null;
  readonly goodsRaw: string | null;
}

export type PhieuCanRecognition =
  | { readonly ok: true; readonly format: PhieuCanFormat; readonly rawValues: readonly string[] }
  | { readonly ok: false; readonly reason: 'multiple_slips' }
  | { readonly ok: false; readonly reason: 'non_standard_format' }
  | { readonly ok: false; readonly reason: 'no_goods_weight'; readonly format: 'truck_only' };

function isStandardFormat(f: PhieuCanFormat | null): f is PhieuCanFormat {
  return f !== null && PHIEU_CAN_FORMATS.includes(f);
}

export function recognizePhieuCan(signal: PhieuCanVisionSignal): PhieuCanRecognition {
  // Several tickets in one photo is a hard reject, regardless of any per-ticket
  // layout the model also reported: the net weight would be ambiguous.
  if (signal.slipCount > 1) return { ok: false, reason: 'multiple_slips' };
  if (!isStandardFormat(signal.format)) return { ok: false, reason: 'non_standard_format' };
  switch (signal.format) {
    case 'goods_only': {
      if (signal.goodsRaw === null) return { ok: false, reason: 'non_standard_format' };
      return { ok: true, format: 'goods_only', rawValues: [signal.goodsRaw] };
    }
    case 'truck_and_goods': {
      if (signal.grossRaw === null || signal.tareRaw === null)
        return { ok: false, reason: 'non_standard_format' };
      return { ok: true, format: 'truck_and_goods', rawValues: [signal.grossRaw, signal.tareRaw] };
    }
    case 'truck_only':
      return { ok: false, reason: 'no_goods_weight', format: 'truck_only' };
  }
}
