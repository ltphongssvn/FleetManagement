// apps/api/src/manifest/completion-reconciler.service.ts
// Scheduled completion self-healing reconciler (T32 arc, 2026 level-based,
// tenant-iterating). Twin of IntakeReconcilerService (pure service, injected
// repo/knobs/clock, scheduler tick). Closes the structural gap proven from
// git history + scheduler read: the completion edge-trigger (#365) heals
// ONLY when the final manifest commits through finalizeIntake in-tx; the
// batch reconciler (L3) is MANUAL-only. Any run reaching all-committed via a
// bypass path strands started (Dang chay) with Kho giao hang photos and
// nothing scheduled healed it.
//
// ROOT-FIX (2026 multi-tenant boundary discipline): a background reconciler
// must NOT collapse all tenants into one FLEET_PILOT_SCOPE -- that silently
// strands every non-pilot tenant the moment a 2nd company exists (the same
// bug reintroduced). This tick DISCOVERS the distinct stranded tenants from
// the data (findStrandedTenants) and reconciles each under ITS OWN company
// scope, attributing road_run.completed to a synthetic system operator id so
// the audit trail records the real actor + tenant per 2026 auditability
// guidance. Idempotent by construction: a completed run leaves the finder
// set, so re-ticks repair zero.
// Synthetic system operator id for scheduled completion healing. Distinct,
// recognizable in the audit trail; sibling of the repair-scripts convention
// (…aa) but its own value (…bb) so tick-healed runs are attributable apart
// from the manual batch path.
export const COMPLETION_RECONCILE_OPERATOR_ID = '00000000-0000-0000-0000-0000000000bb';
export interface CompletionReconcileResult {
  readonly tenants: number;
  readonly repaired: number;
}
// Port: findStrandedTenants returns the distinct companyIds that currently
// have >=1 non-terminal run whose linked orders are ALL photo-committed.
// repairTenant drives every such run in ONE company started->completed via
// the guarded flip + appendTriWrite(road_run.completed), attributed to the
// system operator id, and returns the count actually moved (idempotent:
// already-terminal runs move 0).
export interface CompletionReconcileRepo {
  findStrandedTenants(limit: number): Promise<readonly string[]>;
  repairTenant(companyId: string, systemOperatorId: string, limit: number): Promise<number>;
}
export class CompletionReconcilerService {
  constructor(
    private readonly repo: CompletionReconcileRepo,
    private readonly afterMinutes: number,
    private readonly batchSize: number,
    private readonly now: () => number = Date.now,
  ) {}
  // afterMinutes + now are accepted for signature/config parity with the
  // intake reconciler and to gate future age-based eligibility; the finder
  // already scopes to delivered non-terminal runs, so the current tick
  // repairs the whole eligible set. Referenced so they are never unused.
  async reconcileOnce(): Promise<CompletionReconcileResult> {
    void this.afterMinutes;
    void this.now;
    const tenants = await this.repo.findStrandedTenants(this.batchSize);
    let repaired = 0;
    for (const companyId of tenants) {
      repaired += await this.repo.repairTenant(
        companyId,
        COMPLETION_RECONCILE_OPERATOR_ID,
        this.batchSize,
      );
    }
    return { tenants: tenants.length, repaired };
  }
}
