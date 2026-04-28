// apps/api/test/device.errors.test.ts
import { describe, it, expect } from 'vitest';
import {
  DomainError,
  SessionAlreadyActiveError,
  SessionNotFoundError,
  SessionInsertFailedError,
} from '../src/device/device.errors.js';

describe('@fleet/api - device.errors', () => {
  it('SessionAlreadyActiveError carries operatorId + surface', () => {
    const err = new SessionAlreadyActiveError('op-1', 'road');
    expect(err).toBeInstanceOf(DomainError);
    expect(err.operatorId).toBe('op-1');
    expect(err.surface).toBe('road');
    expect(err.message).toContain('op-1');
  });

  it('SessionNotFoundError carries deviceSessionId', () => {
    const err = new SessionNotFoundError('s-1');
    expect(err.deviceSessionId).toBe('s-1');
    expect(err.name).toBe('SessionNotFoundError');
  });

  it('SessionInsertFailedError extends DomainError', () => {
    const err = new SessionInsertFailedError();
    expect(err).toBeInstanceOf(DomainError);
    expect(err.message).toContain('constraint violation');
  });
});
