// apps/api/src/copilot/anthropic-copilot-llm.adapter.ts
// Claude Haiku 4.5 adapter behind CopilotLlmPort (the palette LLM boundary).
// Raw fetch, no SDK -- the house pattern (workers/.../gemini-vlm-extractor.ts,
// whose comment notes that GPT/Claude adapters are config away).
//
// PURE TRANSPORT: text plus a caller-supplied JSON Schema in -> Anthropic
// Messages call -> the model raw JSON out as unknown. It defines NO draft
// schema and performs NO trust logic. The planner owns DraftSchema (the single
// SSOT); it derives the wire schema from that SSOT and validates the reply
// against it. This adapter only forwards a schema it does not own.
//
// STRUCTURED OUTPUTS: the schema travels as output_config.format, which moves
// the constraint from the prompt into the SAMPLER -- the provider compiles it
// into a grammar and cannot emit tokens that violate it. Prompting alone left
// every token sampled from the full vocabulary, so a markdown fence reached
// JSON.parse and became an HTTP 500 for the dispatcher.
//
// The one untrusted boundary this file owns is the Anthropic HTTP response
// envelope, Zod-parsed and never cast.
//
// Error policy. Non-2xx throws, and the thrown message CARRIES THE RESPONSE
// BODY: Anthropic answers 400 with an invalid_request_error naming the exact
// offending schema keyword, and discarding it once forced a bespoke probe to
// rediscover what the API had already said. A malformed 2xx envelope also
// throws (contract breach). Both are EXECUTION errors the planner catches and
// degrades to clarify. A well-formed 2xx whose text is somehow not JSON
// returns that raw text as unknown so DraftSchema rejects it and the palette
// clarifies -- a model quirk must never become a 500.
import { z } from 'zod';
import type { CopilotLlmPort } from './copilot-planner.service.js';

// Anthropic Messages response envelope (untrusted external input). Only the
// fields we read are modelled; unknown sibling fields are ignored (not strict)
// so provider-additive changes do not break us, while the shape we depend on
// is enforced.
const AnthropicTextBlockSchema = z.object({ type: z.literal('text'), text: z.string() });
const AnthropicMessageResponseSchema = z.object({
  content: z.array(z.union([AnthropicTextBlockSchema, z.object({ type: z.string() })])).min(1),
});

// No schema prose here BY DESIGN. The shape travels as a JSON Schema in
// output_config.format, carrying per-field descriptions generated from the
// planner DraftSchema. Restating it here would duplicate the SSOT and let the
// two drift -- precisely the class of bug that produced a draft with invented
// keys.
const SYSTEM_PROMPT = [
  'You convert ONE Vietnamese dispatcher command into a structured draft.',
  'The response shape is supplied out-of-band and enforced during generation.',
  'Do NOT invent ids or passwords.',
  'If the request is unclear, still return your best guess.',
].join(' ');

const MAX_TOKENS = 1024;
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_ERROR_BODY_CHARS = 500;

export interface AnthropicCopilotLlmConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly fetchFn?: typeof globalThis.fetch;
  readonly baseUrl?: string;
}

export class AnthropicCopilotLlmAdapter implements CopilotLlmPort {
  constructor(private readonly config: AnthropicCopilotLlmConfig) {}

  async proposeDraft(text: string, jsonSchema: Record<string, unknown>): Promise<unknown> {
    const fetchFn = this.config.fetchFn ?? globalThis.fetch;
    const base = this.config.baseUrl ?? 'https://api.anthropic.com';
    const res = await fetchFn(base + '/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text }],
        output_config: { format: { type: 'json_schema', schema: jsonSchema } },
      }),
    });
    if (!res.ok) {
      // Read the body BEFORE throwing. It is the diagnosis: a 400 names the
      // rejected schema keyword, a 429 carries the retry hint. Truncated so a
      // large payload cannot flood the log, and never containing the api key
      // (which travels in a header, not the body).
      let detail: string;
      try {
        detail = (await res.text()).slice(0, MAX_ERROR_BODY_CHARS);
      } catch {
        detail = '(body unreadable)';
      }
      throw new Error(
        'anthropic messages HTTP ' +
          String(res.status) +
          ' ' +
          res.statusText +
          ' -- ' +
          detail,
      );
    }
    // Untrusted boundary: Zod-validate the envelope, never cast.
    const envelope = AnthropicMessageResponseSchema.parse(await res.json());
    const firstText = envelope.content.find(
      (b): b is z.infer<typeof AnthropicTextBlockSchema> => b.type === 'text',
    );
    if (firstText === undefined) {
      throw new Error('anthropic messages response contained no text block');
    }
    try {
      return JSON.parse(firstText.text) as unknown;
    } catch {
      return firstText.text as unknown;
    }
  }
}
