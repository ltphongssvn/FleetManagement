// workers/main-worker/test/extraction-edge-coverage.test.ts
// Branch-gap closure for the 90/90/90/90 gate: edge inputs for the parsing
// policy, non-Error throw normalization in the flow, and Gemini adapter
// response-shape defenses not exercised by the primary suites.
import { describe, expect, it, vi } from 'vitest';
import { parseNetWeightKg } from '../src/extraction/extraction-policy.js';
import { runExtraction, type ExtractionObjectStore, type VlmExtractorPort } from '../src/extraction/extraction-flow.js';
import { GeminiVlmExtractor } from '../src/extraction/gemini-vlm-extractor.js';
import type { ExtractionJobDataWire } from '@fleet/sync-protocol';

const JOB: ExtractionJobDataWire = {
  manifestId: '7b6a1c9e-2f4d-4a8b-9c0d-1e2f3a4b5c6d',
  uploadSessionId: '0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d',
  s3Key: 'k', s3Bucket: 'b', contentType: 'image/jpeg',
};
const BYTES = new Uint8Array([1]);

describe('extraction-policy edge branches', () => {
  it('parses multi-group thousands (1.234.567)', () => {
    expect(parseNetWeightKg({ rawLabel: 'x', rawValue: '1.234,5' })).toEqual({ ok: true, kg: 1234.5 });
    expect(parseNetWeightKg({ rawLabel: 'x', rawValue: '12.345' })).toEqual({ ok: true, kg: 12345 });
  });
  it('rejects empty and whitespace-only values', () => {
    expect(parseNetWeightKg({ rawLabel: 'x', rawValue: '' })).toEqual({ ok: false, reason: 'unparseable' });
    expect(parseNetWeightKg({ rawLabel: 'x', rawValue: '   kg ' })).toEqual({ ok: false, reason: 'unparseable' });
  });
  it('rejects negative values via sanity min', () => {
    expect(parseNetWeightKg({ rawLabel: 'x', rawValue: '-200' })).toEqual({ ok: false, reason: 'below_sanity_min' });
  });
  it('twoPass with an unparseable component fails as unparseable', () => {
    expect(parseNetWeightKg({ rawLabel: 'x', rawValue: '10.000 + abc', twoPass: true })).toEqual({ ok: false, reason: 'unparseable' });
  });
  it('twoPass=false ignores plus-joined input (single parse path)', () => {
    expect(parseNetWeightKg({ rawLabel: 'x', rawValue: '10.000 + 9.000', twoPass: false })).toEqual({ ok: false, reason: 'unparseable' });
  });
  it('rejects malformed groupings (12.34.56)', () => {
    expect(parseNetWeightKg({ rawLabel: 'x', rawValue: '12.34.56' })).toEqual({ ok: false, reason: 'unparseable' });
  });
});

describe('extraction-flow non-Error throw normalization', () => {
  it('wraps a thrown string into Error for the failed outcome', async () => {
    const store: ExtractionObjectStore = { getObject: vi.fn().mockRejectedValue('s3 string blowup') };
    const vlm: VlmExtractorPort = { extractNetWeight: vi.fn() };
    const out = await runExtraction(JOB, store, vlm);
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') {
      expect(out.error).toBeInstanceOf(Error);
      expect(out.error.message).toContain('s3 string blowup');
    }
  });
});

describe('GeminiVlmExtractor response-shape defenses', () => {
  function extractor(fetchFn: typeof globalThis.fetch, baseUrl?: string): GeminiVlmExtractor {
    return new GeminiVlmExtractor({ apiKey: 'k', model: 'm', fetchFn, ...(baseUrl === undefined ? {} : { baseUrl }) });
  }
  it('returns null when candidates are missing entirely', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    expect(await extractor(fetchFn).extractNetWeight({ bytes: BYTES, contentType: 'image/jpeg' })).toBeNull();
  });
  it('returns null when found=true but rawLabel/rawValue are missing', async () => {
    const payload = { candidates: [{ content: { parts: [{ text: JSON.stringify({ found: true }) }] } }] };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    expect(await extractor(fetchFn).extractNetWeight({ bytes: BYTES, contentType: 'image/jpeg' })).toBeNull();
  });
  it('returns twoPass-less shape when twoPass omitted, and honors baseUrl override', async () => {
    const payload = { candidates: [{ content: { parts: [{ text: JSON.stringify({ found: true, rawLabel: 'L', rawValue: 'V' }) }] } }] };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const out = await extractor(fetchFn, 'http://fake.local/v1beta').extractNetWeight({ bytes: BYTES, contentType: 'image/jpeg' });
    expect(out).toEqual({ rawLabel: 'L', rawValue: 'V' });
    const [url] = fetchFn.mock.calls[0] as [string];
    expect(url).toBe('http://fake.local/v1beta/models/m:generateContent');
  });
  it('returns null when schema rejects the model JSON (wrong types)', async () => {
    const payload = { candidates: [{ content: { parts: [{ text: JSON.stringify({ found: 'yes' }) }] } }] };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    expect(await extractor(fetchFn).extractNetWeight({ bytes: BYTES, contentType: 'image/jpeg' })).toBeNull();
  });
});
