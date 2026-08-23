// apps/driver-app/src/manifest/sweep-bootstrap.ts
// Sweeps capture_spool/ on app start. Wraps pure sweepSpool policy with the
// I/O ports needed: list entries + remove an entry by captureId.
// PDF Day-One #2: "capture_spool/ with UUIDv7 at shutter; recovery sweep on app start".
import { sweepSpool, type SpoolEntry } from './capture-spool-policy.js';

export interface SpoolSweepDeps {
  readonly list: () => Promise<readonly SpoolEntry[]>;
  readonly remove: (captureId: string) => Promise<void>;
  readonly now?: () => number;
}

export interface SpoolSweepResult {
  readonly scanned: number;
  readonly resumed: number;
  readonly skipped: number;
  readonly abandoned: number;
  readonly cleaned: number;
}

export async function runSpoolSweepOnBoot(deps: SpoolSweepDeps): Promise<SpoolSweepResult> {
  const now = (deps.now ?? Date.now)();
  const entries = await deps.list();
  const decisions = sweepSpool(entries, now);
  let resumed = 0,
    skipped = 0,
    abandoned = 0,
    cleaned = 0;
  for (const d of decisions) {
    switch (d.classification.action) {
      case 'resume_upload':
        resumed++;
        break;
      case 'skip_in_progress':
        skipped++;
        break;
      case 'abandon':
        await deps.remove(d.entry.captureId);
        abandoned++;
        break;
      case 'cleanup':
        await deps.remove(d.entry.captureId);
        cleaned++;
        break;
    }
  }
  return { scanned: entries.length, resumed, skipped, abandoned, cleaned };
}
