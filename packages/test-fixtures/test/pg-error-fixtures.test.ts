// packages/test-fixtures/test/pg-error-fixtures.test.ts
import { describe, it, expect } from 'vitest';
import { createPgUniqueViolation, createWrappedError } from '../src/index.js';

describe('@fleet/test-fixtures - pg-error fixtures', () => {
  it('createPgUniqueViolation produces 23505 error', () => {
    const err = createPgUniqueViolation();
    expect((err as { code?: string }).code).toBe('23505');
    expect(err).toBeInstanceOf(Error);
  });
  it('createPgUniqueViolation accepts constraint name', () => {
    const err = createPgUniqueViolation({ constraint: 'my_uq' });
    expect((err as { constraint?: string }).constraint).toBe('my_uq');
  });
  it('createWrappedError sets cause via ES2022 Error options bag', () => {
    const inner = new Error('inner');
    const outer = createWrappedError('outer', inner);
    expect(outer.message).toBe('outer');
    expect(outer.cause).toBe(inner);
  });
  it('factories compose: createWrappedError(createPgUniqueViolation()) for nested-cause testing', () => {
    const wrapped = createWrappedError('tx failed', createPgUniqueViolation());
    expect(((wrapped.cause as { code?: string })).code).toBe('23505');
  });
});
