// workers/main-worker/src/extraction/extraction-policy.ts
// Pure net-weight parsing policy over VLM raw output (phieu-can). Hexagonal:
// no transport/SDK imports; fully unit-testable. The VLM adapter returns raw
// label/value strings; THIS is the single place that resolves Vietnamese
// number formatting and sanity bounds, so the rules are testable + auditable.
//
// Number-format rules (from the sample-ticket ambiguity set):
// - '.' followed by exactly 3 digits in a group = thousands separator
//   (20.730 -> 20730); '.' followed by 1-2 digits = decimal (7.25 -> 7.25).
// - ',' followed by 1-2 digits = decimal comma (9.850,5 -> 9850.5);
//   ',' followed by exactly 3 digits = thousands.
// - twoPass (lan-1/lan-2): sum the two parsed components.
// Sanity bounds: a truck-scale NET goods weight for this pilot fleet is
// 100..60000 kg; outside that we refuse rather than persist nonsense.

export const NET_WEIGHT_SANITY = { minKg: 100, maxKg: 60000 } as const;

export type NetWeightParse =
  | { readonly ok: true; readonly kg: number }
  | { readonly ok: false; readonly reason: 'unparseable' | 'below_sanity_min' | 'above_sanity_max' };

export interface NetWeightRaw {
  readonly rawLabel: string;
  readonly rawValue: string;
  readonly twoPass?: boolean;
}

function parseOneNumber(raw: string): number | null {
  const cleaned = raw.replace(/kg/gi, '').trim();
  // The regex is the single gate: grouped form (1-3 digits then .ddd groups)
  // or a plain digit run, with an optional 1-2 digit decimal tail. Everything
  // after a match is total by construction -- no defensive branches needed.
  if (!/^-?(?:[0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]+)(?:[.,][0-9]{1,2})?$/.test(cleaned)) return null;
  const groups = cleaned.split(/[.,]/);
  // split() always yields >=1 element, so pop() cannot be undefined here;
  // structured this way to satisfy both no-non-null-assertion and
  // non-nullable-type-assertion-style without a dead fallback branch.
  const last = groups.pop() ?? '';
  const hasFrac = groups.length > 0 && last.length < 3;
  return Number(hasFrac ? groups.join('') + '.' + last : groups.join('') + last);
}

export function parseNetWeightKg(input: NetWeightRaw): NetWeightParse {
  const parts = input.twoPass === true ? input.rawValue.split('+') : [input.rawValue];
  let total = 0;
  for (const part of parts) {
    const n = parseOneNumber(part);
    if (n === null) return { ok: false, reason: 'unparseable' };
    total += n;
  }
  if (total < NET_WEIGHT_SANITY.minKg) return { ok: false, reason: 'below_sanity_min' };
  if (total > NET_WEIGHT_SANITY.maxKg) return { ok: false, reason: 'above_sanity_max' };
  return { ok: true, kg: total };
}
