// apps/ops-web/src/features/copilot/command-palette.tsx
// Copilot command palette island (client). Ctrl+K opens a centered modal
// dialog (dimmed backdrop, prominent 680px panel) with a large free-text
// prompt; text -> POST /api/copilot/plan (BFF) -> plan preview card with an
// explicit Xac nhan confirm (human-in-the-loop: nothing executes without it)
// or a clarify question with candidates. Confirm -> POST /api/copilot/execute
// with the EXACT previewed plan (planId = idempotency key). A permanent
// footer documents every supported syntax so dispatchers never guess. All
// non-ok responses flow through vnApiErrorMessage; raw transport text is
// structurally unreachable. fetch is injectable for tests.
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
import { navigateToSessionRefresh } from '@/features/auth/session-refresh-navigation';

type Clarify = Extract<CopilotPlanResponse, { kind: 'clarify' }>;

export interface CommandPaletteProps {
  // Server-provided (root layout reads the session/refresh cookie). Renders
  // the SAME tree on server and client -> no hydration mismatch. When false
  // (e.g. the /login page) Ctrl+K is inert and nothing mounts.
  readonly authed?: boolean;
  readonly fetchFn?: FetchFn;
}

const OVERLAY_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.55)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: '12vh',
  zIndex: 1000,
};

const PANEL_STYLE: React.CSSProperties = {
  width: 'min(680px, 92vw)',
  maxHeight: '76vh',
  overflowY: 'auto',
  background: '#ffffff',
  color: '#0f172a',
  borderRadius: 12,
  boxShadow: '0 24px 60px rgba(0, 0, 0, 0.35)',
  padding: '20px 22px',
};

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontSize: 18,
  lineHeight: 1.4,
  padding: '12px 14px',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  outline: 'none',
};

const CONFIRM_STYLE: React.CSSProperties = {
  marginTop: 10,
  fontSize: 16,
  padding: '10px 18px',
  borderRadius: 8,
  border: '1px solid #1d4ed8',
  background: '#2563eb',
  color: '#ffffff',
  cursor: 'pointer',
};

const FOOTER_STYLE: React.CSSProperties = {
  marginTop: 18,
  paddingTop: 12,
  borderTop: '1px solid #e2e8f0',
  fontSize: 13,
  color: '#475569',
};

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return undefined;
  }
}

export function CommandPalette({
  authed = true,
  fetchFn,
}: CommandPaletteProps): React.JSX.Element | null {
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
        if (!authed) return;
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
  }, [authed]);

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
      if (res.status === 401) {
        // Session dead (forwarder exhausted mint-on-miss): an in-place
        // message would strand the dispatcher -- every next action 401s.
        navigateToSessionRefresh();
        return;
      }
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
      if (res.status === 401) {
        navigateToSessionRefresh();
        return;
      }
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

  function closeAll(): void {
    setOpen(false);
    setText('');
    setPlan(null);
    setClarify(null);
    setResult(null);
    setMessage(null);
  }

  if (!authed) return null;
  if (!open) return null;
  return (
    <div style={OVERLAY_STYLE} onClick={closeAll} data-testid="copilot-overlay">
      <div
        role="dialog"
        aria-label="Copilot"
        aria-modal="true"
        className="copilot-palette"
        style={PANEL_STYLE}
        onClick={(e): void => {
          e.stopPropagation();
        }}
      >
        <h2 style={{ margin: '0 0 10px', fontSize: 17 }}>Trợ lý điều phối (Ctrl+K)</h2>
        <form
          aria-label="copilot"
          onSubmit={(e): void => {
            e.preventDefault();
            void requestPlan();
          }}
        >
          <input
            placeholder="Nhập lệnh..."
            value={text}
            disabled={busy}
            autoFocus
            style={INPUT_STYLE}
            onChange={(e): void => {
              setText(e.target.value);
            }}
          />
        </form>
        {message !== null ? <p style={{ color: '#b91c1c' }}>{message}</p> : null}
        {clarify !== null ? (
          <div>
            <p style={{ fontSize: 16 }}>{clarify.questionVi}</p>
            {(clarify.candidates ?? []).map((c) => (
              <p key={c.id} style={{ margin: '4px 0' }}>
                {c.label}
              </p>
            ))}
          </div>
        ) : null}
        {plan !== null ? (
          <div>
            <p style={{ fontSize: 16, fontWeight: 600 }}>{plan.summaryVi}</p>
            <button
              type="button"
              disabled={busy}
              style={CONFIRM_STYLE}
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
            <p style={{ fontSize: 16, fontWeight: 600 }}>
              {result.status === 'completed'
                ? 'Hoàn tất'
                : 'Không thể thực hiện. Vui lòng thử lại.'}
            </p>
            {result.results.map((r) => {
              const cred = r.generatedPassword;
              return typeof cred === 'string' ? (
                <p key={r.commandId}>Mật khẩu tạm: {cred}</p>
              ) : null;
            })}
          </div>
        ) : null}
        <div style={FOOTER_STYLE}>
          <p style={{ margin: '0 0 6px', fontWeight: 600 }}>Cú pháp hỗ trợ:</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>{'Thêm tên hàng <tên hàng>'}</li>
            <li>{'Thêm khách hàng <tên khách hàng>'}</li>
            <li>{'Thêm tài xế <họ tên> <SĐT> và gán vào xe <biển số> (sắp ra mắt)'}</li>
          </ul>
          <p style={{ margin: '8px 0 0' }}>Enter: xem trước - Xác nhận: thực hiện - Esc: đóng</p>
        </div>
      </div>
    </div>
  );
}
