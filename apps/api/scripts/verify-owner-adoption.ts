// apps/api/scripts/verify-owner-adoption.ts
// Manual verification harness for the deployed owner adoption dashboard
// endpoint. Fetches GET /owner/metrics/adoption from a running API with a
// supplied fleet-owner bearer token, validates the response against the
// @fleet/sync-protocol OwnerAdoptionMetricsSchema SSOT, and prints the funnel.
// Repeatable (a Turbo task), not an ad-hoc curl. Env:
//   API_URL             base URL (e.g. https://api-production-fd42.up.railway.app)
//   OWNER_BEARER_TOKEN  a Keycloak access token carrying the fleet-owner role
// Run: pnpm exec turbo run verify:owner-adoption --filter=@fleet/api
import { OwnerAdoptionMetricsSchema } from '@fleet/sync-protocol';

function readEnv(name: string): string {
  const raw: unknown = process.env[name];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('Missing required env var: ' + name);
  }
  return raw;
}

async function main(): Promise<void> {
  const apiUrl = readEnv('API_URL').replace(/\/+$/, '');
  const token = readEnv('OWNER_BEARER_TOKEN');
  const endpoint = apiUrl + '/owner/metrics/adoption';

  process.stdout.write('GET ' + endpoint + '\n');
  const res = await fetch(endpoint, { headers: { Authorization: 'Bearer ' + token } });

  process.stdout.write('HTTP ' + String(res.status) + ' ' + res.statusText + '\n');
  if (!res.ok) {
    const body = await res.text();
    process.stdout.write('BODY: ' + body + '\n');
    throw new Error('Endpoint returned non-OK status ' + String(res.status));
  }

  const raw: unknown = await res.json();
  const parsed = OwnerAdoptionMetricsSchema.safeParse(raw);
  if (!parsed.success) {
    process.stdout.write('SSOT VALIDATION FAILED: ' + parsed.error.message + '\n');
    throw new Error('Response does not match OwnerAdoptionMetricsSchema');
  }

  const m = parsed.data;
  process.stdout.write('SSOT VALIDATION: PASS\n');
  process.stdout.write('----- Adoption funnel (day ' + m.day + ') -----\n');
  process.stdout.write('  Tong tai xe (total):          ' + String(m.totalDrivers) + '\n');
  process.stdout.write('  Da dang ky thiet bi:          ' + String(m.deviceRegistered) + '\n');
  process.stdout.write('  Da cai dat ung dung:          ' + String(m.appInstalled) + '\n');
  process.stdout.write('  Chua cai dat (gap):           ' + String(m.notInstalled) + '\n');
  process.stdout.write('  Hoat dong hom nay:            ' + String(m.activeToday) + '\n');
  process.stdout.write('  asOf: ' + m.asOf + '\n');
}

main().catch((err: unknown) => {
  process.stderr.write('VERIFY FAILED: ' + (err instanceof Error ? err.message : String(err)) + '\n');
  process.exitCode = 1;
});
