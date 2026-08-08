// scripts/e2e/ops-web-runner.ts
// Root-runnable ops-web E2E runner. SSOT for the E2E environment is the Zod
// schema below (fail-fast, replacing the per-spec `?? 'pw'` fallbacks at the
// orchestration boundary -> critique #5). Before invoking Playwright the
// runner polls every readiness target (api /health/ready + ops-web base ->
// critique #6-residue), so a half-booted stack fails loudly with a clear
// message instead of as a confusing mid-suite ECONNRESET.
//
// Pure, unit-tested exports: opsWebE2EEnvSchema, readinessTargets.
// Side-effecting main() runs ONLY when this file is the entrypoint, so the
// test suite can import the pure parts without spawning Playwright.
//
// ENV READS USE BRACKET NOTATION (2026-08-08). process.env is an index
// signature, so dot access is TS4111 under noPropertyAccessFromIndexSignature.
// The reads below feed the schema parse, which is already the correct shape --
// only the access syntax changes. The flag stops a typo'd name from silently
// reading undefined, which here would surface as a confusing "invalid url"
// rather than "you did not set E2E_BASE_URL".
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const opsWebE2EEnvSchema = z.object({
  E2E_BASE_URL: z.url(),
  E2E_API_URL: z.url(),
  E2E_OPS_PASSWORD: z.string().min(1),
  // Reporter is part of the SSOT, not a baked-in spawn flag. Default 'list'
  // prints one settled line per test (✓ N spec:line › title (dur)); 'line'
  // is the compact rewriting single-line mode; 'dot'/'github'/'html'/'json'
  // are the other Playwright built-ins. Validated so a typo fails fast here
  // rather than as Playwright's confusing "No tests found".
  E2E_REPORTER: z
    .enum(['list', 'line', 'dot', 'github', 'html', 'json'])
    .default('list'),
});

export type OpsWebE2EEnv = z.infer<typeof opsWebE2EEnvSchema>;

// Pure: given a validated env, the exact URLs the runner must see healthy
// before it starts Playwright. api exposes /health/ready (200 = db up);
// ops-web is ready once its base URL serves (Next dev/start).
export function readinessTargets(env: OpsWebE2EEnv): readonly string[] {
  return [`${env.E2E_API_URL}/health/ready`, env.E2E_BASE_URL];
}

async function waitForTarget(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      // Any HTTP answer (incl. 3xx/4xx) means the listener is up; /health/ready
      // returns 200 specifically, ops-web base may 307 to a locale — both ready.
      if (res.status > 0) return;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`readiness timeout after ${String(timeoutMs)}ms for ${url}: ${lastErr}`);
}

async function main(): Promise<void> {
  const env = opsWebE2EEnvSchema.parse({
    E2E_BASE_URL: process.env['E2E_BASE_URL'],
    E2E_API_URL: process.env['E2E_API_URL'],
    E2E_OPS_PASSWORD: process.env['E2E_OPS_PASSWORD'],
  });
  for (const target of readinessTargets(env)) {
    process.stdout.write(`[e2e:ops-web] waiting for ${target} ...\n`);
    await waitForTarget(target);
    process.stdout.write(`[e2e:ops-web] ready: ${target}\n`);
  }
  const passthrough = process.argv.slice(2);
  process.stdout.write(`[e2e:ops-web] launching playwright ${passthrough.join(' ')}\n`);
  const child = spawn('pnpm', ['exec', 'playwright', 'test', `--reporter=${env.E2E_REPORTER}`, ...passthrough], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  child.on('exit', (code) => process.exit(code ?? 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
