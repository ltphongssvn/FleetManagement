// apps/ops-web/test/co-so-du-lieu-presenter.test.ts
// RED-first for the Cơ sở dữ liệu driver-status presenter: the three-state
// badge SSOT code -> immutable Vietnamese label + badge tone. Two-tier
// discipline (matching driver-attention.presenter): loose string in (an older
// UI must not crash on a newer producer code -> generic fallback), while the
// strict DRIVER_DB_STATUSES union from @fleet/sync-protocol is covered
// exhaustively so a new status forces a label here at test time. Labels +
// tones are presentation; the status codes are the contract. These Vietnamese
// strings are immutable UI contracts.
import { describe, expect, it } from 'vitest';
import { DRIVER_DB_STATUSES } from '@fleet/sync-protocol';
import {
  DRIVER_DB_STATUS_FALLBACK,
  presentDriverDbStatus,
} from '@/features/admin/co-so-du-lieu.presenter';

describe('co-so-du-lieu driver-status presenter', () => {
  it('unassigned presents Chưa phân công with warning tone', () => {
    const p = presentDriverDbStatus('unassigned');
    expect(p.label).toBe('Chưa phân công');
    expect(p.tone).toBe('warning');
  });

  it('assigned presents Đã giao xe with info tone', () => {
    const p = presentDriverDbStatus('assigned');
    expect(p.label).toBe('Đã giao xe');
    expect(p.tone).toBe('info');
  });

  it('active presents Đang hoạt động with success tone', () => {
    const p = presentDriverDbStatus('active');
    expect(p.label).toBe('Đang hoạt động');
    expect(p.tone).toBe('success');
  });

  it('unknown codes fall back generically and never throw', () => {
    const p = presentDriverDbStatus('a_future_status');
    expect(p).toEqual(DRIVER_DB_STATUS_FALLBACK);
    expect(p.label).toBe('Không rõ');
    expect(p.tone).toBe('neutral');
  });

  it('every strict status code has a non-fallback presentation', () => {
    for (const code of DRIVER_DB_STATUSES) {
      const p = presentDriverDbStatus(code);
      expect(p.label).not.toBe(DRIVER_DB_STATUS_FALLBACK.label);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });
});
