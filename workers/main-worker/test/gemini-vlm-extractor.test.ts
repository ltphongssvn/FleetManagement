// workers/main-worker/test/gemini-vlm-extractor.test.ts
// RED (phieu-can): Gemini Flash adapter behind VlmExtractorPort. Injected
// fetch (no SDK): correct endpoint/model/key header, inline base64 image,
// JSON-response parse to VlmRawNetWeight, null when the model reports no
// net-weight field, throw on non-2xx (retryable upstream).
import { describe, expect, it, vi } from 'vitest';
import { GeminiVlmExtractor } from '../src/extraction/gemini-vlm-extractor.js';

const BYTES = new Uint8Array([255, 216, 255]);

function okResponse(payload: unknown): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('GeminiVlmExtractor', () => {
  it('calls generateContent with key header + inline image, parses fields', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ found: true, rawLabel: 'TL Hang', rawValue: '20.730 Kg', twoPass: false }));
    const x = new GeminiVlmExtractor({ apiKey: 'k-123', model: 'gemini-flash-test', fetchFn }); // pragma: allowlist secret
    const out = await x.extractNetWeight({ bytes: BYTES, contentType: 'image/jpeg' });
    expect(out).toEqual({ rawLabel: 'TL Hang', rawValue: '20.730 Kg', twoPass: false });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/models/gemini-flash-test:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k-123');
    const body = JSON.parse(init.body as string) as { contents: { parts: { inline_data?: { mime_type: string; data: string } }[] }[] };
    const inline = body.contents[0]?.parts.find((q) => q.inline_data);
    expect(inline?.inline_data?.mime_type).toBe('image/jpeg');
    expect(inline?.inline_data?.data).toBe(Buffer.from(BYTES).toString('base64'));
  });

  it('returns null when model reports found=false', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ found: false }));
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
