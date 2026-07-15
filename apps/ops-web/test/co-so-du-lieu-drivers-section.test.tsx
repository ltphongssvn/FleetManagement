// apps/ops-web/test/co-so-du-lieu-drivers-section.test.tsx
// RED-first for the drivers section of the Co so du lieu page: loads
// AdminDriverRow[] via AdminDriversClient.list() and renders them through the
// generic DataTable with driverColumns. Three states: loading, error, loaded.
// The client is injected so the test mocks list() without touching global
// fetch (same seam admin-drivers-client exposes via fetchFn/config). Vietnamese
// loading + error strings are immutable UI contracts.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { AdminDriverRow } from '@fleet/sync-protocol';
import { DriversSection } from '@/features/admin/DriversSection';

const row = (over: Partial<AdminDriverRow>): AdminDriverRow => ({
  driverId: 'dr1',
  fullName: 'LE VAN CHAU',
  phone: '0900000001',
  operatorId: null,
  assignedVehicle: null,
  assignmentId: null,
  devices: [],
  ...over,
});

interface FakeClient {
  list: () => Promise<readonly AdminDriverRow[]>;
}

describe('DriversSection', () => {
  it('renders the driver rows once loaded', async () => {
    const client: FakeClient = { list: vi.fn().mockResolvedValue([row({})]) };
    render(<DriversSection client={client} />);
    expect(await screen.findByText('LE VAN CHAU')).toBeInTheDocument();
    expect(screen.getByText('0900000001')).toBeInTheDocument();
  });

  it('shows the loading state before rows arrive', () => {
    let resolve: (rows: readonly AdminDriverRow[]) => void = () => undefined;
    const pending = new Promise<readonly AdminDriverRow[]>((r) => { resolve = r; });
    const client: FakeClient = { list: vi.fn().mockReturnValue(pending) };
    render(<DriversSection client={client} />);
    expect(screen.getByTestId('drivers-section-loading')).toBeInTheDocument();
    resolve([]);
  });

  it('shows an error state when the load fails', async () => {
    const client: FakeClient = { list: vi.fn().mockRejectedValue(new Error('boom')) };
    render(<DriversSection client={client} />);
    await waitFor(() => {
      expect(screen.getByTestId('drivers-section-error')).toBeInTheDocument();
    });
  });

  it('falls back to a real AdminDriversClient when none is injected', async () => {
    // No client prop -> makeDefaultClient() constructs a real AdminDriversClient
    // whose list() hits global fetch; stub fetch so the component still reaches a
    // terminal state, exercising the default-client fallback branch + function.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([row({ fullName: 'DEFAULT CLIENT DRIVER' })]),
    });
    globalThis.fetch = fetchMock as never;
    render(<DriversSection />);
    expect(await screen.findByText('DEFAULT CLIENT DRIVER')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('ignores a late resolve after unmount (active guard false branch)', async () => {
    // Unmount BEFORE list() resolves so the .then callback runs with active =
    // false, exercising the unmount-race guard. No state update on an unmounted
    // component; the resolved rows are simply dropped.
    let resolve: (rows: readonly AdminDriverRow[]) => void = () => undefined;
    const pending = new Promise<readonly AdminDriverRow[]>((r) => { resolve = r; });
    const client: FakeClient = { list: vi.fn().mockReturnValue(pending) };
    const { unmount } = render(<DriversSection client={client} />);
    expect(screen.getByTestId('drivers-section-loading')).toBeInTheDocument();
    unmount();
    resolve([row({ fullName: 'LATE DRIVER' })]);
    await pending;
    expect(screen.queryByText('LATE DRIVER')).not.toBeInTheDocument();
  });

  it('ignores a late reject after unmount (catch active guard false branch)', async () => {
    // Symmetric to the resolve case: unmount BEFORE list() rejects so the .catch
    // callback runs with active = false -- no error state set on an unmounted
    // component. The rejection is caught here so it is not an unhandled rejection.
    let reject: (e: Error) => void = () => undefined;
    const pending = new Promise<readonly AdminDriverRow[]>((_, r) => { reject = r; });
    const guarded = pending.catch(() => [] as readonly AdminDriverRow[]);
    const client: FakeClient = { list: vi.fn().mockReturnValue(pending) };
    const { unmount } = render(<DriversSection client={client} />);
    expect(screen.getByTestId('drivers-section-loading')).toBeInTheDocument();
    unmount();
    reject(new Error('late boom'));
    await guarded;
    expect(screen.queryByTestId('drivers-section-error')).not.toBeInTheDocument();
  });
});
