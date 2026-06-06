// apps/api/test/e2e-no-driver-app-web-specs.test.ts
// Regression guard (ADR-005): the driver-app E2E surface is Maestro-on-release-
// APK (apps/driver-app/.maestro/*.yaml), NOT Playwright-on-React-Native-Web.
//
// History: the e2e/ Playwright suite once included driver-app specs that loaded
// a React Native Web bundle at DRIVER_APP_URL (http://localhost:8081) and
// asserted DOM hydration (getByText('Fleet Driver'), getByPlaceholder(...)).
// That premise was the Expo Go model. Under ADR-005 the driver-app runs as a
// RELEASE build for Maestro and its container serves `expo start --offline`
// (the NATIVE dev bundle) -- there is NO web route at :8081. Worse, the
// E2E (Playwright) workflow (.github/workflows/e2e.yml) brings up only
// postgres/redis/mock-oauth2/localstack/api/worker/ops-web -- it does NOT start
// driver-app at all -- so any spec hitting :8081 fails with ERR_CONNECTION_
// REFUSED and breaks the post-merge gate on develop/main (E2E run #51, 8db5dda).
//
// The 4 obsolete specs (driver-app-login, -diag, -capture,
// -multi-warehouse-capture) were retired; their business invariants are now
// covered by the migrated Maestro release-build flows
// (driver-login-assignment, driver-assigned-order-detail,
// driver-capture-proof-per-warehouse, driver-change-password).
//
// This guard fails if any e2e/ Playwright spec reintroduces a DRIVER_APP_URL /
// :8081 web dependency, so the web-vs-native surface split stays enforced: the
// e2e/ suite is ops-web ONLY; driver-app E2E is Maestro YAML.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const e2eDir = resolve(__dirname, '../../../e2e');

function specFiles(): string[] {
  return readdirSync(e2eDir).filter((f) => f.endsWith('.spec.ts'));
}

describe('e2e/ Playwright suite is ops-web only (no driver-app RNW web specs)', () => {
  it('no e2e spec references DRIVER_APP_URL (driver-app E2E is Maestro-on-APK, ADR-005)', () => {
    const offenders = specFiles().filter((f) =>
      readFileSync(resolve(e2eDir, f), 'utf8').includes('DRIVER_APP_URL'),
    );
    // Offenders listed in the failure diff itself; driver-app E2E is Maestro
    // (apps/driver-app/.maestro/*.yaml), so the e2e/ suite must not load a RNW
    // bundle -- e2e.yml does not start driver-app, so a :8081 spec breaks the gate.
    expect(offenders).toEqual([]);
  });

  it('no e2e spec hardcodes the metro web port 8081', () => {
    const offenders = specFiles().filter((f) =>
      readFileSync(resolve(e2eDir, f), 'utf8').includes('localhost:8081'),
    );
    // A driver-app web bundle at :8081 is not served by the E2E stack.
    expect(offenders).toEqual([]);
  });
});
