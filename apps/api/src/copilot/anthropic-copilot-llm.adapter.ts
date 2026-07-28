// apps/api/src/copilot/anthropic-copilot-llm.adapter.ts
// Claude Haiku 4.5 adapter behind CopilotLlmPort (the palette LLM boundary).
// Raw fetch, no SDK -- the house pattern (workers/.../gemini-vlm-extractor.ts,
// whose comment notes "GPT/Claude adapters are config away"). Model choice is
// technical: 2026 structured-output benchmarks rank Haiku 4.5 best for strict
// JSON + instruction-following at sub-600ms TTFT, matching this task (one
// Vietnamese command -> strict DraftSchema, user-facing Ctrl+K).
//
// PURE TRANSPORT: text in -> Anthropic Messages call -> the model's raw JSON
// returned as `unknown`. It defines NO draft schema (the planner owns
// DraftSchema, the single SSOT) and performs NO trust logic. The one untrusted
// boundary it DOES own is the Anthropic HTTP response envelope, which is
// Zod-parsed (never cast) before the assistant text is read.
//
// Error split (mirrors the worker extractor): non-2xx -> throw (the /plan route
// surfaces it); a 2xx whose envelope is malformed -> throw (contract breach).
// A well-formed envelope whose TEXT is non-JSON returns that raw string as
// unknown -> the planner's DraftSchema rejects it -> clarify. The adapter never
// itself decides a draft is invalid.
import { z } from 'zod';
import type { CopilotLlmPort } from './copilot-planner.service.js';

// Anthropic Messages response envelope (untrusted external input). Only the
// fields we read are modelled; unknown sibling fields are ignored (not strict)
// so provider-additive changes do not break us, but the shape we depend on is
// enforced.
const AnthropicTextBlockSchema = z.object({ type: z.literal('text'), text: z.string() });
const AnthropicMessageResponseSchema = z.object({
  content: z.array(z.union([AnthropicTextBlockSchema, z.object({ type: z.string() })])).min(1),
});

const SYSTEM_PROMPT = [
  'You convert ONE Vietnamese dispatcher command into a strict JSON draft.',
  'Respond with ONLY minified JSON, no prose, no markdown fences.',
  'Schema: {"summaryVi":"<short Vietnamese summary>","commands":[...]} where each command is EITHER',
  '{"type":"create_driver","fullName":"<name>","phone":"<digits>"}',
  'OR {"type":"assign_driver_to_vehicle","driverName":"<name>","vehiclePlate":"<plate as written>"}.',
  'Use only these two command types. Do NOT invent ids, passwords, or fields.',
  'commands must have at least one entry. If the request is unclear, still return your best strict-JSON guess.',
].join(' ');

const MAX_TOKENS = 1024;
const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicCopilotLlmConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly fetchFn?: typeof globalThis.fetch;
  readonly baseUrl?: string;
}

export class AnthropicCopilotLlmAdapter implements CopilotLlmPort {
  constructor(private readonly config: AnthropicCopilotLlmConfig) {}

  async proposeDraft(text: string): Promise<unknown> {
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
      }),
    });
    if (!res.ok) {
      throw new Error('anthropic messages HTTP ' + String(res.status) + ' ' + res.statusText);
    }
    // Untrusted boundary: Zod-validate the envelope, never cast.
    const envelope = AnthropicMessageResponseSchema.parse(await res.json());
    const firstText = envelope.content.find(
      (b): b is z.infer<typeof AnthropicTextBlockSchema> => b.type === 'text',
    );
    if (firstText === undefined) {
      throw new Error('anthropic messages response contained no text block');
    }
    // Return the model draft verbatim as unknown; the planner strict-parses it.
    return JSON.parse(firstText.text) as unknown;
  }
}
