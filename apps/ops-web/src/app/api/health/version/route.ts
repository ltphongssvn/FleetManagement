// apps/ops-web/src/app/api/health/version/route.ts
// Build-provenance self-report: which COMMIT of ops-web is live.
//
// WHY IT EXISTS. railway-deploy already stamps GIT_SHA on this service
// (deploy-stamp --stamp --service ops-web), but nothing read it back: the
// ops-web deploy was gated ONLY by /login returning 200, and the PREVIOUS
// container answers that perfectly after a failed deploy. Liveness cannot tell
// "new version live" from "old version still serving", so ops-web could sit a
// release behind while CI reported success -- exactly the failure that
// deploy-stamp --verify was built to catch, until now wired to api alone.
//
// WHY A ROUTE HANDLER. It runs SERVER-SIDE, so process.env is read at request
// time. No Dockerfile change, and no NEXT_PUBLIC_ prefix -- the sha never
// enters the client bundle. proxy.ts excludes api/health from the auth matcher
// (see its matcher), so CI probes this unauthenticated exactly as it probes
// api /health/version.
//
// Minimal and unauthenticated BY DESIGN, matching api: sha, shortSha, branch
// and buildTime only -- no paths, no dependency versions, nothing that widens
// the surface. The payload shape and the env rules come from
// @fleet/sync-protocol, because api and the worker answer the SAME contract
// and one CI gate parses all three.
import { NextResponse } from 'next/server';
import { buildDeployVersion } from '@fleet/sync-protocol';

// Read env at REQUEST time, never at module load. Next would otherwise capture
// the build-time environment, so a variable the platform injects at runtime
// would never be seen and this endpoint would report the wrong commit forever.
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  const version = buildDeployVersion(process.env, () => new Date().toISOString());
  // no-store is load-bearing: a cached provenance response would let CI verify
  // a STALE sha and pass a deploy that never landed -- precisely the false
  // green this endpoint exists to prevent.
  return NextResponse.json(version, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
