// scripts/e2e/stack-stop.ts
// Data-safe teardown of the fleet-pilot compose stack. STANDING RULE: never
// leave the 8-service stack idle holding ~1-2Gi resident on this 9.7Gi WSL box
// -- stop it after use. compose stop (NOT down) halts every container so its
// process memory is released, while networks + named volumes + container state
// survive for an instant on-demand restart (stack:restart / stack:up). SSOT =
// stackStopConfigSchema (fail-fast), composeProject pinned to the same
// 'fleet-pilot' identity stack-up.ts uses so this targets the exact same
// containers regardless of which worktree's compose file resolved them. The
// planner (stopComposeArgs) is pure + unit-tested; main() runs ONLY as the
// entrypoint (isEntry), so the contract test imports the pure parts without
// spawning docker -- identical discipline to stack-up.ts.
import { z } from 'zod';
import { spawnSync } from 'node:child_process';

export const stackStopConfigSchema = z.object({
  composeProject: z.string().min(1),
});
export type StackStopConfig = z.infer<typeof stackStopConfigSchema>;

// Same project identity as stack-up.ts (-p fleet-pilot).
export const defaultStopConfig: StackStopConfig = stackStopConfigSchema.parse({
  composeProject: 'fleet-pilot',
});

// Pure planner: the exact docker argv for a state-preserving stop, scoped to the
// project by -p. Deliberately 'stop' (retains containers/volumes/networks) and
// NEVER 'down'/-v, so a restart is instant and no data is destroyed.
export function stopComposeArgs(c: StackStopConfig): readonly string[] {
  return ['compose', '-p', c.composeProject, 'stop'];
}

// ---- side-effecting entrypoint ----
function main(): void {
  const c = defaultStopConfig;
  const args = stopComposeArgs(c);
  console.log('stopping compose project ' + c.composeProject + ' (data-safe; volumes + state retained) ...');
  const r = spawnSync('docker', [...args], { encoding: 'utf-8', stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('docker ' + args.join(' ') + ' failed');
    process.exit(1);
  }
  console.log('STACK STOPPED - restart on demand: pnpm run stack:restart (or stack:up)');
}

const isEntry = process.argv[1] !== undefined && import.meta.url === 'file://' + process.argv[1];
if (isEntry) {
  main();
}
