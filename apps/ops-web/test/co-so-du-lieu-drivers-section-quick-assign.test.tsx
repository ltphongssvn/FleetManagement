// apps/ops-web/test/co-so-du-lieu-drivers-section-quick-assign.test.tsx
// RED-first: wire the Phan cong nhanh modal into DriversSection (pain point #1).
//
// An UNASSIGNED driver row shows a Phan cong nhanh action; clicking it opens the
// QuickAssignModal loaded with available vehicles (plate-labeled, uuid-valued);
// confirming calls the client assign({driverId, vehicleId}) and refreshes the
// list. An ASSIGNED row shows no quick-assign action (it already has a vehicle).
//
// The section gains two OPTIONAL injected seams so the existing 6-case contract
// (list-only client) is untouched: listVehicles() and assign(). Vehicles load
// via ReferenceItem (id = vehicleId uuid, label = plate), honoring the
// no-raw-UUID-in-UI invariant end to end.
//
// Native <dialog> a11y in jsdom: showModal/close reflect the open property (the
// searched fix) so the modal contents are queryable by role.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { AdminDriverRow, ReferenceItem } from '@fleet/sync-protocol';
import { DriversSection } from '@/features/admin/DriversSection';
const VEHICLE = '11111111-1111-1111-1111-111111111111';
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
const VEHICLES: readonly ReferenceItem[] = [{ id: VEHICLE, label: '62H 05194' }];
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement): void { this.open = true; };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement): void { this.open = false; };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('DriversSection quick-assign wiring', () => {
  it('shows a Phan cong nhanh action on an UNASSIGNED row', async () => {
    const client = {
      list: vi.fn().mockResolvedValue([row({})]),
      listVehicles: vi.fn().mockResolvedValue(VEHICLES),
      assign: vi.fn().mockResolvedValue({ assignmentId: 'a1' }),
    };
    render(<DriversSection client={client} />);
    await screen.findByText('LE VAN CHAU');
    expect(screen.getByRole('button', { name: 'Phân công nhanh' })).toBeInTheDocument();
  });
  it('does NOT show the action on an ASSIGNED row', async () => {
    const client = {
      list: vi.fn().mockResolvedValue([
        row({ assignedVehicle: { vehicleId: VEHICLE, plate: '62H 05194' }, assignmentId: 'a0' }),
      ]),
      listVehicles: vi.fn().mockResolvedValue(VEHICLES),
      assign: vi.fn(),
    };
    render(<DriversSection client={client} />);
    await screen.findByText('LE VAN CHAU');
    expect(screen.queryByRole('button', { name: 'Phân công nhanh' })).toBeNull();
  });
  it('opens the modal with available vehicles when the action is clicked', async () => {
    const client = {
      list: vi.fn().mockResolvedValue([row({})]),
      listVehicles: vi.fn().mockResolvedValue(VEHICLES),
      assign: vi.fn().mockResolvedValue({ assignmentId: 'a1' }),
    };
    render(<DriversSection client={client} />);
    await screen.findByText('LE VAN CHAU');
    fireEvent.click(screen.getByRole('button', { name: 'Phân công nhanh' }));
    await waitFor(() => {
      expect(screen.getByRole('option', { name: '62H 05194' })).toBeInTheDocument();
    });
    expect(client.listVehicles).toHaveBeenCalled();
  });
  it('assigns the chosen vehicle then refreshes the list', async () => {
    const list = vi.fn().mockResolvedValue([row({})]);
    const assign = vi.fn().mockResolvedValue({ assignmentId: 'a1' });
    const client = { list, listVehicles: vi.fn().mockResolvedValue(VEHICLES), assign };
    render(<DriversSection client={client} />);
    await screen.findByText('LE VAN CHAU');
    fireEvent.click(screen.getByRole('button', { name: 'Phân công nhanh' }));
    await waitFor(() => { expect(screen.getByRole('combobox')).toBeInTheDocument(); });
    const dialog = screen.getByTestId('quick-assign-dialog');
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: VEHICLE } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Phân công' }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith({ driverId: 'dr1', vehicleId: VEHICLE });
    });
    // refresh: list() called a second time after a successful assign
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2); });
  });
  it('still renders with a list-only client (existing contract untouched)', async () => {
    const client = { list: vi.fn().mockResolvedValue([row({})]) };
    render(<DriversSection client={client} />);
    expect(await screen.findByText('LE VAN CHAU')).toBeInTheDocument();
  });
  it('falls back to makeDefaultClient and drives the full default wire path', async () => {
    // No client prop -> makeDefaultClient() builds a real AdminDriversClient +
    // ReferenceAdminClient(vehicles). Stub global fetch per endpoint so list,
    // listVehicles AND assign all run -- exercising the factory arrow bodies
    // (the production wiring every injected test skips). Open the modal (calls
    // the listVehicles arrow) and confirm (calls the assign arrow).
    const driverRow = row({ fullName: 'DEFAULT WIRE DRIVER' });
    const fetchMock = vi.fn((url: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/admin/drivers' && method === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([driverRow]) });
      }
      if (url.startsWith('/api/reference/vehicles')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: VEHICLES }) });
      }
      if (url === '/api/admin/driver-vehicle-assignments' && method === 'POST') {
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ assignmentId: 'a1' }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    });
    globalThis.fetch = fetchMock as never;
    render(<DriversSection />);
    await screen.findByText('DEFAULT WIRE DRIVER');
    fireEvent.click(screen.getByRole('button', { name: 'Phân công nhanh' }));
    await waitFor(() => { expect(screen.getByRole('option', { name: '62H 05194' })).toBeInTheDocument(); });
    const dialog = screen.getByTestId('quick-assign-dialog');
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: VEHICLE } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Phân công' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/driver-vehicle-assignments', expect.objectContaining({ method: 'POST' }));
    });
  });
});
