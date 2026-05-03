// apps/api/test/commands.controller.validation.test.ts
// Verifies the inline-parse + ZodExceptionFilter pattern: malformed body
// throws ZodError (caught by global filter -> 400), not a 500.
import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import { CommandsController } from '../src/commands/commands.controller.js';
import type { CommandsService } from '../src/commands/commands.service.js';
import type { CommandsGateway } from '../src/commands/commands.gateway.js';
import type { OperatorContext } from '../src/auth/operator-context.js';

const OP: OperatorContext = {
  operatorId: '00000000-0000-0000-0000-0000000000a1',
  companyId: '00000000-0000-0000-0000-0000000000a2',
  businessUnitId: '00000000-0000-0000-0000-0000000000a3',
  depotId: '00000000-0000-0000-0000-0000000000a4',
  legalEntityId: '00000000-0000-0000-0000-0000000000a5',
};

function makeCtrl(): CommandsController {
  const svc = { persist: vi.fn() } as unknown as CommandsService;
  const gw = { pushCommand: vi.fn() } as unknown as CommandsGateway;
  return new CommandsController(gw, svc);
}

describe('@fleet/api - CommandsController validation (inline parse)', () => {
  it('throws ZodError (caught by global filter -> 400) on malformed body', async () => {
    const ctrl = makeCtrl();
    await expect(ctrl.issue({ commandId: 'not-a-uuid' }, OP)).rejects.toBeInstanceOf(ZodError);
  });

  it('throws ZodError on empty body', async () => {
    const ctrl = makeCtrl();
    await expect(ctrl.issue({}, OP)).rejects.toBeInstanceOf(ZodError);
  });

  it('throws ZodError on null body', async () => {
    const ctrl = makeCtrl();
    await expect(ctrl.issue(null, OP)).rejects.toBeInstanceOf(ZodError);
  });
});
