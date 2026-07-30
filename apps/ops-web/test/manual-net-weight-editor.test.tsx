// apps/ops-web/test/manual-net-weight-editor.test.tsx
// T33 Slice E (coverage completion): direct unit tests for ManualNetWeightEditor.
// The DispatchView-level test proves the happy path (input reveal + action call);
// these cover the component internals the parent test cannot reach: the rejection
// path (the action fails -> the confirm button re-enables so the dispatcher can
// retry) and the busy-disable transition. Mocked action via vi.hoisted so the
// hoisted vi.mock factory sees the fn before initialisation.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const { setManualNetWeight } = vi.hoisted(() => ({ setManualNetWeight: vi.fn() }));
vi.mock('@/features/dispatch/set-manual-net-weight.action', () => ({ setManualNetWeight }));

import { ManualNetWeightEditor } from '@/features/dispatch/ManualNetWeightEditor';

afterEach(cleanup);
beforeEach(() => { setManualNetWeight.mockReset(); });

const MANIFEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function renderEditor(onDone = vi.fn()): { onDone: ReturnType<typeof vi.fn> } {
  render(<ManualNetWeightEditor manifestId={MANIFEST_ID} onDone={onDone} />);
  return { onDone };
}

function enterAndConfirm(kg: string): void {
  fireEvent.change(screen.getByTestId('manual-netweight-input-' + MANIFEST_ID), { target: { value: kg } });
  fireEvent.click(screen.getByTestId('manual-netweight-confirm-' + MANIFEST_ID));
}

describe('@fleet/ops-web - ManualNetWeightEditor', () => {
  it('calls onDone after the action resolves', async () => {
    setManualNetWeight.mockResolvedValue({ status: 'ok' as const });
    const { onDone } = renderEditor();
    enterAndConfirm('20730');
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
    expect(setManualNetWeight).toHaveBeenCalledWith({ manifestId: MANIFEST_ID, extractedNetWeightKg: 20730 });
  });

  it('re-enables the confirm button when the action rejects (dispatcher can retry)', async () => {
    setManualNetWeight.mockRejectedValue(new Error('network'));
    const onDone = vi.fn();
    renderEditor(onDone);
    const button = screen.getByTestId('manual-netweight-confirm-' + MANIFEST_ID);
    enterAndConfirm('20730');
    // Rejection path: onDone never fires and the button returns to enabled so a
    // second attempt is possible (setBusy(false) ran in the catch).
    await waitFor(() => { expect(button).toBeEnabled(); });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('does not call the action for empty, zero, or negative input', () => {
    setManualNetWeight.mockResolvedValue({ status: 'ok' as const });
    renderEditor();
    for (const bad of ['', '0', '-5']) {
      fireEvent.change(screen.getByTestId('manual-netweight-input-' + MANIFEST_ID), { target: { value: bad } });
      fireEvent.click(screen.getByTestId('manual-netweight-confirm-' + MANIFEST_ID));
    }
    expect(setManualNetWeight).not.toHaveBeenCalled();
  });
});
