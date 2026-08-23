// apps/ops-web/test/row-action-menu.test.tsx
// E1 (RED-first): RowActionMenu is a 44px overflow (kebab) trigger that opens
// a Headless-UI Menu of row actions. Destructive actions (destructive: true)
// route through a confirm dialog before firing; non-destructive actions fire
// directly. This separates rare/dangerous actions from the frequent inline
// ones per the 2026 dense-admin action-separation pattern. Semantic queries
// (getByRole button/menuitem/dialog) so the markup can restyle freely.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RowActionMenu } from '@/features/admin/RowActionMenu';
afterEach(() => {
  cleanup();
});
describe('RowActionMenu', () => {
  it('renders an accessible 44px trigger button', () => {
    render(<RowActionMenu label={'Thao tác cho Acme'} actions={[]} />);
    const trigger = screen.getByRole('button', { name: 'Thao tác cho Acme' });
    expect(trigger).toBeInTheDocument();
    expect(trigger.className).toContain('min-h-11');
  });
  it('opens the menu and lists the actions', async () => {
    const user = userEvent.setup();
    render(
      <RowActionMenu
        label={'Thao tác cho Acme'}
        actions={[{ key: 'del', label: 'Xóa', onSelect: vi.fn(), destructive: true }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Thao tác cho Acme' }));
    expect(await screen.findByRole('menuitem', { name: 'Xóa' })).toBeInTheDocument();
  });
  it('fires a non-destructive action directly on select', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <RowActionMenu
        label={'Thao tác cho Acme'}
        actions={[{ key: 'edit', label: 'Sửa SĐT', onSelect }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Thao tác cho Acme' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sửa SĐT' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
  it('routes a destructive action through a confirm dialog', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <RowActionMenu
        label={'Thao tác cho Acme'}
        actions={[
          { key: 'del', label: 'Xóa', onSelect, destructive: true, confirmLabel: 'Xóa Acme?' },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Thao tác cho Acme' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Xóa' }));
    // Dialog appears; action has NOT fired yet.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Xóa Acme?');
    expect(onSelect).not.toHaveBeenCalled();
    // Confirm fires it.
    await user.click(within_dialog_confirm());
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
  it('cancelling the confirm dialog does not fire the action', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <RowActionMenu
        label={'Thao tác cho Acme'}
        actions={[
          { key: 'del', label: 'Xóa', onSelect, destructive: true, confirmLabel: 'Xóa Acme?' },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Thao tác cho Acme' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Xóa' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('closes the confirm dialog on Escape without firing the action', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <RowActionMenu
        label={'Thao tác cho Acme'}
        actions={[
          { key: 'del', label: 'Xóa', onSelect, destructive: true, confirmLabel: 'Xóa Acme?' },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Thao tác cho Acme' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Xóa' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

function within_dialog_confirm(): HTMLElement {
  const dialog = screen.getByRole('dialog');
  const btn = dialog.querySelector('[data-testid=confirm-accept]');
  if (btn === null) throw new Error('no confirm-accept button');
  return btn as HTMLElement;
}
