// apps/ops-web/src/features/admin/reference-sections.tsx
// Shared master-data CRUD sections, extracted from the old /admin/reference
// page so BOTH that page and the new Co so du lieu page render the SAME five
// sections (Khach hang / Ten hang / So xe / Kho nhan hang / Kho giao hang)
// with add + inline rename (customer phone) + soft-delete, with no code
// duplication. Delete routes through client.remove -> server soft-delete
// (active=false); the row is retained for the Delete Item audit view.
//
// ROW LABEL DOM CONTRACT (regression fix): the customer NAME is the outer
// label-span own text and the phone a sibling <small> -- NOT a nested <span>.
// E2E specs read a row name via 'li span'.first(); keep the name the
// unambiguous first text node.
//
// 409 conflict: on a failed write (most commonly 'đã tồn tại') the section
// refreshes so the rejected item is visible, highlights the conflicting row
// (amber ring + testid) and scrolls it into view.
'use client';
import { useEffect, useRef, useState, type JSX } from 'react';
import {
  ReferenceAdminClient,
  type ReferenceOption,
  type ReferenceSegment,
} from '@/features/admin/reference-admin-client';
import { useRefetchOnFocus } from '@/lib/use-refetch-on-focus';
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
  const m = /["“”]([^"“”]+)["“”]\s*đã tồn tại/i.exec(msg);
  return m?.[1] ?? null;
}
function rowPhone(row: ReferenceOption): string {
  const p = row.meta?.['phone'];
  return typeof p === 'string' ? p : '';
}
function quote(s: string): string {
  return String.fromCharCode(34) + s + String.fromCharCode(34);
}
// 2026 standard: centralize catch-narrowing in one getErrorMessage helper
// (useUnknownInCatchVariables types catch vars as unknown). Handles Error,
// string, and a fallback -- so the four write handlers stay branch-free and
// the narrowing has a single coverage point.
function getErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return fallback;
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
  const conflictRowRef = useRef<HTMLLIElement | null>(null);
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
      setError(getErrorMessage(e, 'load failed'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);
  useRefetchOnFocus(() => { void refresh(); });
  useEffect(() => {
    if (conflictName !== null && conflictRowRef.current !== null) {
      const el = conflictRowRef.current;
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [conflictName, rows]);
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
      const msg = getErrorMessage(e, 'create failed');
      setError(msg);
      setConflictName(extractConflictName(msg) ?? newName.trim());
      await refresh(true);
    } finally {
      setBusy(false);
    }
  };
  const del = async (id: string, label: string): Promise<void> => {
    if (!window.confirm('Xóa ' + quote(label) + '?')) return;
    setBusy(true);
    try {
      await client.remove(id);
      await refresh();
    } catch (e) {
      setError(getErrorMessage(e, 'delete failed'));
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
      setError(getErrorMessage(e, 'update failed'));
      await refresh(true);
    } finally {
      setBusy(false);
    }
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
            aria-label='Số điện thoại'
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
        <ul className='divide-y'>
          {rows.length === 0 ? (
            <li className='py-2 text-sm text-gray-400'>Chưa có dữ liệu</li>
          ) : null}
          {rows.map((row) => {
            const isConflict = conflictName !== null && row.label === conflictName;
            const phone = rowPhone(row);
            const isEditing = editingId === row.id;
            const showPhoneText = isCustomers && !isEditing && phone !== '';
            const showPhoneEdit = isCustomers && isEditing;
            return (
              <li
                key={row.id}
                ref={isConflict ? conflictRowRef : null}
                data-testid={isConflict ? 'reference-row-conflict' : undefined}
                className={
                  'flex items-center justify-between py-2'
                  + (isConflict ? ' bg-yellow-50 ring-2 ring-amber-300 rounded px-2' : '')
                }
              >
                <div className='flex items-center gap-3 text-sm'>
                  <span>{row.label}</span>
                  {showPhoneText ? <small className='text-gray-500'>{phone}</small> : null}
                  {showPhoneEdit ? (
                    <input
                      type='tel'
                      value={editPhone}
                      onChange={(e) => { setEditPhone(e.target.value); }}
                      aria-label='Số điện thoại'
                      className='w-44 rounded border px-2 py-1 text-sm'
                    />
                  ) : null}
                </div>
                <span className='flex gap-2'>
                  {isCustomers && !isEditing ? (
                    <button
                      type='button'
                      disabled={busy}
                      onClick={() => { startEdit(row.id, phone); }}
                      className='rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600'
                    >
                      Sửa SĐT
                    </button>
                  ) : null}
                  {showPhoneEdit ? (
                    <button
                      type='button'
                      disabled={busy}
                      onClick={() => { void saveEdit(row.id, row.label); }}
                      className='rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700'
                    >
                      Lưu
                    </button>
                  ) : null}
                  <button
                    type='button'
                    disabled={busy}
                    onClick={() => { void del(row.id, row.label); }}
                    className='rounded bg-red-500 px-3 py-1 text-sm text-white hover:bg-red-600'
                  >
                    Xóa
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
