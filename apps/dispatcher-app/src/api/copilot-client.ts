// apps/dispatcher-app/src/api/copilot-client.ts
// Copilot HTTP client for the dispatcher app (T17 V10a). Trust boundary:
// every response body is UNTRUSTED and parsed via the shared helpers
// from @fleet/sync-protocol; malformed shapes, HTTP failures and thrown
// network errors all collapse into a typed { ok:false, errorVi } result
// the dialog machine can speak. fetch and token acquisition are injected
// (backing-service handle + credential stay outside the code); the plan
// is forwarded to /copilot/execute VERBATIM so planId remains the
// idempotency key end to end.
import {
  parseCopilotExecutionResult,
  parseCopilotPlanResponse,
  type CopilotExecutionResult,
  type CopilotPlan,
  type CopilotPlanResponse,
} from '@fleet/sync-protocol';
export type CopilotResult<T> =
  | { ok: true; value: T }
  | { ok: false; errorVi: string };
export interface CopilotClientDeps {
  baseUrl: string;
  getToken: () => Promise<string>;
  fetchFn: (url: string, init: RequestInit) => Promise<Response>;
}
export interface CopilotClient {
  plan: (text: string) => Promise<CopilotResult<CopilotPlanResponse>>;
  execute: (plan: CopilotPlan) => Promise<CopilotResult<CopilotExecutionResult>>;
}
const BAD_BODY_VI = 'Máy chủ trả về dữ liệu không hợp lệ.';
const NET_FAIL_VI = 'Không thể kết nối máy chủ. Vui lòng thử lại.';
export function createCopilotClient(deps: CopilotClientDeps): CopilotClient {
  const post = async <T>(
    path: string,
    body: unknown,
    parse: (input: unknown) => T | null,
  ): Promise<CopilotResult<T>> => {
    try {
      const token = await deps.getToken();
      const res = await deps.fetchFn(deps.baseUrl + path, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, errorVi: NET_FAIL_VI };
      const parsed = parse(await res.json());
      if (parsed === null) return { ok: false, errorVi: BAD_BODY_VI };
      return { ok: true, value: parsed };
    } catch {
      return { ok: false, errorVi: NET_FAIL_VI };
    }
  };
  return {
    plan: (text) => post('/copilot/plan', { text }, parseCopilotPlanResponse),
    execute: (plan) => post('/copilot/execute', plan, parseCopilotExecutionResult),
  };
}
