// scripts/e2e/stack-restart.ts
// Rebuild + recreate a single Docker Compose service from scratch (no cache,
// force recreate). Mirrors the mandatory build invariants documented in
// stack-up.ts (docker builder prune + --no-cache + --force-recreate) but
// scoped to ONE service so an ops-web-only code change does not re-spend
// 3+ minutes rebuilding api/worker images.
//
// Usage: pnpm run stack:restart -- <service>   (e.g. ops-web | api | worker)
// SSOT = z.enum of permitted services; fail-fast on typos.
import { z } from 'zod';
import { spawnSync } from 'node:child_process';

const Service = z.enum(['api', 'worker', 'ops-web']);
type Service = z.infer<typeof Service>;

function sh(cmd: string, args: readonly string[], opts: { quiet?: boolean } = {}): void {
  const r = spawnSync(cmd, [...args], { encoding: 'utf-8', stdio: opts.quiet ? 'pipe' : 'inherit' });
  if (r.status !== 0) {
    const tail = r.stderr ? (':\n' + r.stderr) : '';
    console.error('X ' + cmd + ' ' + args.join(' ') + ' failed' + tail);
    process.exit(1);
  }
}

function main(): void {
  // pnpm may forward the '--' separator literally as a positional arg; accept
  // both 'pnpm run stack:restart -- ops-web' and 'pnpm run stack:restart ops-web'.
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const raw = argv[0];
  const parsed = Service.safeParse(raw);
  if (!parsed.success) {
    console.error('Usage: pnpm run stack:restart -- <api|worker|ops-web>');
    process.exit(2);
  }
  const svc: Service = parsed.data;
  console.log('docker builder prune -af (no stale layers) ...');
  sh('docker', ['builder', 'prune', '-af'], { quiet: true });
  console.log('building --no-cache: ' + svc);
  sh('docker', ['compose', 'build', '--no-cache', svc]);
  console.log('up -d --force-recreate: ' + svc);
  sh('docker', ['compose', 'up', '-d', '--force-recreate', svc]);
  console.log('OK: ' + svc + ' rebuilt and recreated');
}

const isEntry = process.argv[1] !== undefined && import.meta.url === 'file://' + process.argv[1];
if (isEntry) { main(); }
