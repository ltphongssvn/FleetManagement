// packages/domain/test/identity.test.ts
// Behavioral + contract tests: validate schema parsing, type exhaustiveness,
// runtime immutability, and tolerant-reader version contract.
import { describe, it, expect, expectTypeOf } from 'vitest';
import type { OperatorContext } from '../src/index.js';
import {
  SessionSurfaceSchema,
  SESSION_SURFACES,
  SessionModeSchema,
  SESSION_MODES,
  type SessionSurface,
  type SessionMode,
  RevocationReasonSchema,
  REVOCATION_REASONS,
  REVOCATION_REASON_SCHEMA_VERSION,
  RevocationEventSchema,
  type RevocationReason,
} from '../src/index.js';

describe('@fleet/domain - SessionSurfaceSchema', () => {
  it('parses each PDF-mandated surface', () => {
    for (const s of SESSION_SURFACES) {
      expect(SessionSurfaceSchema.parse(s)).toBe(s);
    }
  });

  it('rejects spoofed surfaces from network payloads', () => {
    expect(SessionSurfaceSchema.safeParse('admin').success).toBe(false);
    expect(SessionSurfaceSchema.safeParse('').success).toBe(false);
    expect(SessionSurfaceSchema.safeParse(null).success).toBe(false);
    expect(SessionSurfaceSchema.safeParse(42).success).toBe(false);
  });

  it('SessionSurface union is exhaustive (compile-time contract)', () => {
    expectTypeOf<SessionSurface>().toEqualTypeOf<'road' | 'yard' | 'depot' | 'dispatch'>();
  });

  it('SESSION_SURFACES is frozen at runtime (defense in depth)', () => {
    expect(Object.isFrozen(SESSION_SURFACES)).toBe(true);
  });
});

describe('@fleet/domain - SessionModeSchema', () => {
  it('parses mutating + shadow modes', () => {
    expect(SessionModeSchema.parse('mutating')).toBe('mutating');
    expect(SessionModeSchema.parse('shadow')).toBe('shadow');
  });

  it('rejects unknown modes', () => {
    expect(SessionModeSchema.safeParse('readonly').success).toBe(false);
  });

  it('SessionMode union is exhaustive', () => {
    expectTypeOf<SessionMode>().toEqualTypeOf<'mutating' | 'shadow'>();
  });
});

describe('@fleet/domain - RevocationReasonSchema', () => {
  it('parses every PDF-mandated reason', () => {
    for (const reason of REVOCATION_REASONS) {
      expect(RevocationReasonSchema.parse(reason)).toBe(reason);
    }
  });

  it('rejects unknown reasons via safeParse (tolerant reader pattern)', () => {
    const result = RevocationReasonSchema.safeParse('mystery_reason_v2');
    expect(result.success).toBe(false);
  });

  it('exposes schema version for tolerant reader contract', () => {
    expect(REVOCATION_REASON_SCHEMA_VERSION).toBe(1);
  });

  it('RevocationReason union is exhaustive', () => {
    type ExpectedReason =
      | 'operator_logout'
      | 'admin_revoke'
      | 'device_lost'
      | 'session_superseded'
      | 'shift_end'
      | 'security_incident'
      | 'config_breaking_change';
    expectTypeOf<RevocationReason>().toEqualTypeOf<ExpectedReason>();
  });

  // Version-evolution contract: when v1 reasons are received, they must still
  // parse successfully even after schema version bumps in the future.
  it('v1 reasons remain accepted (additive evolution invariant)', () => {
    const v1Reasons = [
      'operator_logout',
      'admin_revoke',
      'device_lost',
      'session_superseded',
      'shift_end',
      'security_incident',
      'config_breaking_change',
    ];
    for (const r of v1Reasons) {
      expect(RevocationReasonSchema.safeParse(r).success).toBe(true);
    }
  });
});

describe('@fleet/domain - constant order contracts', () => {
  // Order is exposed via OpenAPI enum generation, dropdown UIs, and audit logs;
  // a reorder is a breaking change and should fail loudly.
  it('SESSION_SURFACES preserves canonical order', () => {
    expect([...SESSION_SURFACES]).toEqual(['road', 'yard', 'depot', 'dispatch']);
  });

  it('SESSION_MODES preserves canonical order', () => {
    expect([...SESSION_MODES]).toEqual(['mutating', 'shadow']);
  });

  it('REVOCATION_REASONS preserves canonical order', () => {
    expect([...REVOCATION_REASONS]).toEqual([
      'operator_logout',
      'admin_revoke',
      'device_lost',
      'session_superseded',
      'shift_end',
      'security_incident',
      'config_breaking_change',
    ]);
  });
});

describe('@fleet/domain - RevocationEventSchema', () => {
  const validEvent = {
    reasonSchemaVersion: REVOCATION_REASON_SCHEMA_VERSION,
    reason: 'admin_revoke' as const,
    revokedAt: '2026-04-26T18:00:00.000Z',
  };

  it('accepts well-formed events', () => {
    expect(RevocationEventSchema.parse(validEvent)).toEqual(validEvent);
  });

  it('rejects events with mismatched schema version', () => {
    const bad = { ...validEvent, reasonSchemaVersion: 99 };
    expect(RevocationEventSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects events with non-ISO timestamps', () => {
    const bad = { ...validEvent, revokedAt: 'yesterday' };
    expect(RevocationEventSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects events with unknown reasons', () => {
    const bad = { ...validEvent, reason: 'mystery_v2' };
    expect(RevocationEventSchema.safeParse(bad).success).toBe(false);
  });
});

describe('@fleet/domain - OperatorContext', () => {
  it('exports OperatorContext interface with all 5 tenancy fields', () => {
    const op: OperatorContext = {
      operatorId: 'op',
      companyId: 'co',
      businessUnitId: 'bu',
      depotId: 'd',
      legalEntityId: 'le',
    };
    expect(Object.keys(op).sort()).toEqual([
      'businessUnitId',
      'companyId',
      'depotId',
      'legalEntityId',
      'operatorId',
    ]);
  });
});
