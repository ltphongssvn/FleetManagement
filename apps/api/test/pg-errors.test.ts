// apps/api/test/pg-errors.test.ts
// Pure unit tests for Postgres error classification. it.each covers truth-table
// classification cases; fast-check property test covers MAX_DEPTH boundary.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  isPgUniqueViolation,
  isPgUniqueViolationOnConstraint,
  isPgUniqueViolationOnConstraintInChain,
} from '../src/common/pg-errors.js';
import { createPgUniqueViolation, createWrappedError } from '@fleet/test-fixtures';

describe('@fleet/api - pg-errors', () => {
  describe('isPgUniqueViolation truth table', () => {
    const cases: readonly (readonly [string, unknown, boolean])[] = [
      ['direct 23505 error', createPgUniqueViolation({ message: 'x' }), true],
      [
        '23505 in cause chain (1 level)',
        createWrappedError('outer', createPgUniqueViolation({ message: 'inner' })),
        true,
      ],
      [
        '23505 nested 3 levels deep',
        Object.assign(new Error('l1'), {
          cause: Object.assign(new Error('l2'), {
            cause: Object.assign(new Error('l3'), { code: '23505' }),
          }),
        }),
        true,
      ],
      ['unrelated SQLSTATE code 23503', Object.assign(new Error('x'), { code: '23503' }), false],
      ['string', 'boom', false],
      ['null', null, false],
      ['number', 42, false],
      ['undefined', undefined, false],
    ];
    it.each(cases)('classifies %s -> %s', (_label, input, expected) => {
      expect(isPgUniqueViolation(input)).toBe(expected);
    });
  });

  describe('isPgUniqueViolation safety properties', () => {
    it('terminates on cyclic cause chain (no infinite loop)', () => {
      const a: { cause?: unknown; code?: string } = {};
      const b: { cause?: unknown; code?: string } = { cause: a };
      a.cause = b;
      expect(isPgUniqueViolation(a)).toBe(false);
    });

    it('property: chains deeper than MAX_DEPTH (5) are not classified as unique-violation', () => {
      fc.assert(
        fc.property(fc.integer({ min: 5, max: 50 }), (depth) => {
          let cur: { cause?: unknown; code?: string } = { code: '23505' };
          for (let i = 0; i < depth; i++) cur = { cause: cur };
          // 23505 is `depth` levels deep — must NOT be detected when depth >= MAX_DEPTH (5)
          expect(isPgUniqueViolation(cur)).toBe(false);
        }),
      );
    });

    it('property: chains within MAX_DEPTH are correctly classified', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 4 }), (depth) => {
          let cur: { cause?: unknown; code?: string } = { code: '23505' };
          for (let i = 0; i < depth; i++) cur = { cause: cur };
          expect(isPgUniqueViolation(cur)).toBe(true);
        }),
      );
    });
  });

  describe('isPgUniqueViolationOnConstraint truth table', () => {
    const cases: readonly (readonly [
      string,
      { code?: string; constraint?: string },
      string,
      boolean,
    ])[] = [
      ['code+constraint match', { code: '23505', constraint: 'my_uq' }, 'my_uq', true],
      [
        'code matches, constraint differs',
        { code: '23505', constraint: 'other_uq' },
        'my_uq',
        false,
      ],
      ['no constraint property', { code: '23505' }, 'my_uq', false],
    ];
    it.each(cases)('%s -> %s', (_label, errProps, target, expected) => {
      const err = Object.assign(new Error('x'), errProps);
      expect(isPgUniqueViolationOnConstraint(err, target)).toBe(expected);
    });
  });

  describe('isPgUniqueViolationOnConstraintInChain truth table', () => {
    const topLevelMatch = createPgUniqueViolation({ message: 'x', constraint: 'my_uq' });
    const deepMatch = createWrappedError(
      'outer',
      createPgUniqueViolation({ message: 'inner', constraint: 'my_uq' }),
    );
    const wrongConstraint = createPgUniqueViolation({ message: 'x', constraint: 'other' });
    const cases: readonly (readonly [string, unknown, string, boolean])[] = [
      ['constraint matches at top level', topLevelMatch, 'my_uq', true],
      ['constraint matches deep in cause chain', deepMatch, 'my_uq', true],
      ['wrong constraint name', wrongConstraint, 'my_uq', false],
    ];
    it.each(cases)('%s -> %s', (_label, err, target, expected) => {
      expect(isPgUniqueViolationOnConstraintInChain(err, target)).toBe(expected);
    });
  });
});
