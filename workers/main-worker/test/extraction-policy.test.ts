// workers/main-worker/test/extraction-policy.test.ts
// RED (phieu-can): pure net-weight parsing policy over VLM raw output.
// Targets the REAL ambiguity set from the sample tickets: label variants
// (TL Hang / Khoi luong hang / Net WT / KL hang da tru bi), lan-1/lan-2
// two-pass nets, Vietnamese thousands separator (20.730 Kg = 20730 kg),
// and sanity bounds for a truck-scale net weight.
import { describe, expect, it } from 'vitest';
import { parseNetWeightKg, NET_WEIGHT_SANITY } from '../src/extraction/extraction-policy.js';

describe('parseNetWeightKg', () => {
  it('parses TL Hang with Vietnamese thousands separator', () => {
    expect(parseNetWeightKg({ rawLabel: 'TL Hang', rawValue: '20.730 Kg' }))
      .toEqual({ ok: true, kg: 20730 });
  });

  it('parses Net WT plain integer', () => {
    expect(parseNetWeightKg({ rawLabel: 'Net WT', rawValue: '18450' }))
      .toEqual({ ok: true, kg: 18450 });
  });

  it('parses comma decimal when fraction is not 3 digits (12,5 tan-style NOT supported: kg only)', () => {
    expect(parseNetWeightKg({ rawLabel: 'KL hang da tru bi', rawValue: '9.850,5 kg' }))
      .toEqual({ ok: true, kg: 9850.5 });
  });

  it('treats dot+3-digits as thousands, dot+1or2 digits as decimal', () => {
    expect(parseNetWeightKg({ rawLabel: 'Khoi luong hang', rawValue: '7.25 kg' }))
      .toEqual({ ok: false, reason: 'below_sanity_min' });
    expect(parseNetWeightKg({ rawLabel: 'Khoi luong hang', rawValue: '7.250 kg' }))
      .toEqual({ ok: true, kg: 7250 });
  });

  it('sums lan-1 + lan-2 two-pass nets', () => {
    expect(parseNetWeightKg({ rawLabel: 'TL hang lan 1 + lan 2', rawValue: '10.500 + 9.730', twoPass: true }))
      .toEqual({ ok: true, kg: 20230 });
  });

  it('rejects above sanity max', () => {
    expect(parseNetWeightKg({ rawLabel: 'TL Hang', rawValue: '120.000 kg' }))
      .toEqual({ ok: false, reason: 'above_sanity_max' });
  });

  it('rejects unparseable values', () => {
    expect(parseNetWeightKg({ rawLabel: 'TL Hang', rawValue: 'hai muoi tan' }))
      .toEqual({ ok: false, reason: 'unparseable' });
  });

  it('exports sanity bounds for the contract', () => {
    expect(NET_WEIGHT_SANITY).toEqual({ minKg: 100, maxKg: 60000 });
  });
});
