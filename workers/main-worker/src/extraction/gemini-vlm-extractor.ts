// workers/main-worker/src/extraction/gemini-vlm-extractor.ts
// Gemini Flash adapter behind VlmExtractorPort (phieu-can net weight).
// Raw fetch, no SDK: one fewer heavy dependency in the worker image, and the
// port keeps the provider swappable (GPT/Claude adapters are config away).
// The model is asked ONLY to read the net-weight field verbatim (label+value,
// twoPass for lan-1/lan-2); ALL numeric interpretation stays in
// extraction-policy.ts so it remains pure, tested, and auditable.
// Error split: non-2xx -> throw (BullMQ retry); found=false or junk text ->
// null (deterministic not_found, never a retry).
import { z } from 'zod';
import type { VlmExtractorPort, VlmRawNetWeight } from './extraction-flow.js';

const GeminiFieldSchema = z.object({
  found: z.boolean(),
  rawLabel: z.string().optional(),
  rawValue: z.string().optional(),
  twoPass: z.boolean().optional(),
});

const PROMPT = [
  'You are reading a Vietnamese truck weighing ticket (phieu can).',
  'Find the NET goods weight field. Possible labels include:',
  'TL Hang, Khoi luong hang, KL hang da tru bi, Net WT, Trong luong hang,',
  'or a two-pass pair (lan 1 / lan 2) whose nets must be summed.',
  'Respond with ONLY minified JSON, no prose, no markdown fences:',
  '{"found":true,"rawLabel":"<label exactly as printed>","rawValue":"<value exactly as printed incl separators and unit>","twoPass":<true if lan-1/lan-2 pair, value as "<v1> + <v2>">}',
  'or {"found":false} if no net-weight field is legible.',
].join(' ');

export interface GeminiVlmExtractorConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly fetchFn?: typeof globalThis.fetch;
  readonly baseUrl?: string;
}

export class GeminiVlmExtractor implements VlmExtractorPort {
  constructor(private readonly config: GeminiVlmExtractorConfig) {}

  async extractNetWeight(input: { readonly bytes: Uint8Array; readonly contentType: string }): Promise<VlmRawNetWeight | null> {
    const fetchFn = this.config.fetchFn ?? globalThis.fetch;
    const base = this.config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    const res = await fetchFn(`${base}/models/${this.config.model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.config.apiKey },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: input.contentType, data: Buffer.from(input.bytes).toString('base64') } },
          ],
        }],
        generationConfig: { response_mime_type: 'application/json', temperature: 0 },
      }),
    });
    if (!res.ok) {
      throw new Error(`gemini generateContent HTTP ${String(res.status)} ${res.statusText}`);
    }
    const payload = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') return null;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      return null;
    }
    const field = GeminiFieldSchema.safeParse(parsedJson);
    if (!field.success || !field.data.found) return null;
    const { rawLabel, rawValue, twoPass } = field.data;
    if (rawLabel === undefined || rawValue === undefined) return null;
    return twoPass === undefined ? { rawLabel, rawValue } : { rawLabel, rawValue, twoPass };
  }
}
