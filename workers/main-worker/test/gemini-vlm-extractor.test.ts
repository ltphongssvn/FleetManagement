// workers/main-worker/test/gemini-vlm-extractor.test.ts
// Gemini Flash adapter behind VlmExtractorPort. Injected fetch (no SDK):
// correct endpoint/model/key header, inline base64 image, JSON-response parse to
// VlmRawNetWeight, null when the model reports no net-weight field, throw on
// non-2xx (retryable upstream). The model returns a DECOMPOSED rawValues array
// (one verbatim value per weighing) — no twoPass boolean, no '+'-delimited string.
import { describe, expect, it, vi } from 'vitest';
import { GeminiVlmExtractor } from '../src/extraction/gemini-vlm-extractor.js';

const BYTES = new Uint8Array([255, 216, 255]);

function okResponse(payload: unknown): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('GeminiVlmExtractor', () => {
  it('calls generateContent with key header + inline image, parses single-pass rawValues', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ found: true, rawLabel: 'TL Hang', rawValues: ['20.730 Kg'] }));
    const x = new GeminiVlmExtractor({ apiKey: 'k-123', model: 'gemini-flash-test', fetchFn }); // pragma: allowlist secret
    const out = await x.extractNetWeight({ bytes: BYTES, contentType: 'image/jpeg' });
    expect(out).toEqual({ rawLabel: 'TL Hang', rawValues: ['20.730 Kg'] });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/models/gemini-flash-test:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k-123');
    const body = JSON.parse(init.body as string) as { contents: { parts: { inline_data?: { mime_type: string; data: string } }[] }[] };
    const inline = body.contents[0]?.parts.find((q) => q.inline_data);
    expect(inline?.inline_data?.mime_type).toBe('image/jpeg');
    expect(inline?.inline_data?.data).toBe(Buffer.from(BYTES).toString('base64'));
  });

  it('parses a two-pass pair as a 2-element rawValues array', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ found: true, rawLabel: 'TL hang lan 1 / lan 2', rawValues: ['10.500', '9.730'] }));
    const x = new GeminiVlmExtractor({ apiKey: 'k', model: 'm', fetchFn });
    const out = await x.extractNetWeight({ bytes: BYTES, contentType: 'image/jpeg' });
    expect(out).toEqual({ rawLabel: 'TL hang lan 1 / lan 2', rawValues: ['10.500', '9.730'] });
  });

  it('parses the T33 recognition signal (slipCount, format, component raws)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ found: true, rawLabel: 'xe+hang/xe', rawValues: [], slipCount: 1, format: 'truck_and_goods', grossRaw: '28.450', tareRaw: '8.720', goodsRaw: null }));
    const x = new GeminiVlmExtractor({ apiKey: 'k', model: 'm', fetchFn });
    const out = await x.extractNetWeight({ bytes: BYTES, contentType: 'image/jpeg' });
    expect(out).toMatchObject({ slipCount: 1, format: 'truck_and_goods', grossRaw: '28.450', tareRaw: '8.720', goodsRaw: null });
  });

  it('asks the model for the standard-format recognition signal in the prompt', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ found: true, rawLabel: 'L', rawValues: ['20.730'], slipCount: 1, format: 'goods_only', grossRaw: null, tareRaw: null, goodsRaw: '20.730' }));
    const x = new GeminiVlmExtractor({ apiKey: 'k', model: 'm', fetchFn });
    await x.extractNetWeight({ bytes: BYTES, contentType: 'image/jpeg' });
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { contents: { parts: { text?: string }[] }[] };
    const promptText = body.contents[0]?.parts.map((pp) => pp.text ?? '').join(' ');
    expect(promptText).toContain('slipCount');
    expect(promptText).toContain('truck_and_goods');
    expect(promptText).toContain('goods_only');
    expect(promptText).toContain('truck_only');
  });

  it('returns null when model reports found=false', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ found: false }));
    const x = new GeminiVlmExtractor({ apiKey: 'k', model: 'm', fetchFn });
    expect(await x.extractNetWeight({ bytes: BYTES, contentType: 'image/jpeg' })).toBeNull();
  });

  it('returns null when found=true but rawValues is empty', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ found: true, rawLabel: 'L', rawValues: [] }));
    const x = new GeminiVlmExtractor({ apiKey: 'k', model: 'm', fetchFn });
    expect(await x.extractNetWeight({ bytes: BYTES, contentType: 'image/jpeg' })).toBeNull();
  });

  it('returns null on unparseable model text (defensive, not a retry)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'not json' }] } }],
    }), { status: 200 }));
    const x = new GeminiVlmExtractor({ apiKey: 'k', model: 'm', fetchFn });
    expect(await x.extractNetWeight({ bytes: BYTES, contentType: 'image/jpeg' })).toBeNull();
  });

  it('throws on non-2xx (quota etc) so BullMQ retries', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('quota', { status: 429, statusText: 'Too Many Requests' }));
    const x = new GeminiVlmExtractor({ apiKey: 'k', model: 'm', fetchFn });
    await expect(x.extractNetWeight({ bytes: BYTES, contentType: 'image/jpeg' })).rejects.toThrow('429');
  });
});
