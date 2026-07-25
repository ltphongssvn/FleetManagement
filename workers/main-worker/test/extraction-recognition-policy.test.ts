// workers/main-worker/test/extraction-recognition-policy.test.ts
// RED-first (T33): the pure recognition policy that enforces the phieu-can
// STANDARD-FORMAT rule over the VLM signal, BEFORE any net-weight parsing.
//
// The adapter reads the ticket verbatim and reports: how many distinct tickets
// it sees (slipCount) and which standard layout it matched (format), plus the
// verbatim component value strings. This policy is the single deterministic
// place that turns that signal into either a recognised outcome (a goods-kg to
// parse) or a terminal cannot-recognize reason. All numeric parsing still lives
// in parseNetWeightKg; this policy only decides recognition + which component
// string(s) feed the parser.
//
// Rules (2026): accept ONLY the three standard formats; more than one ticket in
// the photo => multiple_slips; no standard format matched => non_standard_format.
import { describe, expect, it } from 'vitest';
import { recognizePhieuCan } from '../src/extraction/extraction-recognition-policy.js';

describe('recognizePhieuCan', () => {
  it('recognises goods_only and yields the goods component to parse', () => {
    expect(recognizePhieuCan({ slipCount: 1, format: 'goods_only', grossRaw: null, tareRaw: null, goodsRaw: '20.730 Kg' }))
      .toEqual({ ok: true, format: 'goods_only', rawValues: ['20.730 Kg'] });
  });

  it('recognises truck_and_goods and yields gross + tare for the policy to net', () => {
    expect(recognizePhieuCan({ slipCount: 1, format: 'truck_and_goods', grossRaw: '28.450', tareRaw: '8.720', goodsRaw: null }))
      .toEqual({ ok: true, format: 'truck_and_goods', rawValues: ['28.450', '8.720'] });
  });

  it('recognises truck_only but yields no goods component (manual entry needed)', () => {
    expect(recognizePhieuCan({ slipCount: 1, format: 'truck_only', grossRaw: null, tareRaw: '8.720', goodsRaw: null }))
      .toEqual({ ok: false, reason: 'no_goods_weight', format: 'truck_only' });
  });

  it('rejects several tickets in one photo as multiple_slips', () => {
    expect(recognizePhieuCan({ slipCount: 3, format: 'goods_only', grossRaw: null, tareRaw: null, goodsRaw: '20.730' }))
      .toEqual({ ok: false, reason: 'multiple_slips' });
  });

  it('rejects a layout outside the three standard formats as non_standard_format', () => {
    expect(recognizePhieuCan({ slipCount: 1, format: null, grossRaw: null, tareRaw: null, goodsRaw: null }))
      .toEqual({ ok: false, reason: 'non_standard_format' });
  });

  it('multiple_slips takes precedence over a matched format (count checked first)', () => {
    expect(recognizePhieuCan({ slipCount: 2, format: 'truck_and_goods', grossRaw: '28.450', tareRaw: '8.720', goodsRaw: null }))
      .toEqual({ ok: false, reason: 'multiple_slips' });
  });

  it('treats a recognised format missing its required components as non_standard_format', () => {
    expect(recognizePhieuCan({ slipCount: 1, format: 'goods_only', grossRaw: null, tareRaw: null, goodsRaw: null }))
      .toEqual({ ok: false, reason: 'non_standard_format' });
  });
});
