// apps/api/test/error-mapping.test.ts
// Pure unit tests for mapDbErrorToSyncResult — no DB, no service.
import { describe, it, expect } from 'vitest';
import { mapDbErrorToSyncResult } from '../src/sync/error-mapping.js';
import { createPgUniqueViolation, createWrappedError } from '@fleet/test-fixtures';

describe('@fleet/api - mapDbErrorToSyncResult', () => {
  it.each([
    ['direct 23505', createPgUniqueViolation({ message: 'x' }), 'duplicate'],
    ['nested 23505 cause', createWrappedError('outer', createPgUniqueViolation({ message: 'inner' })), 'duplicate'],
    ['unrelated SQLSTATE', Object.assign(new Error('x'), { code: '23503' }), 'rejected'],
    ['plain Error', new Error('boom'), 'rejected'],
    ['string thrown', 'oops', 'rejected'],
    ['null', null, 'rejected'],
  ])('classifies %s as %s', (_label, input, expected) => {
    expect(mapDbErrorToSyncResult(input)).toBe(expected);
  });
});
