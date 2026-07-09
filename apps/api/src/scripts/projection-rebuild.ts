// apps/api/src/scripts/projection-rebuild.ts
// CLI entry for the sanctioned projection rebuild (follow-up #5). Boots a
// minimal standalone Nest context (ProjectionRebuildModule — config+db+
// projections only, NO HTTP, NO OIDC/S3), resolves ProjectionRebuildService
// through DI, and rebuilds one scope's dispatch_board_projection from the
// event feed. DI ownership means the pg Pool is opened and closed by the
// framework (DatabaseModule.onModuleDestroy) around app.close().
//
// Invoke via the Turbo task:
//   pnpm exec turbo run projection:rebuild --filter=@fleet/api -- --scope <companyId>
// Scope defaults to FLEET_PILOT_SCOPE when --scope/positional is omitted.
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import { ProjectionRebuildModule } from '../projections/projection-rebuild.module.js';
import { ProjectionRebuildService } from '../projections/projection-rebuild.service.js';

const ScopeSchema = z.uuid();

function resolveScope(argv: readonly string[]): string {
  const flagIdx = argv.indexOf('--scope');
  const raw = flagIdx >= 0 ? argv[flagIdx + 1] : (argv[0] ?? process.env['FLEET_PILOT_SCOPE']);
  return ScopeSchema.parse(raw);
}

async function main(): Promise<void> {
  const scope = resolveScope(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(ProjectionRebuildModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const svc = app.get(ProjectionRebuildService);
    const result = await svc.rebuild(scope);
    process.stdout.write('PROJECTION_REBUILD_RESULT ' + JSON.stringify(result) + '\n');
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write('projection-rebuild failed: ' + (err instanceof Error ? err.message : String(err)) + '\n');
  process.exitCode = 1;
});
