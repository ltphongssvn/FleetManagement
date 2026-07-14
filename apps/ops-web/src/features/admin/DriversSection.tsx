// apps/ops-web/src/features/admin/DriversSection.tsx
// Drivers section of the Co so du lieu page. Loads AdminDriverRow[] via
// AdminDriversClient.list() (the same client + endpoint the standalone
// /admin/drivers page uses) and renders them through the generic DataTable
// with driverColumns -- so the whole vertical (SSOT -> classifier -> presenter
// -> StatusBadge -> columns -> table) is mounted as one section. The client is
// injectable (DriversDataClient) so tests mock list() without touching global
// fetch; production defaults to a real AdminDriversClient hitting the BFF.
// Three render states with immutable Vietnamese copy: loading, error, loaded.
'use client';
import { useEffect, useState, type JSX } from 'react';
import type { AdminDriverRow } from '@fleet/sync-protocol';
import { AdminDriversClient } from '@/features/admin/admin-drivers-client';
import { DataTable } from '@/features/admin/DataTable';
import { driverColumns } from '@/features/admin/co-so-du-lieu-driver-columns';

// Minimal surface the section needs -- just the list read. AdminDriversClient
// satisfies this structurally, and tests pass a fake with the same shape.
export interface DriversDataClient {
  list: () => Promise<readonly AdminDriverRow[]>;
}

function makeDefaultClient(): DriversDataClient {
  return new AdminDriversClient({ apiUrl: '', bearerToken: () => '' });
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'loaded'; readonly rows: readonly AdminDriverRow[] };

export interface DriversSectionProps {
  readonly client?: DriversDataClient;
}

export function DriversSection({ client }: DriversSectionProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    const dataClient = client ?? makeDefaultClient();
    let active = true;
    dataClient
      .list()
      .then((rows) => {
        if (active) setState({ kind: 'loaded', rows });
      })
      .catch(() => {
        if (active) setState({ kind: 'error' });
      });
    return () => {
      active = false;
    };
  }, [client]);

  if (state.kind === 'loading') {
    return (
      <div data-testid='drivers-section-loading' className='p-4 text-sm text-slate-500'>
        Đang tải dữ liệu...
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div data-testid='drivers-section-error' className='p-4 text-sm text-red-600'>
        Không tải được danh sách tài xế.
      </div>
    );
  }
  return <DataTable columns={driverColumns} data={state.rows} />;
}
