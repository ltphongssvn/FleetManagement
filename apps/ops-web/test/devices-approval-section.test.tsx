// apps/ops-web/test/devices-approval-section.test.tsx
// RED (P7 slice-C): the devices approval queue. An admin reviews devices that
// self-enrolled and attested (binding pending), inspects the attestation
// evidence, then activates or revokes. Composes the shared DataTable +
// StatusBadge with the device-binding presenter (Vietnamese labels) and the
// validating AdminDevicesClient. NO raw UUID is ever rendered (house rule,
// PR #302-era: no raw UUIDs in user-facing UI) -- rows show platform, status,
// security level, environment and verification time instead.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DevicesApprovalSection, type DevicesApprovalClient } from '@/features/admin/DevicesApprovalSection';

// Session-refresh seam: the expired-session arm navigates instead of showing
// an error, mirroring the prod idle-timeout behaviour of the drivers surface.
const navigateSpy = vi.fn();
const expiredSpy = vi.fn().mockReturnValue(false);
vi.mock('@/features/auth/session-refresh-navigation', () => ({
  isSessionExpired: (e: unknown) => expiredSpy(e) as boolean,
  navigateToSessionRefresh: () => { navigateSpy(); },
}));

const DEVICE_ID = '018f6b2a-1111-7000-8000-000000000001';
const OPERATOR_ID = '018f6b2a-2222-7000-8000-000000000002';

function pageWith(rows: unknown[]): unknown {
  return { data: rows, page: 1, pageSize: 20, total: rows.length, totalPages: 1, hasMore: false };
}

const PENDING_ROW = {
  deviceId: DEVICE_ID,
  operatorId: OPERATOR_ID,
  platform: 'android',
  bindingStatus: 'pending',
  attestationSecurityLevel: 'strongbox',
  attestationEnvironment: 'production',
  attestationVerifiedAt: '2026-07-20T00:00:00.000Z',
  bindingRevokedReason: null,
};

// Each method is a vi.Mock so call assertions typecheck without casts. The
// shape satisfies DevicesApprovalClient structurally; overrides swap one method.
type MockedClient = {
  [K in keyof DevicesApprovalClient]: ReturnType<typeof vi.fn>;
};

function fakeClient(overrides: Partial<MockedClient> = {}): MockedClient {
  return {
    list: vi.fn().mockResolvedValue(pageWith([PENDING_ROW])),
    activate: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('DevicesApprovalSection', () => {
  it('loads the pending queue by default and shows the Vietnamese status label', async () => {
    const client = fakeClient();
    render(<DevicesApprovalSection client={client as unknown as DevicesApprovalClient} />);
    await waitFor(() => {
      expect(screen.getByText('Chờ duyệt')).toBeInTheDocument();
    });
  });
  it('never renders a raw device or operator UUID', async () => {
    const client = fakeClient();
    const { container } = render(<DevicesApprovalSection client={client as unknown as DevicesApprovalClient} />);
    await waitFor(() => { expect(screen.getByText('Chờ duyệt')).toBeInTheDocument(); });
    expect(container.textContent).not.toContain(DEVICE_ID);
    expect(container.textContent).not.toContain(OPERATOR_ID);
  });
  it('shows the attestation evidence an admin vets before approving', async () => {
    const client = fakeClient();
    render(<DevicesApprovalSection client={client as unknown as DevicesApprovalClient} />);
    await waitFor(() => { expect(screen.getByText('Chờ duyệt')).toBeInTheDocument(); });
    expect(screen.getByText(/strongbox/i)).toBeInTheDocument();
    expect(screen.getByText(/production/i)).toBeInTheDocument();
  });
  it('activating a device calls the client then refreshes the queue', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    render(<DevicesApprovalSection client={client as unknown as DevicesApprovalClient} />);
    await waitFor(() => { expect(screen.getByText('Chờ duyệt')).toBeInTheDocument(); });
    await user.click(screen.getByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Duyệt' }));
    await waitFor(() => {
      expect(client.activate).toHaveBeenCalledWith(DEVICE_ID);
    });
    expect(client.list).toHaveBeenCalledTimes(2);
  });
  it('revoking prompts for a reason and passes it through for the audit trail', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    vi.spyOn(window, 'prompt').mockReturnValue('thiet bi bi mat');
    render(<DevicesApprovalSection client={client as unknown as DevicesApprovalClient} />);
    await waitFor(() => { expect(screen.getByText('Chờ duyệt')).toBeInTheDocument(); });
    await user.click(screen.getByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Thu hồi' }));
    await waitFor(() => {
      expect(client.revoke).toHaveBeenCalledWith(DEVICE_ID, 'thiet bi bi mat');
    });
  });
  it('cancelling the revoke prompt performs no mutation', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    render(<DevicesApprovalSection client={client as unknown as DevicesApprovalClient} />);
    await waitFor(() => { expect(screen.getByText('Chờ duyệt')).toBeInTheDocument(); });
    await user.click(screen.getByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Thu hồi' }));
    expect(client.revoke).not.toHaveBeenCalled();
  });
  it('switching the status filter re-queries with that status', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    render(<DevicesApprovalSection client={client as unknown as DevicesApprovalClient} />);
    await waitFor(() => { expect(screen.getByText('Chờ duyệt')).toBeInTheDocument(); });
    await user.click(screen.getByTestId('device-filter-active'));
    await waitFor(() => {
      const calls = client.list.mock.calls;
      const last = calls[calls.length - 1]?.[0] as { status?: string } | undefined;
      expect(last?.status).toBe('active');
    });
  });
  it('shows the empty-state copy when the queue has no devices', async () => {
    const client = fakeClient({ list: vi.fn().mockResolvedValue(pageWith([])) });
    render(<DevicesApprovalSection client={client as unknown as DevicesApprovalClient} />);
    await waitFor(() => {
      expect(screen.getByTestId('datatable-empty')).toBeInTheDocument();
    });
  });
  it('an expired session navigates to refresh instead of showing an error', async () => {
    expiredSpy.mockReturnValueOnce(true);
    const client = fakeClient({ list: vi.fn().mockRejectedValue(new Error('expired')) });
    render(<DevicesApprovalSection client={client as unknown as DevicesApprovalClient} />);
    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('devices-section-error')).toBeNull();
  });
  it('a failed activate surfaces Vietnamese error copy', async () => {
    const user = userEvent.setup();
    const client = fakeClient({ activate: vi.fn().mockRejectedValue(new Error('boom')) });
    render(<DevicesApprovalSection client={client as unknown as DevicesApprovalClient} />);
    await waitFor(() => { expect(screen.getByText('Chờ duyệt')).toBeInTheDocument(); });
    await user.click(screen.getByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Duyệt' }));
    await waitFor(() => {
      expect(screen.getByTestId('devices-section-error')).toBeInTheDocument();
    });
  });
  it('a failed revoke surfaces Vietnamese error copy', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'prompt').mockReturnValue('thiet bi bi mat');
    const client = fakeClient({ revoke: vi.fn().mockRejectedValue(new Error('boom')) });
    render(<DevicesApprovalSection client={client as unknown as DevicesApprovalClient} />);
    await waitFor(() => { expect(screen.getByText('Chờ duyệt')).toBeInTheDocument(); });
    await user.click(screen.getByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Thu hồi' }));
    await waitFor(() => {
      expect(screen.getByTestId('devices-section-error')).toBeInTheDocument();
    });
  });
  it('an empty revoke reason performs no mutation', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'prompt').mockReturnValue('');
    const client = fakeClient();
    render(<DevicesApprovalSection client={client as unknown as DevicesApprovalClient} />);
    await waitFor(() => { expect(screen.getByText('Chờ duyệt')).toBeInTheDocument(); });
    await user.click(screen.getByRole('button', { name: /Thao tác/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Thu hồi' }));
    expect(client.revoke).not.toHaveBeenCalled();
  });
  it('renders every lifecycle state: hides Duyet when active, hides Thu hoi when revoked, and shows the not-yet-attested placeholders', async () => {
    const user = userEvent.setup();
    // One render across all three binding states with null attestation fields.
    // Every A|B arm in the columns is exercised here (the union-arm rule): the
    // ?? placeholders for an unattested device, the null verified-at fallback,
    // and both action-button conditionals.
    const ACTIVE_ID = '018f6b2a-3333-7000-8000-000000000003';
    const REVOKED_ID = '018f6b2a-4444-7000-8000-000000000004';
    const client = fakeClient({
      list: vi.fn().mockResolvedValue(pageWith([
        {
          ...PENDING_ROW,
          attestationSecurityLevel: null,
          attestationEnvironment: null,
          attestationVerifiedAt: null,
        },
        {
          ...PENDING_ROW,
          deviceId: ACTIVE_ID,
          bindingStatus: 'active',
        },
        {
          ...PENDING_ROW,
          deviceId: REVOKED_ID,
          bindingStatus: 'revoked',
          bindingRevokedReason: 'thiet bi bi mat',
        },
      ])),
    });
    render(<DevicesApprovalSection client={client as unknown as DevicesApprovalClient} />);
    await waitFor(() => { expect(screen.getByText('Chờ duyệt')).toBeInTheDocument(); });
    // An approved device offers no Duyet action; a revoked one offers no Thu hoi.
    // Three rows -> three menus; open each in turn and assert its contents.
    const menus = screen.getAllByRole('button', { name: /Thao tác/ });
    expect(menus).toHaveLength(3);
    // row 2 = active: Thu hoi only
    const activeMenu = menus[1];
    if (activeMenu === undefined) throw new Error('no active-row menu');
    await user.click(activeMenu);
    expect(await screen.findByRole('menuitem', { name: 'Thu hồi' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Duyệt' })).toBeNull();
    await user.keyboard('{Escape}');
    // row 3 = revoked: Duyet only
    const revokedMenu = menus[2];
    if (revokedMenu === undefined) throw new Error('no revoked-row menu');
    await user.click(revokedMenu);
    expect(await screen.findByRole('menuitem', { name: 'Duyệt' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Thu hồi' })).toBeNull();
    // Not-yet-attested device: em-dash placeholders + the verified-at fallback.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Chưa xác thực')).toBeInTheDocument();
  });
  it('an unparseable verification timestamp falls back to the not-verified copy', async () => {
    const client = fakeClient({
      list: vi.fn().mockResolvedValue(pageWith([
        { ...PENDING_ROW, attestationVerifiedAt: 'not-a-date' },
      ])),
    });
    render(<DevicesApprovalSection client={client as unknown as DevicesApprovalClient} />);
    await waitFor(() => {
      expect(screen.getByText('Chưa xác thực')).toBeInTheDocument();
    });
  });
  it('surfaces a load failure as Vietnamese error copy', async () => {
    const client = fakeClient({ list: vi.fn().mockRejectedValue(new Error('boom')) });
    render(<DevicesApprovalSection client={client as unknown as DevicesApprovalClient} />);
    await waitFor(() => {
      expect(screen.getByTestId('devices-section-error')).toBeInTheDocument();
    });
  });
  it('exposes Duyet and Thu hoi in the row menu, not as standalone buttons', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    render(<DevicesApprovalSection client={client as unknown as DevicesApprovalClient} />);
    await waitFor(() => { expect(screen.getByText('Chờ duyệt')).toBeInTheDocument(); });
    // consolidated: no standalone approve/revoke buttons remain on the row
    expect(screen.queryByTestId('device-activate-' + DEVICE_ID)).toBeNull();
    expect(screen.queryByTestId('device-revoke-' + DEVICE_ID)).toBeNull();
    await user.click(screen.getByRole('button', { name: /Thao tác/ }));
    expect(await screen.findByRole('menuitem', { name: 'Duyệt' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Thu hồi' })).toBeInTheDocument();
  });
});
