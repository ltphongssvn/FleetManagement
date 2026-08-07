// apps/ops-web/src/features/admin/reference-sections.tsx
// Shared master-data CRUD sections, extracted from the old /admin/reference
// page so BOTH that page and the new Co so du lieu page render the SAME five
// sections (Khach hang / Ten hang / So xe / Kho nhan hang / Kho giao hang).
// Rendering goes through the shared DataTable (TanStack v8) for visual
// consistency with the Tai xe & xe table: bordered/searchable/paginated, with
// columns Ten (+ So dien thoai for customers) + Thao tac (Sua SDT inline; Xoa
// in the row action menu behind a confirm dialog).
// CRUD (add / inline rename / soft-delete / 409-conflict / refetch) is
// unchanged; delete routes through client.remove -> server soft-delete
// (active=false), retained for the Delete Item audit view, behind the
// RowActionMenu confirm dialog.
//
// 409 conflict: the rejected row is highlighted and scrolled into view via
// the DataTable rowAttrs seam -- the mark lands on the <tr> (row identity),
// not on a cell span, so the whole row reads as rejected.
//
// Selectors are semantic (getByRole rowheader/columnheader/menuitem/dialog,
// data-testid) so they survive markup changes (2026 resilient-selector).
'use client';
import { useEffect, useMemo, useState, type JSX } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ReferenceAdminClient,
  type ReferenceOption,
  type ReferenceSegment,
} from '@/features/admin/reference-admin-client';
import { DataTable, type DataTableRowAttrs } from '@/features/admin/DataTable';
import { RowActionMenu } from '@/features/admin/RowActionMenu';
import { useRefetchOnFocus } from '@/lib/use-refetch-on-focus';
import {
  isSessionExpired,
  navigateToSessionRefresh,
} from '@/features/auth/session-refresh-navigation';
export interface SectionDef {
  segment: ReferenceSegment;
  title: string;
  addLabel: string;
  role?: 'pickup' | 'delivery';
  scope?: 'admin';
}
export const SECTIONS: SectionDef[] = [
  { segment: 'customers', title: 'Khách hàng', addLabel: 'Thêm khách hàng' },
  { segment: 'cargo-types', title: 'Tên hàng', addLabel: 'Thêm tên hàng' },
  { segment: 'vehicles', title: 'Số xe', addLabel: 'Thêm số xe', scope: 'admin' },
  { segment: 'warehouses', title: 'Kho nhận hàng', addLabel: 'Thêm kho nhận hàng', role: 'pickup' },
  { segment: 'warehouses', title: 'Kho giao hàng', addLabel: 'Thêm kho giao hàng', role: 'delivery' },
];
function extractConflictName(msg: string): string | null {
  const m = /["“”]([^"“”]+)["“”]\\s*đã tồn tại/i.exec(msg);
  return m?.[1] ?? null;
}
function rowPhone(row: ReferenceOption): string {
  const p = row.meta?.['phone'];
  return typeof p === 'string' ? p : '';
}
function quote(s: string): string {
  return String.fromCharCode(34) + s + String.fromCharCode(34);
}
function getErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return fallback;
}
// One error seam per section: an idle-expired 401 hands the browser to the
// silent-refresh route instead of painting a dead-end banner; everything else
// keeps the friendly Vietnamese copy the client already composed.
function useFail(setError: (m: string) => void) {
  return (e: unknown, fallback: string): boolean => {
    if (isSessionExpired(e)) {
      navigateToSessionRefresh();
      return true;
    }
    setError(getErrorMessage(e, fallback));
    return false;
  };
}
export function ReferenceSection({ def }: { def: SectionDef }): JSX.Element {
  const client = new ReferenceAdminClient(def.segment);
  const isCustomers = def.segment === 'customers';
  const [rows, setRows] = useState<readonly ReferenceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflictName, setConflictName] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const fail = useFail(setError);
  const refresh = async (preserveError = false): Promise<void> => {
    setLoading(true);
    try {
      const all = await client.list(def.role, def.scope);
      setRows(all);
      if (!preserveError) {
        setError(null);
        setConflictName(null);
      }
    } catch (e) {
      if (fail(e, 'load failed')) return;
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);
  useRefetchOnFocus(() => { void refresh(); });
  const add = async (): Promise<void> => {
    if (newName.trim().length === 0) return;
    setBusy(true);
    try {
      const phoneArg = isCustomers ? (newPhone.trim() === '' ? '' : newPhone.trim()) : undefined;
      await client.create(newName.trim(), def.role, phoneArg);
      setNewName('');
      setNewPhone('');
      await refresh();
    } catch (e) {
      if (fail(e, 'create failed')) return;
      const msg = getErrorMessage(e, 'create failed');
      setConflictName(extractConflictName(msg) ?? newName.trim());
      await refresh(true);
    } finally {
      setBusy(false);
    }
  };
  const del = async (id: string): Promise<void> => {
    setBusy(true);
    try {
      await client.remove(id);
      await refresh();
    } catch (e) {
      if (fail(e, 'delete failed')) return;
      await refresh(true);
    } finally {
      setBusy(false);
    }
  };
  const startEdit = (id: string, phone: string): void => {
    setEditingId(id);
    setEditPhone(phone);
  };
  const saveEdit = async (id: string, label: string): Promise<void> => {
    setBusy(true);
    try {
      await client.update(id, label, editPhone.trim() === '' ? '' : editPhone.trim());
      setEditingId(null);
      setEditPhone('');
      await refresh();
    } catch (e) {
      if (fail(e, 'update failed')) return;
      await refresh(true);
    } finally {
      setBusy(false);
    }
  };
  const columns = useMemo<ColumnDef<ReferenceOption>[]>(() => {
    const cols: ColumnDef<ReferenceOption>[] = [];
    cols.push({
      id: 'name',
      header: 'Tên',
      accessorFn: (row) => row.label,
      cell: (ctx) => <span>{ctx.row.original.label}</span>,
    });
    if (isCustomers) {
      cols.push({
        id: 'phone',
        header: 'Số điện thoại',
        accessorFn: (row) => rowPhone(row),
        cell: (ctx) => {
          const row = ctx.row.original;
          const phone = rowPhone(row);
          if (editingId === row.id) {
            return (
              <input
                type='tel'
                value={editPhone}
                onChange={(e) => { setEditPhone(e.target.value); }}
                aria-label='Số điện thoại'
                className='w-40 rounded border px-2 py-1 text-sm'
              />
            );
          }
          return <span className='text-slate-500'>{phone}</span>;
        },
      });
    }
    cols.push({
      id: 'actions',
      header: 'Thao tác',
      enableGlobalFilter: false,
      cell: (ctx) => {
        const row = ctx.row.original;
        const phone = rowPhone(row);
        const isEditing = editingId === row.id;
          return (
            <span className='flex items-center gap-2'>
              {isCustomers && isEditing ? (
                <>
                  <button
                    type='button'
                    disabled={busy}
                    onClick={() => { void saveEdit(row.id, row.label); }}
                    className='rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700'
                  >
                    Lưu
                  </button>
                  <button
                    type='button'
                    disabled={busy}
                    onClick={() => { setEditingId(null); setEditPhone(''); }}
                    className='rounded border px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40'
                  >
                    Hủy
                  </button>
                </>
              ) : null}
              <RowActionMenu
                label={'Thao tác cho ' + row.label}
                actions={[
                  ...(isCustomers && !isEditing ? [{
                    key: 'edit-phone',
                    label: 'Sửa SĐT',
                    disabled: busy,
                    onSelect: () => { startEdit(row.id, phone); },
                  }] : []),
                  {
                    key: 'delete',
                    label: 'Xóa',
                    destructive: true,
                    disabled: busy,
                    confirmLabel: 'Xóa ' + quote(row.label) + ' ?',
                    onSelect: () => { void del(row.id); },
                  },
                ]}
              />
            </span>
          );
      },
    });
    return cols;
  }, [isCustomers, editingId, editPhone, busy]);
  const rowAttrs = (row: ReferenceOption): DataTableRowAttrs => {
    if (conflictName === null || row.label !== conflictName) return {};
    return {
      testId: 'reference-row-conflict',
      className: 'bg-yellow-50 ring-2 ring-amber-300',
      scrollIntoView: true,
    };
  };
  return (
    <section className='mb-8 rounded border bg-white p-4'>
      <h2 className='mb-3 text-lg font-semibold'>{def.title}</h2>
      {error !== null ? <div className='mb-2 text-sm text-red-600'>{error}</div> : null}
      <div className='mb-3 flex gap-2'>
        <input
          type='text'
          value={newName}
          onChange={(e) => { setNewName(e.target.value); }}
          placeholder={def.addLabel}
          className='w-72 rounded border px-2 py-1 text-sm'
        />
        {isCustomers ? (
          <input
            type='tel'
            value={newPhone}
            onChange={(e) => { setNewPhone(e.target.value); }}
            placeholder='Số điện thoại'
            aria-label='Số điện thoại mới'
            className='w-48 rounded border px-2 py-1 text-sm'
          />
        ) : null}
        <button
          type='button'
          disabled={busy}
          onClick={() => { void add(); }}
          className='rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700 disabled:bg-gray-400'
        >
          {def.addLabel}
        </button>
      </div>
      {loading ? (
        <div className='text-sm text-gray-500'>Đang tải…</div>
      ) : (
        <DataTable columns={columns} data={rows} caption={def.title} emptyLabel='Chưa có dữ liệu' rowAttrs={rowAttrs} />
      )}
    </section>
  );
}
