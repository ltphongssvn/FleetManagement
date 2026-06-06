// scripts/e2e/driver-maestro.ts
// Execa-driven driver-app release-build Maestro E2E harness (replaces the prior
// Python subprocess wrappers; stays inside the pnpm + TypeScript monorepo).
// Run: pnpm tsx scripts/e2e/driver-maestro.ts
//
// Cycle: seed an active driver (playwright spec) -> read the handoff artifact ->
// reactivate the seed (global-teardown deactivates E2E drivers; the Maestro run
// is a separate process AFTER teardown, so it owns its seed) -> adb reverse
// (the only address that reaches the api from the WSL2 emulator) -> run the
// release Maestro flow -> on failure, copy the failure-moment screenshots to the
// Windows Desktop and LOOK. See docs/adr/005-android-e2e-release-build.md.
import { execa } from 'execa';
import { readFileSync, copyFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname_esm = dirname(fileURLToPath(import.meta.url));
const WT = resolve(__dirname_esm, '../..');
const DEVICE = 'emulator-5554';
const SPEC = 'e2e/dispatcher-to-driver-fulfillment.spec.ts';
const FLOW = 'apps/driver-app/.maestro/driver-login-assignment.yaml';
const PG = 'fleet-pilot-postgres-1';
const env = { ...process.env };

function log(section: string, msg: string): void {
  console.log('\n=== ' + section + ' ===\n' + msg);
}

async function seed(): Promise<{ phone: string; password: string; orderRef: string; vehicleLabel: string }> {
  const r = await execa(
    'pnpm',
    ['exec', 'playwright', 'test', SPEC, '--reporter=list'],
    { cwd: WT, env: { ...env, E2E_BASE_URL: 'http://localhost:3001', E2E_API_URL: 'http://localhost:3000', E2E_OPS_PASSWORD: 'pw' }, reject: false, all: true },  // pragma: allowlist secret
  );
  log('seed', 'RC=' + r.exitCode);
  if (r.exitCode !== 0) {
    console.log(r.all);
    throw new Error('seed failed');
  }
  const handoff = JSON.parse(readFileSync(join(WT, '.e2e-artifacts/driver-handoff.json'), 'utf8')) as { driverPhone: string; driverPassword: string; orderRef: string; vehicleLabel: string };
  log('seed', 'phone=' + handoff.driverPhone + ' pw=' + handoff.driverPassword);
  return { phone: handoff.driverPhone, password: handoff.driverPassword, orderRef: handoff.orderRef, vehicleLabel: handoff.vehicleLabel };
}

async function reactivate(phone: string): Promise<void> {
  const r = await execa('docker', ['exec', PG, 'psql', '-U', 'fleet', '-d', 'fleet', '-c', "UPDATE driver SET active=true WHERE phone='" + phone + "';"], { reject: false, all: true });
  log('reactivate', r.all ?? '');
}

async function adbReverse(): Promise<void> {
  await execa('adb', ['-s', DEVICE, 'reverse', 'tcp:3000', 'tcp:3000'], { reject: false });
  const r = await execa('adb', ['-s', DEVICE, 'reverse', '--list'], { reject: false, all: true });
  log('adb reverse', r.all ?? '');
}

// Suppress the system_server ANR dialog ("Process system isn't responding").
// On the headless WSL2 swiftshader emulator system_server stalls under load and
// throws this modal repeatedly, occluding the app and blocking Maestro gesture
// injection. hide_error_dialogs=1 stops it rendering at the source. This is a
// per-emulator `settings` value that does NOT persist across a fresh AVD/CI
// emulator, so it must be applied here on every run. See
// context/android-emulator-system-anr-hide-error-dialogs.md.
async function ensureEmulatorSettings(): Promise<void> {
  await execa('adb', ['-s', DEVICE, 'shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1'], { reject: false });
  const r = await execa('adb', ['-s', DEVICE, 'shell', 'settings', 'get', 'global', 'hide_error_dialogs'], { reject: false, all: true });
  log('hide_error_dialogs', (r.all ?? '').trim());
}

async function runFlow(phone: string, password: string, orderRef: string, vehicleLabel: string): Promise<number> {
  const r = await execa('maestro', ['test', FLOW], { cwd: WT, env: { ...env, MAESTRO_DRIVER_PHONE: phone, MAESTRO_DRIVER_PASSWORD: password, MAESTRO_ORDER_REF: orderRef, MAESTRO_VEHICLE_LABEL: vehicleLabel }, reject: false, all: true });
  log('maestro', (r.all ?? '') + '\nRC=' + r.exitCode);
  return r.exitCode ?? 1;
}

function copyScreens(): void {
  const base = join(homedir(), '.maestro/tests');
  if (!existsSync(base)) return;
  const runs = readdirSync(base).map((d) => join(base, d)).filter((d) => statSync(d).isDirectory());
  if (runs.length === 0) return;
  const latest = runs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  const pngs = readdirSync(latest).filter((f) => f.endsWith('.png')).map((f) => join(latest, f));
  const usersDir = '/mnt/c/Users';
  const desks = existsSync(usersDir) ? readdirSync(usersDir).map((u) => join(usersDir, u, 'Desktop')).filter((d) => existsSync(d)) : [];
  for (const png of pngs) {
    for (const desk of desks) copyFileSync(png, join(desk, 'rel6_' + basename(png)));
  }
  log('screens', latest + '\n' + pngs.map((f) => basename(f)).join('\n'));
}

async function main(): Promise<void> {
  const { phone, password, orderRef, vehicleLabel } = await seed();
  await reactivate(phone);
  await adbReverse();
  await ensureEmulatorSettings();
  const rc = await runFlow(phone, password, orderRef, vehicleLabel);
  if (rc !== 0) {
    copyScreens();
    process.exitCode = 1;
  } else {
    log('result', 'FLOW GREEN');
  }
}

void main();
