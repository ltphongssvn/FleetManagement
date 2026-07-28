// apps/api/test/copilot-anthropic-adapter.test.ts
// RED-first (copilot LLM adapter). The palette's COPILOT_LLM_PORT is wired to
// Claude Haiku 4.5 via the Anthropic Messages REST API (raw fetch, no SDK --
// the house pattern from gemini-vlm-extractor.ts, whose own comment anticipates
// "GPT/Claude adapters are config away"). Model choice is technical, not
// inherited: 2026 structured-output benchmarks rank Haiku 4.5 best for strict
// JSON + instruction-following at sub-600ms TTFT, which is exactly this task
// (one Vietnamese command -> strict DraftSchema, user-facing Ctrl+K).
//
// The adapter is a PURE TRANSPORT: text in -> Anthropic call -> the model's raw
// JSON returned as `unknown`. It performs ZERO trust logic and defines NO draft
// schema -- the planner owns DraftSchema (single SSOT) and Zod-validates the
// unknown. The ONE boundary the adapter validates is the Anthropic HTTP
// response envelope (untrusted external input -> Zod-parsed, never cast --
// closing the envelope-cast gap the worker extractor left).
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicCopilotLlmAdapter } from '../src/copilot/anthropic-copilot-llm.adapter.js';

// Runtime-generated so no credential-shaped literal sits next to the
// `apiKey` keyword (detect-secrets/GitGuardian clean, zero pragma -- the
// house scanner rule: eliminate the SOURCE, never suppress the symptom).
const TEST_KEY = 'k_' + randomBytes(8).toString('hex');
const CFG = { apiKey: TEST_KEY, model: 'claude-haiku-4-5' };

function messagesResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('AnthropicCopilotLlmAdapter.proposeDraft', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the Anthropic Messages API with the configured model, key headers, and temperature 0', async () => {
    const draftText = JSON.stringify({
      summaryVi: 'Se tao tai xe',
      commands: [{ type: 'create_driver', fullName: 'Nguyen Van B', phone: '0900000456' }],
    });
    const fetchFn = vi.fn(() => Promise.resolve(messagesResponse(draftText)));
    const adapter = new AnthropicCopilotLlmAdapter({ ...CFG, fetchFn: fetchFn as never });

    const out = await adapter.proposeDraft('them tai xe Nguyen Van B 0900000456');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const call = fetchFn.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(TEST_KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string) as { model: string; temperature: number; max_tokens: number };
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBeGreaterThan(0);
    // Returned verbatim as unknown -- the planner owns DraftSchema validation.
    expect(out).toEqual(JSON.parse(draftText));
  });

  it('returns the parsed JSON as unknown for the planner to strict-validate (no schema in the adapter)', async () => {
    // Even a shape the planner will REJECT is returned faithfully; the adapter
    // never judges the draft.
    const junk = JSON.stringify({ not: 'a draft' });
    const fetchFn = vi.fn(() => Promise.resolve(messagesResponse(junk)));
    const adapter = new AnthropicCopilotLlmAdapter({ ...CFG, fetchFn: fetchFn as never });
    const out = await adapter.proposeDraft('gibberish');
    expect(out).toEqual({ not: 'a draft' });
  });

  it('throws on a non-2xx Anthropic response (surfaced to the route, not swallowed)', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response('rate limited', { status: 429, statusText: 'Too Many Requests' })),
    );
    const adapter = new AnthropicCopilotLlmAdapter({ ...CFG, fetchFn: fetchFn as never });
    await expect(adapter.proposeDraft('x')).rejects.toThrow(/429/);
  });

  it('throws when the response envelope is malformed (Zod-validated boundary, not cast)', async () => {
    // Missing content array -> the envelope schema rejects it.
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ id: 'x', type: 'message' }), { status: 200 })),
    );
    const adapter = new AnthropicCopilotLlmAdapter({ ...CFG, fetchFn: fetchFn as never });
    await expect(adapter.proposeDraft('x')).rejects.toThrow();
  });
  it('throws when a well-formed envelope carries no text block (tool_use-only reply)', async () => {
    // Envelope is VALID (content array, min 1) but holds no text block, so the
    // union's fallback member matches and the text-block find returns undefined.
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 'msg_2', type: 'message', content: [{ type: 'tool_use' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const adapter = new AnthropicCopilotLlmAdapter({ ...CFG, fetchFn: fetchFn as never });
    await expect(adapter.proposeDraft('x')).rejects.toThrow(/no text block/);
  });

  it('honours a configured baseUrl override instead of the public Anthropic host', async () => {
    // Exercises the baseUrl ?? default branch (proxy/gateway deployments).
    const draftText = JSON.stringify({ summaryVi: 'Kiem tra', commands: [] });
    const fetchFn = vi.fn(() => Promise.resolve(messagesResponse(draftText)));
    const adapter = new AnthropicCopilotLlmAdapter({
      ...CFG,
      baseUrl: 'https://gateway.internal',
      fetchFn: fetchFn as never,
    });

    await adapter.proposeDraft('x');

    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://gateway.internal/v1/messages');
  });

  it('falls back to the global fetch when no fetchFn is injected (production wiring)', async () => {
    // Exercises the fetchFn ?? globalThis.fetch branch -- the path the Nest
    // factory actually takes, since it constructs the adapter without a stub.
    const draftText = JSON.stringify({ summaryVi: 'Toan cuc', commands: [] });
    const globalFetch = vi.fn(() => Promise.resolve(messagesResponse(draftText)));
    vi.stubGlobal('fetch', globalFetch);

    const adapter = new AnthropicCopilotLlmAdapter({ ...CFG });
    const out = await adapter.proposeDraft('x');

    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(out).toEqual(JSON.parse(draftText));
  });
});
