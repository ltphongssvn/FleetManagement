// apps/api/test/copilot-anthropic-adapter.test.ts
// Spec for the copilot LLM adapter. The palette COPILOT_LLM_PORT is wired to
// Claude Haiku 4.5 via the Anthropic Messages REST API (raw fetch, no SDK --
// the house pattern from workers/.../gemini-vlm-extractor.ts).
//
// The adapter is PURE TRANSPORT: text plus a caller-supplied JSON Schema in ->
// Anthropic call -> the model raw JSON out as unknown. It defines NO draft
// schema of its own; the planner owns DraftSchema (single SSOT) and both
// derives the wire schema from it and validates the reply against it.
//
// STRUCTURED OUTPUTS: the schema travels as output_config.format, moving the
// constraint from the prompt into the sampler. Prompt-and-parse previously let
// a markdown fence reach JSON.parse and 500 the dispatcher.
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicCopilotLlmAdapter } from '../src/copilot/anthropic-copilot-llm.adapter.js';

// Runtime-generated so no credential-shaped literal sits next to the apiKey
// keyword (detect-secrets/GitGuardian clean, zero pragma -- eliminate the
// SOURCE, never suppress the symptom).
const TEST_KEY = 'k_' + randomBytes(8).toString('hex');
const CFG = { apiKey: TEST_KEY, model: 'claude-haiku-4-5-20251001' };

// The schema the PLANNER owns and hands down. The adapter never authors one.
const SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summaryVi', 'commands'],
  properties: {
    summaryVi: { type: 'string' },
    commands: { type: 'array', items: { type: 'object' } },
  },
};

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

    const out = await adapter.proposeDraft('them tai xe Nguyen Van B 0900000456', SCHEMA);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const call = fetchFn.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(TEST_KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string) as {
      model: string;
      temperature: number;
      max_tokens: number;
    };
    expect(body.model).toBe('claude-haiku-4-5-20251001');
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
    const out = await adapter.proposeDraft('gibberish', SCHEMA);
    expect(out).toEqual({ not: 'a draft' });
  });

  it('throws on a non-2xx Anthropic response (surfaced to the planner, which degrades to clarify)', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response('rate limited', { status: 429, statusText: 'Too Many Requests' })),
    );
    const adapter = new AnthropicCopilotLlmAdapter({ ...CFG, fetchFn: fetchFn as never });
    await expect(adapter.proposeDraft('x', SCHEMA)).rejects.toThrow(/429/);
  });

  // Provider error bodies must survive. Anthropic answers 400 with an
  // invalid_request_error naming the exact offending schema keyword, and the
  // adapter discarded it, leaving only a bare status. Diagnosing the live
  // failure then required a bespoke probe reproducing the call by hand. The
  // body IS the diagnosis; carry it into the thrown error.
  it('includes the provider error body in the thrown message, not just the status', async () => {
    const problem = JSON.stringify({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'output_config.format.schema: minLength is not supported',
      },
    });
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response(problem, { status: 400, statusText: 'Bad Request' })),
    );
    const adapter = new AnthropicCopilotLlmAdapter({ ...CFG, fetchFn: fetchFn as never });
    await expect(adapter.proposeDraft('x', SCHEMA)).rejects.toThrow(/minLength is not supported/);
  });

  it('throws when the response envelope is malformed (Zod-validated boundary, not cast)', async () => {
    // Missing content array -> the envelope schema rejects it.
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ id: 'x', type: 'message' }), { status: 200 })),
    );
    const adapter = new AnthropicCopilotLlmAdapter({ ...CFG, fetchFn: fetchFn as never });
    await expect(adapter.proposeDraft('x', SCHEMA)).rejects.toThrow();
  });

  it('throws when a well-formed envelope carries no text block (tool_use-only reply)', async () => {
    // Envelope is VALID (content array, min 1) but holds no text block, so the
    // union fallback member matches and the text-block find returns undefined.
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ id: 'msg_2', type: 'message', content: [{ type: 'tool_use' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const adapter = new AnthropicCopilotLlmAdapter({ ...CFG, fetchFn: fetchFn as never });
    await expect(adapter.proposeDraft('x', SCHEMA)).rejects.toThrow(/no text block/);
  });

  it('returns raw text instead of throwing when a 2xx reply is not JSON', async () => {
    // Constrained generation should prevent this, but if it happens the raw
    // string comes back as unknown, DraftSchema rejects it, and the palette
    // clarifies. A model quirk must never become an HTTP 500.
    const fetchFn = vi.fn(() => Promise.resolve(messagesResponse('not json at all')));
    const adapter = new AnthropicCopilotLlmAdapter({ ...CFG, fetchFn: fetchFn as never });
    const out = await adapter.proposeDraft('x', SCHEMA);
    expect(out).toBe('not json at all');
  });

  it('honours a configured baseUrl override instead of the public Anthropic host', async () => {
    // Exercises the baseUrl default branch (proxy/gateway deployments).
    const draftText = JSON.stringify({ summaryVi: 'Kiem tra', commands: [] });
    const fetchFn = vi.fn(() => Promise.resolve(messagesResponse(draftText)));
    const adapter = new AnthropicCopilotLlmAdapter({
      ...CFG,
      baseUrl: 'https://gateway.internal',
      fetchFn: fetchFn as never,
    });

    await adapter.proposeDraft('x', SCHEMA);

    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://gateway.internal/v1/messages');
  });

  it('falls back to the global fetch when no fetchFn is injected (production wiring)', async () => {
    // Exercises the globalThis.fetch branch -- the path the Nest factory takes,
    // since it constructs the adapter without a transport stub.
    const draftText = JSON.stringify({ summaryVi: 'Toan cuc', commands: [] });
    const globalFetch = vi.fn(() => Promise.resolve(messagesResponse(draftText)));
    vi.stubGlobal('fetch', globalFetch);

    const adapter = new AnthropicCopilotLlmAdapter({ ...CFG });
    const out = await adapter.proposeDraft('x', SCHEMA);

    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(out).toEqual(JSON.parse(draftText));
  });

  it('sends the planner schema as output_config.format so generation is constrained', async () => {
    const draftText = JSON.stringify({ summaryVi: 'Se tao tai xe', commands: [] });
    const fetchFn = vi.fn(() => Promise.resolve(messagesResponse(draftText)));
    const adapter = new AnthropicCopilotLlmAdapter({ ...CFG, fetchFn: fetchFn as never });

    await adapter.proposeDraft('them tai xe', SCHEMA);

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      output_config?: { format?: { type?: string; schema?: unknown } };
    };
    expect(body.output_config?.format?.type).toBe('json_schema');
    expect(body.output_config?.format?.schema).toEqual(SCHEMA);
  });

  it('does not hand-write the draft shape in the system prompt', async () => {
    // The prompt used to restate the draft shape in prose (field names, both
    // command types), duplicating DraftSchema and free to drift from it. With
    // the shape carried as a JSON Schema, that prose is redundant AND
    // dangerous, so it must be gone.
    const draftText = JSON.stringify({ summaryVi: 'Se tao tai xe', commands: [] });
    const fetchFn = vi.fn(() => Promise.resolve(messagesResponse(draftText)));
    const adapter = new AnthropicCopilotLlmAdapter({ ...CFG, fetchFn: fetchFn as never });

    await adapter.proposeDraft('them tai xe', SCHEMA);

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { system: string };
    expect(body.system).not.toContain('summaryVi');
    expect(body.system).not.toContain('create_driver');
    expect(body.system).not.toContain('assign_driver_to_vehicle');
  });
});
