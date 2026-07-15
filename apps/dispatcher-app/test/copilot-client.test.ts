// apps/dispatcher-app/test/copilot-client.test.ts
// RED-first spec for the dispatcher-app copilot HTTP client (T17 V10a).
// Two-axis rule at the trust boundary: every response body is UNTRUSTED
// and goes through the shared parse helpers from @fleet/sync-protocol
// (parseCopilotPlanResponse / parseCopilotExecutionResult) -- garbage or
// unknown shapes become typed errors, never exceptions or any-casts.
// fetch is INJECTED so the client is pure and unit-testable; the plan is
// forwarded to /copilot/execute VERBATIM (planId = idempotency key).
// Written before src/api/copilot-client.ts exists.
import { describe, expect, it, vi } from 'vitest';
import type { CopilotPlan } from '@fleet/sync-protocol';
import { createCopilotClient } from '../src/api/copilot-client.js';
const GUID_A = 'a3bb189e-8bf9-4888-9912-ace4e6543002';
const GUID_B = 'b4cc290f-9c0a-4999-aa23-bdf5f7654113';
const PLAN: CopilotPlan = {
  planId: GUID_A,
  summaryVi: 'Sẽ tạo tên hàng Gạo',
  commands: [{ type: 'create_cargo_type', commandId: GUID_B, name: 'Gạo' }],
};
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
describe('@fleet/dispatcher-app copilot client', () => {
  it('POSTs the transcript to /copilot/plan with the bearer token', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse(200, { kind: 'clarify', questionVi: 'Xe nào?' })));
    const client = createCopilotClient({
      baseUrl: 'https://api.fleet.test',
      getToken: () => Promise.resolve('tok-123'),
      fetchFn,
    });
    const out = await client.plan('Điều xe 62H 05194');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.kind).toBe('clarify');
    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('https://api.fleet.test/copilot/plan');
    expect(call[1].method).toBe('POST');
    const headers = call[1].headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer tok-123');
    expect(JSON.parse(call[1].body as string)).toEqual({ text: 'Điều xe 62H 05194' });
  });
  it('forwards the plan VERBATIM to /copilot/execute', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse(200, { planId: GUID_A, status: 'completed', results: [] })));
    const client = createCopilotClient({
      baseUrl: 'https://api.fleet.test',
      getToken: () => Promise.resolve('tok-123'),
      fetchFn,
    });
    const out = await client.execute(PLAN);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.status).toBe('completed');
    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('https://api.fleet.test/copilot/execute');
    expect(JSON.parse(call[1].body as string)).toEqual(PLAN);
  });
  it('maps a malformed 200 body to a typed Vietnamese error', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse(200, { totally: 'wrong' })));
    const client = createCopilotClient({
      baseUrl: 'https://api.fleet.test',
      getToken: () => Promise.resolve('tok'),
      fetchFn,
    });
    const out = await client.plan('x');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errorVi.length).toBeGreaterThan(0);
  });
  it('maps HTTP failures and thrown fetch errors to typed errors', async () => {
    const fail = vi.fn(() => Promise.resolve(jsonResponse(503, {})));
    const c1 = createCopilotClient({ baseUrl: 'https://x', getToken: () => Promise.resolve('t'), fetchFn: fail });
    const r1 = await c1.plan('x');
    expect(r1.ok).toBe(false);
    const boom = vi.fn(() => Promise.reject(new Error('net down')));
    const c2 = createCopilotClient({ baseUrl: 'https://x', getToken: () => Promise.resolve('t'), fetchFn: boom });
    const r2 = await c2.execute(PLAN);
    expect(r2.ok).toBe(false);
  });
});
