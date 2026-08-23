// scripts/e2e/stack-up.ts
// From-scratch E2E stack bring-up. SSOT = stackUpConfigSchema (fail-fast). Pure,
// unit-tested planners (composeServices / readinessProbes / androidPlan) describe
// the verified sequence: build images -> compose up (health-gated; api self-
// migrates via DB_AUTO_MIGRATE) -> boot the AVD with KVM -> install the release
// APK -> adb reverse tcp:3000. Side-effecting main() runs ONLY as entrypoint, so
// the contract test imports the pure parts without spawning docker/emulator.
import { z } from 'zod';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

export const stackUpConfigSchema = z.object({
  composeProject: z.string().min(1),
  apiUrl: z.url(),
  opsWebUrl: z.url(),
  avd: z.string().min(1),
  device: z.string().min(1),
  apkPath: z.string().regex(/\.apk$/, 'apkPath must point to an .apk'),
  driverPackageId: z.string().min(1),
  includeOpsWeb: z.boolean().default(true),
  includeAndroid: z.boolean().default(true),
});
export type StackUpConfig = z.infer<typeof stackUpConfigSchema>;

// Dependency-safe order: all infra (healthchecked) before api; worker+ops-web last.
// driver-app is intentionally excluded (phone/LAN-only, not core bring-up).
export function composeServices(c: StackUpConfig): readonly string[] {
  const core = ['postgres', 'redis', 'mock-oauth2', 'localstack', 'api', 'worker'];
  return c.includeOpsWeb ? [...core, 'ops-web'] : core;
}

export function readinessProbes(c: StackUpConfig): readonly string[] {
  const probes = [`${c.apiUrl}/health/ready`];
  if (c.includeOpsWeb) probes.push(c.opsWebUrl);
  return probes;
}

export interface AndroidPlan {
  readonly avd: string;
  readonly device: string;
  readonly apkPath: string;
  readonly packageId: string;
  readonly reverse: { readonly from: string; readonly to: string };
}
/** The port the api is actually served on, from the configured URL. */
export function apiPort(c: StackUpConfig): string {
  return new URL(c.apiUrl).port || '3000';
}

export function androidPlan(c: StackUpConfig): AndroidPlan {
  return {
    avd: c.avd,
    device: c.device,
    apkPath: c.apkPath,
    packageId: c.driverPackageId,
    // Derived from the api URL, never hardcoded: on a worktree using 3010 a
    // fixed tcp:3000 forwarded the WRONG port and the driver app silently
    // talked to another worktree's api.
    reverse: { from: 'tcp:' + apiPort(c), to: 'tcp:' + apiPort(c) },
  };
}

export const defaultConfig: StackUpConfig = stackUpConfigSchema.parse({
  composeProject: 'fleet-pilot',
  apiUrl: 'http://localhost:3000',
  opsWebUrl: 'http://localhost:3001',
  avd: 'fleet_e2e',
  device: 'emulator-5554',
  apkPath: 'apps/driver-app/android/app/build/outputs/apk/release/app-release.apk',
  driverPackageId: 'com.fleetmanagement.driver',
});
// Local dev override: compose-identity.ts writes per-worktree ports into .env,
// which docker compose reads but this process does not. stack:up therefore
// probed localhost:3000 whatever the worktree used, and reported a healthy
// stack belonging to ANOTHER worktree -- or a live one as broken.
//
// The environment is a PARAMETER, not process.env read inside: the function is
// then pure and unit-testable, and callers stay explicit about where the values
// come from. Falls back to defaultConfig field by field, so CI (1:1 port
// mapping, none of these set) is unaffected.
export function envConfig(env: Readonly<Record<string, string | undefined>>): StackUpConfig {
  const port = (k: string, fallback: string): string => {
    const v = env[k];
    return v !== undefined && v.length > 0 ? v : fallback;
  };
  const project = env['FLEET_COMPOSE_PROJECT'];
  return stackUpConfigSchema.parse({
    ...defaultConfig,
    composeProject:
      project !== undefined && project.length > 0 ? project : defaultConfig.composeProject,
    apiUrl: 'http://localhost:' + port('FLEET_PORT_API', '3000'),
    opsWebUrl: 'http://localhost:' + port('FLEET_PORT_OPS_WEB', '3001'),
    includeAndroid: env['FLEET_SKIP_ANDROID'] === '1' ? false : defaultConfig.includeAndroid,
  });
}

/** Load .env into a plain map for envConfig. Side-effecting, entrypoint only. */
export function loadWorktreeEnv(): Readonly<Record<string, string | undefined>> {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* no .env: defaults apply */
  }
  return process.env;
}

// ---- side-effecting helpers (entrypoint only) ----
function sh(cmd: string, args: string[], opts: { quiet?: boolean } = {}): void {
  const r = spawnSync(cmd, args, { encoding: 'utf-8', stdio: opts.quiet ? 'pipe' : 'inherit' });
  if (r.status !== 0) {
    console.error(`❌ ${cmd} ${args.join(' ')} failed${r.stderr ? `:\n${r.stderr}` : ''}`);
    process.exit(1);
  }
}
function out(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: 'utf-8' });
  return r.status === 0 ? r.stdout.trim() : '';
}
async function waitHttp(url: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status > 0) {
        console.log(`✅ ready: ${url}`);
        return;
      }
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.error(`❌ readiness timeout for ${url}: ${last}`);
  process.exit(1);
}

// ANDROID_HOME first, then ANDROID_SDK_ROOT, then the conventional home path.
// That order is Android's own documented rule -- ANDROID_HOME wins when set,
// ANDROID_SDK_ROOT is the fallback -- and it is current: ANDROID_SDK_ROOT was
// briefly the preferred name around 2018-2021 (hence the Bazel/Flutter issues
// arguing the reverse), but the deprecation flipped back and ANDROID_HOME is
// the preferred variable as of 2026. Do not "modernise" this precedence.
//
// Bracket notation because process.env is an index signature (TS4111 under
// noPropertyAccessFromIndexSignature); behaviour is unchanged.
//
// KNOWN GAP, not fixed here: Android's rule also falls through when
// ANDROID_HOME is DEFINED BUT INVALID, whereas ?? accepts any non-empty string.
// Closing that needs a filesystem check inside this helper, which is a
// behaviour change in untested side-effecting code -- out of scope for a
// type-debt burn-down. Note also that envConfig above takes the environment as
// a PARAMETER for exactly this testability reason; sdkBin is the one function
// in this file that reads process.env directly.
function sdkBin(name: string): string {
  const home =
    process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT'] ?? `${homedir()}/Android/Sdk`;
  const sub = name === 'emulator' ? `emulator/${name}` : `platform-tools/${name}`;
  return `${home}/${sub}`;
}

async function bootEmulator(plan: AndroidPlan): Promise<void> {
  const running = out('adb', ['devices']).includes(plan.device);
  if (!running) {
    const emu = sdkBin('emulator');
    console.log(`🔌 booting ${plan.avd} (${plan.device}) ...`);
    const child = spawn(
      emu,
      [
        '-avd',
        plan.avd,
        '-no-window',
        '-no-snapshot',
        '-no-boot-anim',
        '-gpu',
        'swiftshader_indirect',
        '-no-audio',
      ],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
  }
  sh('adb', ['start-server'], { quiet: true });
  if (spawnSync('timeout', ['120', 'adb', 'wait-for-device']).status !== 0) {
    console.error('❌ device never attached');
    process.exit(1);
  }
  for (let i = 0; i < 60; i++) {
    if (
      out('adb', ['-s', plan.device, 'shell', 'getprop', 'sys.boot_completed']).replace(
        /\r/g,
        '',
      ) === '1'
    ) {
      console.log('✅ emulator booted');
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  for (const [ns, k] of [
    ['global', 'window_animation_scale'],
    ['global', 'transition_animation_scale'],
    ['global', 'animator_duration_scale'],
  ] as const) {
    spawnSync('adb', ['-s', plan.device, 'shell', 'settings', 'put', ns, k, '0']);
  }
  spawnSync('adb', [
    '-s',
    plan.device,
    'shell',
    'settings',
    'put',
    'secure',
    'hide_error_dialogs',
    '1',
  ]);
  console.log(`📦 installing ${plan.apkPath} ...`);
  sh('adb', ['-s', plan.device, 'install', '-r', '-d', plan.apkPath]);
  const pkgs = out('adb', ['-s', plan.device, 'shell', 'pm', 'list', 'packages']);
  if (!pkgs.includes(plan.packageId)) {
    console.error(`❌ ${plan.packageId} not installed after install`);
    process.exit(1);
  }
  spawnSync('adb', ['-s', plan.device, 'reverse', plan.reverse.from, plan.reverse.to]);
  console.log(
    `✅ ${plan.packageId} installed; adb reverse ${plan.reverse.from} -> ${plan.reverse.to}`,
  );
}

async function main(): Promise<void> {
  const c = envConfig(loadWorktreeEnv());
  const services = composeServices(c);
  const built = services.filter((svc) => ['api', 'worker', 'ops-web'].includes(svc));
  // MANDATORY build sequence (no exceptions): cached layers have shipped stale
  // builds that were tested as if fixed. Always prune the builder, build
  // --no-cache, and up --force-recreate so what runs is exactly this source.
  console.log('🧹 docker builder prune -af (no stale layers) ...');
  sh('docker', ['builder', 'prune', '-af'], { quiet: true });
  console.log(`🏗️  building --no-cache: ${built.join(', ')}`);
  sh('docker', ['compose', 'build', '--no-cache', ...built]);
  console.log('🚀 up --force-recreate (health-gated; api self-migrates) ...');
  sh('docker', ['compose', 'up', '-d', '--force-recreate', ...services]);
  // Next 16 standalone needs a moment to bind 3001 even after healthchecks pass.
  console.log('⏳ settle ~6s before readiness probes ...');
  await new Promise((r) => setTimeout(r, 6000));
  for (const url of readinessProbes(c)) await waitHttp(url);
  if (c.includeAndroid) await bootEmulator(androidPlan(c));
  console.log(
    '\n✅ STACK UP — api + ops-web healthy' +
      (c.includeAndroid ? ', emulator booted + driver APK installed' : ''),
  );
  console.log('   ops-web E2E:  pnpm run e2e:ops-web');
  console.log('   driver E2E:   pnpm tsx scripts/e2e/driver-maestro.mts');
}

const isEntry = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  void main();
}
