// apps/ops-web/src/features/copilot/command-palette.tsx
// Copilot command palette island (client). Ctrl+K opens a free-text prompt;
// text -> POST /api/copilot/plan (BFF) -> either a plan preview card with an
// explicit Xac nhan confirm (human-in-the-loop: nothing executes without it)
// or a clarify question with candidates. Confirm -> POST /api/copilot/execute
// with the EXACT previewed plan (planId = idempotency key). All non-ok
// responses flow through vnApiErrorMessage, so raw transport text is
// structurally unreachable. fetch is injectable for tests. No cmdk dep for
// v1: this palette is free-text -> plan, not fuzzy item filtering; cmdk
// itself documents that Ctrl+K listening is app code either way.
'use client';
import { useEffect, useState } from 'react';
import {
  parseCopilotExecutionResult,
  parseCopilotPlanResponse,
  type CopilotExecutionResult,
  type CopilotPlan,
  type CopilotPlanResponse,
} from '@fleet/sync-protocol';
import { vnApiErrorMessage, VN_OPS_GENERIC_ERROR } from '@/features/errors/present-problem';
import type { FetchFn } from '@/features/admin/reference-admin-client';

type Clarify = Extract<CopilotPlanResponse, { kind: 'clarify' }>;

export interface CommandPaletteProps {
  readonly fetchFn?: FetchFn;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return undefined;
  }
}

export function CommandPalette({ fetchFn }: CommandPaletteProps): React.JSX.Element | null {
  const doFetch: FetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<CopilotPlan | null>(null);
  const [clarify, setClarify] = useState<Clarify | null>(null);
  const [result, setResult] = useState<CopilotExecutionResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setText('');
        setPlan(null);
        setClarify(null);
        setResult(null);
        setMessage(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  async function requestPlan(): Promise<void> {
    setBusy(true);
    setPlan(null);
    setClarify(null);
    setResult(null);
    setMessage(null);
    try {
      const res = await doFetch('/api/copilot/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const body = await readJson(res);
      if (!res.ok) {
        setMessage(vnApiErrorMessage(res.status, body));
        return;
      }
      const parsed = parseCopilotPlanResponse(body);
      if (parsed === null) {
        setMessage(VN_OPS_GENERIC_ERROR);
        return;
      }
      if (parsed.kind === 'plan') setPlan(parsed.plan);
      else setClarify(parsed);
    } catch {
      setMessage(VN_OPS_GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function executePlan(current: CopilotPlan): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await doFetch('/api/copilot/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current),
      });
      const body = await readJson(res);
      if (!res.ok) {
        setMessage(vnApiErrorMessage(res.status, body));
        return;
      }
      const parsed = parseCopilotExecutionResult(body);
      if (parsed === null) {
        setMessage(VN_OPS_GENERIC_ERROR);
        return;
      }
      setPlan(null);
      setResult(parsed);
    } catch {
      setMessage(VN_OPS_GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div role='dialog' aria-label='Copilot' className='copilot-palette'>
      <form
        aria-label='copilot'
        onSubmit={(e): void => {
          e.preventDefault();
          void requestPlan();
        }}
      >
        <input
          placeholder='Nhập lệnh...'
          value={text}
          disabled={busy}
          onChange={(e): void => {
            setText(e.target.value);
          }}
        />
      </form>
      {message !== null ? <p>{message}</p> : null}
      {clarify !== null ? (
        <div>
          <p>{clarify.questionVi}</p>
          {(clarify.candidates ?? []).map((c) => (
            <p key={c.id}>{c.label}</p>
          ))}
        </div>
      ) : null}
      {plan !== null ? (
        <div>
          <p>{plan.summaryVi}</p>
          <button
            type='button'
            disabled={busy}
            onClick={(): void => {
              void executePlan(plan);
            }}
          >
            Xác nhận
          </button>
        </div>
      ) : null}
      {result !== null ? (
        <div>
          <p>{result.status === 'completed' ? 'Hoàn tất' : 'Không thể thực hiện. Vui lòng thử lại.'}</p>
          {result.results.map((r) => {
            const cred = r.generatedPassword;
            return typeof cred === 'string' ? (
              <p key={r.commandId}>Mật khẩu tạm: {cred}</p>
            ) : null;
          })}
        </div>
      ) : null}
    </div>
  );
}
