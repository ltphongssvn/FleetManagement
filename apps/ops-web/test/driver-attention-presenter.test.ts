// apps/ops-web/test/driver-attention-presenter.test.ts
// RED-first for the driver-attention presenter: machine-readable reason
// codes -> immutable Vietnamese copy + next-action hint. Two-tier
// discipline (same as login-error.ts / vnExceptionMessage): the presenter
// accepts a LOOSE string (an older UI must not crash on a newer producer
// code) and falls back generically for unknown codes; the strict producer
// union from @fleet/sync-protocol is covered exhaustively so adding a
// contract code forces a label here at test time. Labels are presentation,
// codes are contract -- the existing table strings stay byte-identical.
import { describe, expect, it } from 'vitest';
import { DRIVER_ATTENTION_REASONS } from '@fleet/sync-protocol';
import {
  DRIVER_ATTENTION_QUEUE_HEADING,
  DRIVER_ATTENTION_FALLBACK,
  presentDriverAttentionReason,
  presentDriverAttentionReasons,
} from '@/features/admin/driver-attention.presenter';

describe('driver-attention presenter', () => {
  it('queue heading is the immutable Vietnamese contract', () => {
    expect(DRIVER_ATTENTION_QUEUE_HEADING).toBe('Cần xử lý');
  });

  it('VEHICLE_UNASSIGNED presents the existing table label + assign hint', () => {
    const p = presentDriverAttentionReason('VEHICLE_UNASSIGNED');
    expect(p.label).toBe('Chưa giao');
    expect(p.hint).toBe('Chọn số xe và bấm Phân công & đăng ký.');
  });

  it('DEVICE_UNREGISTERED presents the existing table label + enroll hint', () => {
    const p = presentDriverAttentionReason('DEVICE_UNREGISTERED');
    expect(p.label).toBe('Chưa đăng ký');
    expect(p.hint).toBe('Nhập mã thiết bị (UDID) và bấm Phân công & đăng ký.');
  });

  it('unknown codes fall back generically and never throw', () => {
    const p = presentDriverAttentionReason('A_CODE_FROM_THE_FUTURE');
    expect(p).toEqual(DRIVER_ATTENTION_FALLBACK);
    expect(p.label).toBe('Cần kiểm tra');
    expect(p.hint).toBe('Vui lòng kiểm tra thông tin tài xế.');
  });

  it('every strict producer code has a non-fallback presentation', () => {
    for (const code of DRIVER_ATTENTION_REASONS) {
      const p = presentDriverAttentionReason(code);
      expect(p.label).not.toBe(DRIVER_ATTENTION_FALLBACK.label);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.hint.length).toBeGreaterThan(0);
    }
  });

  it('presentDriverAttentionReasons maps in order and handles empty', () => {
    const list = presentDriverAttentionReasons(['DEVICE_UNREGISTERED', 'VEHICLE_UNASSIGNED']);
    expect(list.map((p) => p.label)).toEqual(['Chưa đăng ký', 'Chưa giao']);
    expect(presentDriverAttentionReasons([])).toEqual([]);
  });
});
