// apps/ops-web/src/features/admin/DevicesApprovalSection.tsx
// Devices approval queue (P7). An admin reviews devices that self-enrolled and
// hardware-attested (binding pending), vets the attestation evidence, then
// activates or revokes. This surface is the PRECONDITION for turning binding
// enforcement on: without it every pending device would be locked out with no
// remedy, so the guard stays dormant until this page is browser-verified.
//
// Composes the shared DataTable + StatusBadge; status codes become Vietnamese
// through the device-binding presenter (labels are presentation, codes are
// contract). NO raw UUID is rendered (house rule): deviceId is used only as a
// React key and testid, never as visible text -- an admin identifies a device by
// platform, status and attestation provenance. The client seam is injectable so
// tests drive it without global fetch; prod defaults to the validating
// AdminDevicesClient.
'use client';
import { useCallback, useEffect, useState, type JSX } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { AdminDeviceRow, DeviceBindingStatus } from '@fleet/sync-protocol';
import { DataTable } from '@/features/admin/DataTable';
import { StatusBadge } from '@/features/admin/StatusBadge';
import { presentDeviceBindingStatus } from '@/features/admin/device-binding.presenter';
import { AdminDevicesClient } from '@/features/admin/admin-devices-client';
import { vnExceptionMessage } from '@/features/errors/present-problem';
import {
  isSessionExpired,
  navigateToSessionRefresh,
} from '@/features/auth/session-refresh-navigation';

export interface DevicesApprovalClient {
  list: AdminDevicesClient['list'];
  activate: AdminDevicesClient['activate'];
  revoke: AdminDevicesClient['revoke'];
}

// Filter tabs mirror the binding lifecycle; pending is the review queue an
// admin lands on. Labels are immutable Vietnamese UI contract.
const FILTERS: readonly { status: DeviceBindingStatus; label: string }[] = [
  { status: 'pending', label: 'Chờ duyệt' },
  { status: 'active', label: 'Đã duyệt' },
  { status: 'revoked', label: 'Đã thu hồi' },
];

const PAGE_SIZE = 20;

function formatVerifiedAt(iso: string | null): string {
  if (iso === null) return 'Chưa xác thực';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Chưa xác thực' : d.toLocaleString('vi-VN');
}

export function DevicesApprovalSection(
  { client: injected }: { client?: DevicesApprovalClient } = {},
): JSX.Element {
  const [status, setStatus] = useState<DeviceBindingStatus>('pending');
  const [rows, setRows] = useState<readonly AdminDeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [client] = useState<DevicesApprovalClient>(() => injected ?? new AdminDevicesClient({}));

  const refresh = useCallback(async (next: DeviceBindingStatus): Promise<void> => {
    setLoading(true);
    try {
      const page = await client.list({ status: next, page: 1, pageSize: PAGE_SIZE });
      setRows(page.data);
      setError(null);
    } catch (e) {
      if (isSessionExpired(e)) {
        navigateToSessionRefresh();
        return;
      }
      setError(vnExceptionMessage(e, 'tải danh sách thiết bị thất bại'));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void refresh(status); }, [refresh, status]);

  const handleActivate = async (deviceId: string): Promise<void> => {
    setBusy(true);
    try {
      await client.activate(deviceId);
      await refresh(status);
    } catch (e) {
      setError(vnExceptionMessage(e, 'duyệt thiết bị thất bại'));
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (deviceId: string): Promise<void> => {
    // Reason is required for the audit trail; the row is never deleted.
    const reason = window.prompt('Lý do thu hồi thiết bị?', 'thiet bi bi mat');
    if (reason === null || reason.length === 0) return;
    setBusy(true);
    try {
      await client.revoke(deviceId, reason);
      await refresh(status);
    } catch (e) {
      setError(vnExceptionMessage(e, 'thu hồi thiết bị thất bại'));
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnDef<AdminDeviceRow>[] = [
    {
      id: 'platform',
      header: 'Nền tảng',
      accessorFn: (row) => row.platform,
    },
    {
      id: 'status',
      header: 'Trạng thái',
      accessorFn: (row) => row.bindingStatus,
      cell: (ctx) => {
        const p = presentDeviceBindingStatus(String(ctx.getValue()));
        return <StatusBadge label={p.label} tone={p.tone} />;
      },
    },
    {
      id: 'securityLevel',
      header: 'Mức bảo mật',
      accessorFn: (row) => row.attestationSecurityLevel ?? '—',
    },
    {
      id: 'environment',
      header: 'Môi trường',
      accessorFn: (row) => row.attestationEnvironment ?? '—',
    },
    {
      id: 'verifiedAt',
      header: 'Xác thực lúc',
      accessorFn: (row) => formatVerifiedAt(row.attestationVerifiedAt),
    },
    {
      id: 'actions',
      header: 'Thao tác',
      cell: (ctx) => {
        const row = ctx.row.original;
        return (
          <div className='flex gap-2'>
            {row.bindingStatus !== 'active' ? (
              <button
                type='button'
                disabled={busy}
                data-testid={'device-activate-' + row.deviceId}
                onClick={() => { void handleActivate(row.deviceId); }}
                className='rounded bg-emerald-600 px-3 py-1 text-sm text-white hover:bg-emerald-700 disabled:bg-gray-400'
              >
                Duyệt
              </button>
            ) : null}
            {row.bindingStatus !== 'revoked' ? (
              <button
                type='button'
                disabled={busy}
                data-testid={'device-revoke-' + row.deviceId}
                onClick={() => { void handleRevoke(row.deviceId); }}
                className='rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700 disabled:bg-gray-400'
              >
                Thu hồi
              </button>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <section aria-label='Duyệt thiết bị' className='space-y-4'>
      <h3 className='text-lg font-semibold'>Duyệt thiết bị</h3>
      <div className='flex gap-2'>
        {FILTERS.map((f) => (
          <button
            key={f.status}
            type='button'
            data-testid={'device-filter-' + f.status}
            onClick={() => { setStatus(f.status); }}
            className={
              f.status === status
                ? 'rounded-md bg-indigo-600 px-3 py-1 text-sm text-white'
                : 'rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50'
            }
          >
            {f.label}
          </button>
        ))}
      </div>
      {error !== null ? (
        <div data-testid='devices-section-error' className='text-red-600'>Lỗi: {error}</div>
      ) : null}
      {loading ? (
        <div data-testid='devices-section-loading' className='py-4 text-sm text-slate-500'>Đang tải…</div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          searchPlaceholder='Tìm thiết bị'
          emptyLabel='Không có thiết bị'
          pageSize={10}
          rowAttrs={(row) => ({ testId: 'device-row-' + row.deviceId })}
        />
      )}
    </section>
  );
}
