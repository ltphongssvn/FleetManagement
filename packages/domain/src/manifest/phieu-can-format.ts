// packages/domain/src/manifest/phieu-can-format.ts
// SSOT for the STANDARD phieu-can (Vietnamese truck weighing ticket) layouts the
// recognizer is allowed to accept, plus the pure rule that resolves the single
// GOODS weight (kg) the Lenh dieu xe board displays.
//
// Business rule (T33, 2026): the AI follows the current standard phieu-can
// formats ONLY. Three layouts are standard:
//   truck_and_goods -> ticket prints the gross weight (xe + hang) AND the tare
//                      weight (xe). goods = gross - tare.
//   truck_only      -> ticket prints the truck weight only. No goods weight is
//                      derivable from the ticket, so a dispatcher enters it by
//                      hand on the board.
//   goods_only      -> ticket prints the goods weight directly; it IS the goods
//                      weight, no arithmetic.
// Anything else -- several tickets photographed together, or a layout outside
// this set -- is NOT a format. It resolves to a terminal cannot-recognize
// outcome in the extraction policy and never reaches this derivation.
//
// 2026 practice this encodes: VLM self-reported confidence is systematically
// miscalibrated, so recognition is gated by a DETERMINISTIC schema + rule
// table rather than a confidence float, and unrecognised layouts degrade
// gracefully to a human-entry path instead of yielding an unreliable number.
import { z } from 'zod';

// One as-const array is the single definition; the type and the schema both
// derive from it (canonical SSOT enum pattern).
export const PHIEU_CAN_FORMATS = Object.freeze([
  'truck_and_goods',
  'truck_only',
  'goods_only',
] as const);

export const PhieuCanFormatSchema = z.enum(PHIEU_CAN_FORMATS);

export type PhieuCanFormat = z.infer<typeof PhieuCanFormatSchema>;

// Why a derivation can fail even though the LAYOUT was recognised. Distinct from
// the cannot-recognize reasons (which are about the layout itself):
//   incomplete_format    -> the layout is standard but a required weight for it
//                           was not legible (e.g. gross present, tare missing).
//   inconsistent_weights -> the numbers contradict the layout (tare >= gross),
//                           so subtracting would persist nonsense.
//   no_goods_weight      -> truck_only: correctly read, but the ticket simply
//                           carries no goods weight. This is the manual-entry
//                           path, NOT an error.
export const GOODS_DERIVATION_REFUSALS = Object.freeze([
  'incomplete_format',
  'inconsistent_weights',
  'no_goods_weight',
] as const);

export const GoodsDerivationRefusalSchema = z.enum(GOODS_DERIVATION_REFUSALS);

export type GoodsDerivationRefusal = z.infer<typeof GoodsDerivationRefusalSchema>;

// Weights as READ off a recognised ticket, before any arithmetic. Each is null
// when that field is absent from (or illegible on) the layout. Internal,
// single-use, no trust boundary -> plain TypeScript by the two-axis rule; the
// WIRE shape that crosses the worker/API boundary is Zod-validated separately.
export interface PhieuCanWeights {
  readonly format: PhieuCanFormat;
  readonly grossKg: number | null;
  readonly tareKg: number | null;
  readonly goodsKg: number | null;
}

export type GoodsDerivation =
  | { readonly ok: true; readonly kg: number }
  | { readonly ok: false; readonly reason: GoodsDerivationRefusal };

// Pure, exhaustive over PhieuCanFormat: adding a format to the SSOT array makes
// this switch non-exhaustive and fails the build, so a new layout can never
// silently fall through to a wrong weight.
export function deriveGoodsKg(input: PhieuCanWeights): GoodsDerivation {
  switch (input.format) {
    case 'truck_and_goods': {
      const gross = input.grossKg;
      const tare = input.tareKg;
      if (gross === null || tare === null) return { ok: false, reason: 'incomplete_format' };
      if (tare >= gross) return { ok: false, reason: 'inconsistent_weights' };
      return { ok: true, kg: gross - tare };
    }
    case 'truck_only':
      // Correctly recognised, but the ticket carries no goods weight at all:
      // the board must offer manual entry rather than invent a number.
      return { ok: false, reason: 'no_goods_weight' };
    case 'goods_only': {
      const goods = input.goodsKg;
      if (goods === null) return { ok: false, reason: 'incomplete_format' };
      return { ok: true, kg: goods };
    }
  }
}
