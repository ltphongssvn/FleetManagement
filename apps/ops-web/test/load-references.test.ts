// apps/ops-web/test/load-references.test.ts
// TDD: loadReferences fetches drivers/vehicles/customers/cargo/warehouses
// AND driverVehicleAssignments with the cookie token. The assignments mapping
// powers the dispatch form's bidirectional auto-fill between Số xe and Tài xế.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const cookieGet = vi.fn();
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: cookieGet }) }));
describe('loadReferences', () => {
  beforeEach(() => { cookieGet.mockReset(); vi.unstubAllGlobals(); vi.resetModules(); });
  it('returns EMPTY when FLEET_API_URL unset', async () => {
    vi.stubEnv('FLEET_API_URL', '');
    const { loadReferences } = await import('@/features/dispatch/load-references');
    const r = await loadReferences();
    expect(r.drivers).toEqual([]);
    expect(r.nextOrderRef).toBe('');
    expect(r.driverVehicleAssignments).toEqual([]);
  });
  it('returns EMPTY when no fleet_session cookie', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue(undefined);
    const { loadReferences } = await import('@/features/dispatch/load-references');
    const r = await loadReferences();
    expect(r.drivers).toEqual([]);
    expect(r.driverVehicleAssignments).toEqual([]);
  });
  it('fetches all references and returns populated lists', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('peek-order-ref')) return Promise.resolve(new Response(JSON.stringify({ ref: 'XT.001' }), { status: 200 }));
      if (url.includes('driver-vehicle-assignments')) return Promise.resolve(new Response(JSON.stringify({ items: [{ operatorId: 'op-1', vehicleId: 'veh-1' }] }), { status: 200 }));
      if (url.includes('drivers')) return Promise.resolve(new Response(JSON.stringify({ items: [{ id: 'd1', label: 'Driver 1' }] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { loadReferences } = await import('@/features/dispatch/load-references');
    const r = await loadReferences();
    expect(r.nextOrderRef).toBe('XT.001');
    expect(r.drivers).toHaveLength(1);
    expect(r.drivers[0]?.label).toBe('Driver 1');
    expect(r.driverVehicleAssignments).toEqual([{ operatorId: 'op-1', vehicleId: 'veh-1' }]);
  });
  it('returns empty list for endpoint that fails', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 401 }))));
    const { loadReferences } = await import('@/features/dispatch/load-references');
    const r = await loadReferences();
    expect(r.drivers).toEqual([]);
    expect(r.vehicles).toEqual([]);
    expect(r.driverVehicleAssignments).toEqual([]);
  });
  it('handles missing items field gracefully', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))));
    const { loadReferences } = await import('@/features/dispatch/load-references');
    const r = await loadReferences();
    expect(r.drivers).toEqual([]);
    expect(r.driverVehicleAssignments).toEqual([]);
  });
  it('handles thrown fetch error', async () => {
    vi.stubEnv('FLEET_API_URL', 'http://api:3000');
    cookieGet.mockReturnValue({ value: 'tok' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))));
    const { loadReferences } = await import('@/features/dispatch/load-references');
    const r = await loadReferences();
    expect(r.drivers).toEqual([]);
    expect(r.driverVehicleAssignments).toEqual([]);
  });
});
