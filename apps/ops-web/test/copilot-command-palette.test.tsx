// apps/ops-web/test/copilot-command-palette.test.tsx
// RED-first RTL spec for the Copilot command palette island: Ctrl+K opens,
// free text -> POST /api/copilot/plan -> Vietnamese preview card (plan) or
// clarify question; Xac nhan -> POST /api/copilot/execute -> per-command
// results incl. one-time password; !res.ok flows through vnApiErrorMessage
// (raw transport text structurally unreachable). fetch is injectable.
import { randomBytes } from 'node:crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '../src/features/copilot/command-palette';

const PLAN = {
  planId: 'a3bb189e-8bf9-4888-9912-ace4e6543002',
  summaryVi: 'Sẽ tạo tên hàng Gạo',
  commands: [
    {
      type: 'create_cargo_type',
      commandId: 'b4cc290f-9c0a-4999-aa23-bdf5f7654113',
      name: 'Gạo',
    },
  ],
};

const GENERATED_CRED = 'tmp-' + randomBytes(6).toString('hex');

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function openPalette(): void {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
}

describe('CommandPalette', () => {
  it('stays hidden until Ctrl+K, then shows the input', () => {
    render(<CommandPalette fetchFn={vi.fn()} />);
    expect(screen.queryByPlaceholderText('Nhập lệnh...')).not.toBeInTheDocument();
    openPalette();
    expect(screen.getByPlaceholderText('Nhập lệnh...')).toBeInTheDocument();
  });

  it('submits text to /api/copilot/plan and renders the preview card', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({ kind: 'plan', plan: PLAN })));
    render(<CommandPalette fetchFn={fetchFn as never} />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText('Nhập lệnh...'), {
      target: { value: 'Thêm tên hàng Gạo' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'copilot' }));
    await waitFor(() => {
      expect(screen.getByText('Sẽ tạo tên hàng Gạo')).toBeInTheDocument();
    });
    const call = fetchFn.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(call[0]).toBe('/api/copilot/plan');
    expect(JSON.parse(call[1].body)).toEqual({ text: 'Thêm tên hàng Gạo' });
    expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeInTheDocument();
  });

  it('renders a clarify question without a confirm button', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(jsonRes({ kind: 'clarify', questionVi: 'Xe nào?' })),
    );
    render(<CommandPalette fetchFn={fetchFn as never} />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText('Nhập lệnh...'), {
      target: { value: 'gán tài xế' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'copilot' }));
    await waitFor(() => {
      expect(screen.getByText('Xe nào?')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Xác nhận' })).not.toBeInTheDocument();
  });

  it('executes on Xác nhận and shows the one-time password result', async () => {
    const result = {
      planId: PLAN.planId,
      status: 'completed',
      results: [
        {
          commandId: PLAN.commands[0]?.commandId,
          outcome: 'ok',
          generatedPassword: GENERATED_CRED,
        },
      ],
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ kind: 'plan', plan: PLAN }))
      .mockResolvedValueOnce(jsonRes(result));
    render(<CommandPalette fetchFn={fetchFn as never} />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText('Nhập lệnh...'), {
      target: { value: 'Thêm tên hàng Gạo' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'copilot' }));
    await waitFor(() => screen.getByRole('button', { name: 'Xác nhận' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => {
      expect(screen.getByText('Hoàn tất')).toBeInTheDocument();
    });
    const execCall = fetchFn.mock.calls[1] as unknown as [string, { body: string }];
    expect(execCall[0]).toBe('/api/copilot/execute');
    expect(JSON.parse(execCall[1].body)).toEqual(PLAN);
    expect(screen.getByText('Mật khẩu tạm: ' + GENERATED_CRED)).toBeInTheDocument();
  });

  it('presents non-ok responses as friendly Vietnamese, never raw transport text', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({ anything: true }, 500)));
    render(<CommandPalette fetchFn={fetchFn as never} />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText('Nhập lệnh...'), {
      target: { value: 'Thêm tên hàng Gạo' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'copilot' }));
    await waitFor(() => {
      expect(
        screen.getByText('Hệ thống đang gặp sự cố. Vui lòng thử lại sau.'),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/HTTP 500/)).not.toBeInTheDocument();
  });

  it('shows the generic message when the plan response is unparseable', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonRes({ kind: 'nonsense' })));
    render(<CommandPalette fetchFn={fetchFn as never} />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText('Nhập lệnh...'), {
      target: { value: 'x' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'copilot' }));
    await waitFor(() => {
      expect(screen.getByText('Đã xảy ra lỗi. Vui lòng thử lại.')).toBeInTheDocument();
    });
  });

  it('shows the generic message when the plan fetch rejects', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error('offline')));
    render(<CommandPalette fetchFn={fetchFn as never} />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText('Nhập lệnh...'), {
      target: { value: 'x' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'copilot' }));
    await waitFor(() => {
      expect(screen.getByText('Đã xảy ra lỗi. Vui lòng thử lại.')).toBeInTheDocument();
    });
  });

  it('renders clarify candidates as labels', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        jsonRes({
          kind: 'clarify',
          questionVi: 'Chọn tài xế nào?',
          candidates: [
            { idSpace: 'driverId', id: PLAN.planId, label: 'Nguyễn Văn A — 0900000123' },
          ],
        }),
      ),
    );
    render(<CommandPalette fetchFn={fetchFn as never} />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText('Nhập lệnh...'), {
      target: { value: 'gán' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'copilot' }));
    await waitFor(() => {
      expect(screen.getByText('Nguyễn Văn A — 0900000123')).toBeInTheDocument();
    });
  });

  it('presents execute non-ok via the presenter and keeps the plan confirmable', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ kind: 'plan', plan: PLAN }))
      .mockResolvedValueOnce(
        jsonRes(
          {
            type: 'about:blank',
            title: 'Bad Request',
            status: 400,
            detail: 'invalid',
            code: 'VALIDATION_FAILED',
          },
          400,
        ),
      );
    render(<CommandPalette fetchFn={fetchFn as never} />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText('Nhập lệnh...'), {
      target: { value: 'Thêm tên hàng Gạo' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'copilot' }));
    await waitFor(() => screen.getByRole('button', { name: 'Xác nhận' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => {
      expect(
        screen.getByText('Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại các trường đã nhập.'),
      ).toBeInTheDocument();
    });
  });

  it('shows the generic message when the execute response is unparseable', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ kind: 'plan', plan: PLAN }))
      .mockResolvedValueOnce(jsonRes({ nonsense: true }));
    render(<CommandPalette fetchFn={fetchFn as never} />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText('Nhập lệnh...'), {
      target: { value: 'Thêm tên hàng Gạo' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'copilot' }));
    await waitFor(() => screen.getByRole('button', { name: 'Xác nhận' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => {
      expect(screen.getByText('Đã xảy ra lỗi. Vui lòng thử lại.')).toBeInTheDocument();
    });
  });

  it('shows the generic message when the execute fetch rejects', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ kind: 'plan', plan: PLAN }))
      .mockRejectedValueOnce(new Error('offline'));
    render(<CommandPalette fetchFn={fetchFn as never} />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText('Nhập lệnh...'), {
      target: { value: 'Thêm tên hàng Gạo' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'copilot' }));
    await waitFor(() => screen.getByRole('button', { name: 'Xác nhận' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => {
      expect(screen.getByText('Đã xảy ra lỗi. Vui lòng thử lại.')).toBeInTheDocument();
    });
  });

  it('renders the failed status copy when execution fails midway', async () => {
    const failed = {
      planId: PLAN.planId,
      status: 'failed',
      results: [{ commandId: PLAN.commands[0]?.commandId, outcome: 'failed', errorCode: 'INTERNAL' }],
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ kind: 'plan', plan: PLAN }))
      .mockResolvedValueOnce(jsonRes(failed));
    render(<CommandPalette fetchFn={fetchFn as never} />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText('Nhập lệnh...'), {
      target: { value: 'Thêm tên hàng Gạo' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'copilot' }));
    await waitFor(() => screen.getByRole('button', { name: 'Xác nhận' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => {
      expect(screen.getByText('Không thể thực hiện. Vui lòng thử lại.')).toBeInTheDocument();
    });
  });

  it('is completely inert when authed is false (no palette on /login)', () => {
    render(<CommandPalette authed={false} fetchFn={vi.fn()} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByPlaceholderText('Nhập lệnh...')).not.toBeInTheDocument();
    expect(screen.queryByText('Cú pháp hỗ trợ:')).not.toBeInTheDocument();
  });

  it('always shows the syntax guidance footer while open', () => {
    render(<CommandPalette fetchFn={vi.fn()} />);
    openPalette();
    expect(screen.getByText('Cú pháp hỗ trợ:')).toBeInTheDocument();
    expect(screen.getByText('Thêm tên hàng <tên hàng>')).toBeInTheDocument();
    expect(screen.getByText('Thêm khách hàng <tên khách hàng>')).toBeInTheDocument();
    expect(screen.getByText(/Esc: đóng/)).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<CommandPalette fetchFn={vi.fn()} />);
    openPalette();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Nhập lệnh...')).not.toBeInTheDocument();
  });
});
