// workers/main-worker/src/extraction/gemini-vlm-extractor.ts
// Gemini Flash adapter behind VlmExtractorPort (phieu-can net weight).
// Raw fetch, no SDK: one fewer heavy dependency in the worker image, and the
// port keeps the provider swappable (GPT/Claude adapters are config away).
//
// The model reads the ticket VERBATIM and additionally CLASSIFIES it (T33):
//   - slipCount: how many distinct weighing tickets are in the image.
//   - format: which of the three STANDARD phieu-can layouts it matches, or null.
//   - grossRaw/tareRaw/goodsRaw: the verbatim component value strings for that
//     layout (gross+tare for truck_and_goods; goods for goods_only; tare for
//     truck_only). rawValues stays for backward-compat (legacy net path).
// ALL numeric interpretation + the standard-format RULE stay in the pure
// policies (extraction-recognition-policy + extraction-policy), so this adapter
// only relays the raw model signal. The model is never asked to add or judge
// numbers; it reports what is printed and which layout it sees.
// Error split: non-2xx -> throw (BullMQ retry); found=false / empty signal /
// junk text -> null (deterministic not_found, never a retry).
import { z } from 'zod';
import { PHIEU_CAN_FORMATS } from '@fleet/domain';
import type { VlmExtractorPort, VlmRawNetWeight } from './extraction-flow.js';

const GeminiFieldSchema = z.object({
  found: z.boolean(),
  rawLabel: z.string().optional(),
  rawValues: z.array(z.string()).optional(),
  // T33 recognition signal (all optional = tolerant of a model that omits them;
  // the flow treats a missing format as the legacy path).
  slipCount: z.number().int().positive().optional(),
  format: z.enum(PHIEU_CAN_FORMATS).nullable().optional(),
  grossRaw: z.string().nullable().optional(),
  tareRaw: z.string().nullable().optional(),
  goodsRaw: z.string().nullable().optional(),
});

const PROMPT = [
  'You are reading Vietnamese truck weighing tickets (phieu can).',
  'FIRST count how many DISTINCT weighing tickets are visible in the image and report it as slipCount.',
  'THEN classify the ticket layout as exactly one of these three STANDARD formats, or null if none fits:',
  'truck_and_goods (the ticket prints BOTH a gross weight xe+hang AND a tare weight xe);',
  'truck_only (the ticket prints the truck/tare weight only, no goods weight);',
  'goods_only (the ticket prints the goods weight directly).',
  'Read the component values VERBATIM (exactly as printed, incl separators and unit):',
  'grossRaw = the gross xe+hang value (truck_and_goods only, else null);',
  'tareRaw = the truck/tare xe value (truck_and_goods or truck_only, else null);',
  'goodsRaw = the goods value (goods_only only, else null).',
  'Also keep rawValues as the verbatim net value(s) when a net field is directly printed (else []).',
  'Respond with ONLY minified JSON, no prose, no markdown fences, with keys:',
  'found, slipCount, format, rawLabel, rawValues, grossRaw, tareRaw, goodsRaw.',
  'Use {found:false} if nothing legible. Do NOT add or compute any numbers yourself.',
].join(' ');

export interface GeminiVlmExtractorConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly fetchFn?: typeof globalThis.fetch;
  readonly baseUrl?: string;
}

export class GeminiVlmExtractor implements VlmExtractorPort {
  constructor(private readonly config: GeminiVlmExtractorConfig) {}

  async extractNetWeight(input: {
    readonly bytes: Uint8Array;
    readonly contentType: string;
  }): Promise<VlmRawNetWeight | null> {
    const fetchFn = this.config.fetchFn ?? globalThis.fetch;
    const base = this.config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    // Plain string concatenation (no template literals): keeps this file free of
    // backticks, per the project file-write discipline.
    const url = base + '/models/' + this.config.model + ':generateContent';
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.config.apiKey },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT },
              {
                inline_data: {
                  mime_type: input.contentType,
                  data: Buffer.from(input.bytes).toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: { response_mime_type: 'application/json', temperature: 0 },
      }),
    });
    if (!res.ok) {
      throw new Error('gemini generateContent HTTP ' + String(res.status) + ' ' + res.statusText);
    }
    const payload = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
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
    const d = field.data;
    // Recognition path: the model reported a format key (value may be null). Relay
    // the full signal; the flow + policies enforce the standard-format rule.
    if (d.format !== undefined) {
      return {
        rawLabel: d.rawLabel ?? '',
        rawValues: d.rawValues ?? [],
        slipCount: d.slipCount ?? 1,
        format: d.format,
        grossRaw: d.grossRaw ?? null,
        tareRaw: d.tareRaw ?? null,
        goodsRaw: d.goodsRaw ?? null,
      };
    }
    // Legacy path (model omitted the recognition signal): net value(s) only.
    const { rawLabel, rawValues } = d;
    if (rawLabel === undefined || rawValues === undefined || rawValues.length === 0) return null;
    return { rawLabel, rawValues };
  }
}
