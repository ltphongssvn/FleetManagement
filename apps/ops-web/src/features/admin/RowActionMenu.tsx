// apps/ops-web/src/features/admin/RowActionMenu.tsx
// E1: per-row overflow (kebab) action menu for the Co so du lieu tables.
// A single 44px trigger opens a Headless-UI Menu; rare/destructive actions
// live here instead of as always-visible buttons, separating them from the
// frequent inline actions (2026 dense-admin action-separation pattern).
// Destructive actions route through an accessible confirm Dialog before
// firing; non-destructive fire directly. House Headless-UI + Tailwind, no
// shadcn (mirrors ComboboxField). VN copy (Huy / Xoa) is a UI contract.
'use client';
import { useState, type JSX } from 'react';
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Dialog,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react';
export interface RowAction {
  readonly key: string;
  readonly label: string;
  readonly onSelect: () => void;
  readonly destructive?: boolean;
  readonly confirmLabel?: string;
  readonly disabled?: boolean;
}
export function RowActionMenu({
  label,
  actions,
}: {
  label: string;
  actions: readonly RowAction[];
}): JSX.Element {
  const [pending, setPending] = useState<RowAction | null>(null);
  const choose = (a: RowAction): void => {
    if (a.destructive === true) {
      setPending(a);
      return;
    }
    a.onSelect();
  };
  const confirm = (): void => {
    const a = pending;
    setPending(null);
    if (a !== null) a.onSelect();
  };
  return (
    <>
      <Menu>
        <MenuButton
          aria-label={label}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <span aria-hidden="true" className="text-xl leading-none">
            ⋯
          </span>
        </MenuButton>
        <MenuItems
          anchor="bottom end"
          className="z-50 mt-1 min-w-40 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg ring-1 ring-black/5 focus:outline-none [--anchor-gap:4px]"
        >
          {actions.map((a) => (
            <MenuItem key={a.key}>
              <button
                type="button"
                disabled={a.disabled === true}
                onClick={() => {
                  choose(a);
                }}
                className={
                  (a.destructive === true
                    ? 'text-red-600 data-[focus]:bg-red-600 data-[focus]:text-white'
                    : 'text-slate-900 data-[focus]:bg-indigo-600 data-[focus]:text-white') +
                  ' block w-full min-h-11 px-3 py-2 text-left disabled:opacity-40'
                }
              >
                {a.label}
              </button>
            </MenuItem>
          ))}
        </MenuItems>
      </Menu>
      <Dialog
        open={pending !== null}
        onClose={() => {
          setPending(null);
        }}
        className="relative z-50"
      >
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <DialogTitle className="text-base font-semibold text-slate-900">
              {pending?.confirmLabel ?? pending?.label ?? ''}
            </DialogTitle>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPending(null);
                }}
                className="min-h-11 rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                Hủy
              </button>
              <button
                type="button"
                data-testid="confirm-accept"
                onClick={confirm}
                className="min-h-11 rounded-md bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                {pending?.label ?? ''}
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
