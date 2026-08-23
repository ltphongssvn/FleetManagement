// FleetManagement/scripts/bump-pnpm.ts
// Root task: bump the repo-wide corepack-pinned pnpm version.
//
// Why this exists (root cause, 2026-07-06):
//   This box's pnpm global bin dir is not on PATH, so 'pnpm add -g pnpm'
//   fails with ERR -- and even where it works it mutates ONE machine only.
//   The repo pins pnpm via the packageManager field (corepack), so the
//   monorepo-correct bump is 'corepack use pnpm@<version|latest>', which
//   resolves the version, downloads it into the corepack cache, and
//   rewrites packageManager (pin + sha512) in package.json itself (2026
//   canonical). Refuses on a dirty tree so the pin change is always an
//   isolated, reviewable commit. Idempotent: re-run at same version no-ops.
//
// CJS constraint (root package has no type:module, tsx transpiles CJS):
//   NO top-level await -- synchronous execFileSync + main(): number +
//   process.exit(main()), the exact sibling pattern of sync-develop.ts.
//
// Related files:
//   - turbo.jsonc  (//#bump:pnpm task)
//   - package.json (bump:pnpm script; packageManager pin this rewrites)
// Run: pnpm exec turbo run bump:pnpm [-- <version>]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const nl = String.fromCharCode(10);
function out(s: string): void {
  process.stdout.write('[bump:pnpm] ' + s + nl);
}
function err(s: string): void {
  process.stderr.write('[bump:pnpm] ' + s + nl);
}

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function pin(): string {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { packageManager?: string };
  return pkg.packageManager ?? 'NOT SET';
}

function main(): number {
  const version = process.argv[2] ?? 'latest';
  const dirty = run('git', ['status', '--porcelain']);
  if (dirty !== '') {
    err('REFUSED: working tree not clean. Commit or stash first.');
    return 1;
  }
  const before = pin();
  out('current pin: ' + before);
  out('running corepack use pnpm@' + version + ' ...');
  const useOut = run('corepack', ['use', 'pnpm@' + version]);
  if (useOut !== '') process.stdout.write(useOut + nl);
  const after = pin();
  out('new pin: ' + after);
  if (after === before) {
    out('already at the requested version -- nothing changed.');
  }
  const v = run('pnpm', ['--version']);
  out('pnpm --version now reports: ' + v);
  if (!after.startsWith('pnpm@' + v)) {
    err('MISMATCH: pin ' + after + ' vs runtime ' + v);
    return 1;
  }
  out('done.');
  return 0;
}
process.exit(main());
