// apps/api/src/dispatch/dispatch-roster-split.controller.ts
// GET /dispatch/roster-split - the dispatched-vs-idle driver split the owner
// reads at the top of the Bang dieu phoi xe page.
//
// Thin pass-through to DispatchRosterSplitService. Tenancy comes from the JWT
// operator context via CurrentOperator and NEVER from a query string or body,
// mirroring DispatchController.getBoard: a caller must not be able to read
// another company roster by editing a URL.
//
// Guarded by JwtGuard only (NOT OwnerRoleGuard): the panel lives on the shared
// dispatcher board page, so dispatchers see the same split the owner does.
// That is deliberate - the point of the panel is that everyone sees which
// trucks are idle, which is what pushes dispatch into the app instead of Zalo.
//
// Response is the @fleet/sync-protocol DispatchRosterSplit SSOT; the type is
// inferred from the contract, never hand-written here.
import { Controller, Get, UseGuards } from '@nestjs/common';
import type { DispatchRosterSplit } from '@fleet/sync-protocol';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import { DispatchRosterSplitService } from './dispatch-roster-split.service.js';

@UseGuards(JwtGuard)
@Controller('dispatch')
export class DispatchRosterSplitController {
  constructor(private readonly svc: DispatchRosterSplitService) {}

  @Get('roster-split')
  async rosterSplit(@CurrentOperator() op: OperatorContext): Promise<DispatchRosterSplit> {
    return this.svc.split({ companyId: op.companyId });
  }
}
