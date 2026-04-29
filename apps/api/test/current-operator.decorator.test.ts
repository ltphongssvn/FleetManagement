// apps/api/test/current-operator.decorator.test.ts
import { describe, it, expect } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { CurrentOperator, extractCurrentOperator } from '../src/auth/current-operator.decorator.js';
import type { OperatorContext } from '../src/auth/operator-context.js';

const validOp: OperatorContext = {
  operatorId: '00000000-0000-0000-0000-000000000002',
  companyId: '00000000-0000-0000-0000-000000000003',
  businessUnitId: '00000000-0000-0000-0000-000000000000',
  depotId: '00000000-0000-0000-0000-000000000000',
  legalEntityId: '00000000-0000-0000-0000-000000000000',
};

function makeCtx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('@fleet/api - extractCurrentOperator', () => {
  it('returns fleetOperator when present on request', () => {
    const result = extractCurrentOperator(undefined, makeCtx({ fleetOperator: validOp }));
    expect(result).toEqual(validOp);
  });

  it('throws UnauthorizedException when fleetOperator missing', () => {
    expect(() => extractCurrentOperator(undefined, makeCtx({}))).toThrow(UnauthorizedException);
  });

  it('throws with descriptive message about JwtGuard', () => {
    expect(() => extractCurrentOperator(undefined, makeCtx({}))).toThrow(/JwtGuard/);
  });

  it('CurrentOperator is a callable decorator factory', () => {
    expect(typeof CurrentOperator).toBe('function');
  });

  it('ignores the data param (decorator metadata)', () => {
    const result = extractCurrentOperator('ignored', makeCtx({ fleetOperator: validOp }));
    expect(result).toEqual(validOp);
  });
});
