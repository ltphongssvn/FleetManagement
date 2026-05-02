// apps/api/src/database/migrations-runner.ts
// Runs Drizzle migrations on API boot when DB_AUTO_MIGRATE=true.
// Pure: env + migrate fn injected; testable without real Postgres.
export interface MigrationsRunnerInput {
  readonly env: Record<string, string | undefined>;
  readonly migrate: () => Promise<void>;
}

export interface MigrationsRunnerResult {
  readonly executed: boolean;
}

export async function runMigrationsIfEnabled(input: MigrationsRunnerInput): Promise<MigrationsRunnerResult> {
  if (input.env['DB_AUTO_MIGRATE'] === 'true') {
    await input.migrate();
    return { executed: true };
  }
  return { executed: false };
}
