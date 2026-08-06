// packages/domain/test/stop-role.test.ts
// RED->GREEN spec for the stop-role SSOT normalizer. The DB persists stopType
// as a free varchar and production data uses pickup | delivery | dropoff in
// mixed case; classifyStopRole folds that real vocabulary into ONE canonical
// STOP_ROLES definition so the delivery-capture gate and the 4x-duplicated
// service compares all derive from a single source, not ad-hoc toLowerCase.
// 2026 domain-invariant best practice: the rule lives in the model, once.
import { describe, it, expect } from 'vitest';
import {
  STOP_ROLES,
  StopRoleSchema,
  classifyStopRole,
  type StopRole,
} from '../src/transport/stop-role.js';

describe('@fleet/domain - STOP_ROLES SSOT', () => {
  it('exposes the canonical normalized roles', () => {
    expect([...STOP_ROLES]).toEqual(['pickup', 'delivery']);
  });
  it('schema accepts each canonical role', () => {
    for (const r of STOP_ROLES) expect(StopRoleSchema.parse(r)).toBe(r);
  });
  it('schema rejects a non-canonical raw value (kills enum widening)', () => {
    expect(() => StopRoleSchema.parse('dropoff')).toThrow();
    expect(() => StopRoleSchema.parse('')).toThrow();
  });
});

describe('@fleet/domain - classifyStopRole', () => {
  it('maps pickup to pickup', () => {
    expect(classifyStopRole('pickup')).toBe('pickup');
  });
  it('maps delivery and dropoff to delivery', () => {
    expect(classifyStopRole('delivery')).toBe('delivery');
    expect(classifyStopRole('dropoff')).toBe('delivery');
  });
  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(classifyStopRole('PICKUP')).toBe('pickup');
    expect(classifyStopRole('Delivery')).toBe('delivery');
    expect(classifyStopRole('  DropOff ')).toBe('delivery');
  });
  it('treats any unknown value as pickup (fail-safe: an unknown stop still gates delivery)', () => {
    expect(classifyStopRole('transfer')).toBe('pickup');
    expect(classifyStopRole('')).toBe('pickup');
  });
  it('narrows to StopRole', () => {
    const r: StopRole = classifyStopRole('delivery');
    expect(r).toBe('delivery');
  });
});
