// apps/api/src/auth/current-operator.decorator.ts
// Param decorator: extract OperatorContext attached by JwtGuard to request.
// The pure factory is exported separately so it can be unit-tested directly
// without going through NestJS's controller-method invocation pipeline.
import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { OperatorContext } from './operator-context.js';

interface RequestWithOperator extends Request {
  fleetOperator?: OperatorContext;
}

export function extractCurrentOperator(_data: unknown, ctx: ExecutionContext): OperatorContext {
  const req = ctx.switchToHttp().getRequest<RequestWithOperator>();
  if (!req.fleetOperator) {
    throw new UnauthorizedException('OperatorContext missing - JwtGuard not applied');
  }
  return req.fleetOperator;
}

export const CurrentOperator = createParamDecorator(extractCurrentOperator);
