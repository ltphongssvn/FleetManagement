// apps/api/src/copilot/copilot.controller.ts
// Thin HTTP layer for the dispatcher Command Palette: Zod-parse the
// untrusted plan at the boundary (strict producer payloads reject unknown
// keys), delegate to the deterministic executor with the JWT-derived
// OperatorContext. Guard parity with the admin seams (JwtGuard). Invalid
// bodies raise ZodError -> global ZodExceptionFilter -> problem+json.
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { OperatorContext } from '@fleet/domain';
import { CopilotPlanSchema, type CopilotExecutionResult } from '@fleet/sync-protocol';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CopilotExecutorService } from './copilot-executor.service.js';

@UseGuards(JwtGuard)
@Controller('copilot')
export class CopilotController {
  constructor(private readonly executor: CopilotExecutorService) {}

  @Post('execute')
  async execute(
    @Body() body: unknown,
    @CurrentOperator() op: OperatorContext,
  ): Promise<CopilotExecutionResult> {
    const plan = CopilotPlanSchema.parse(body);
    const result = await this.executor.execute(plan, op);
    return result;
  }
}
