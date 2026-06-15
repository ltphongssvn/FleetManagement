// workers/main-worker/src/extraction/extraction-policy.ts
// Pure net-weight parsing policy over VLM raw output (phieu-can). Hexagonal:
// no transport/SDK imports; fully unit-testable. The VLM adapter returns raw
// value string(s); THIS is the single place that resolves Vietnamese number
// formatting and sanity bounds, so the rules are testable + auditable.
//
// Two-pass (lan-1/lan-2) is modelled as a DECOMPOSED rawValues array — one
// verbatim value per weighing — not a '+'-delimited string. The policy parses
// each component and sums them; there is no delimiter re-splitting, and the VLM
// contract carries no contradictory twoPass boolean.
//
// Number-format rules (from the sample-ticket ambiguity set):
// - '.' followed by exactly 3 digits in a group = thousands separator
//   (20.730 -> 20730); '.' followed by 1-2 digits = decimal (7.25 -> 7.25).
// - ',' followed by 1-2 digits = decimal comma (9.850,5 -> 9850.5);
//   ',' followed by exactly 3 digits = thousands.
// Sanity bounds: a truck-scale NET goods weight for this pilot fleet is
// 100..60000 kg; outside that we refuse rather than persist nonsense.

import { parseOneNumber } from "@fleet/domain";

export const NET_WEIGHT_SANITY = { minKg: 100, maxKg: 60000 } as const;

export type NetWeightParse =
  | { readonly ok: true; readonly kg: number }
  | { readonly ok: false; readonly reason: 'unparseable' | 'below_sanity_min' | 'above_sanity_max' };

export interface NetWeightRaw {
  readonly rawLabel: string;
  /** One verbatim value per weighing: length 1 = single-pass, length 2 =
   *  lan-1/lan-2 two-pass (summed). Empty = nothing legible -> unparseable. */
  readonly rawValues: readonly string[];
}

export function parseNetWeightKg(input: NetWeightRaw): NetWeightParse {
  if (input.rawValues.length === 0) return { ok: false, reason: 'unparseable' };
  let total = 0;
  for (const part of input.rawValues) {
    const n = parseOneNumber(part);
    if (n === null) return { ok: false, reason: 'unparseable' };
    total += n;
  }
  if (total < NET_WEIGHT_SANITY.minKg) return { ok: false, reason: 'below_sanity_min' };
  if (total > NET_WEIGHT_SANITY.maxKg) return { ok: false, reason: 'above_sanity_max' };
  return { ok: true, kg: total };
}
