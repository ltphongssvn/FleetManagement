// apps/ops-web/test/proxy-no-req-url-redirect-guard.test.ts
// STRUCTURAL GUARD (T11 idle-timeout arc): the auth middleware must NEVER
// build a browser redirect Location from req.url / req.nextUrl -- behind
// Railway those carry the container internal bind (0.0.0.0:3001), so the
// browser gets https://0.0.0.0:3001/... (ERR_ADDRESS_INVALID). This exact
// facet slipped past the first arc because the route-only forwarder guard
// does not scan proxy.ts. Redirects MUST build against publicOrigin(req).
// Comments are stripped before matching (a NextResponse.redirect that
// appears only in explanatory prose is not a violation).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlocks
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');
}

describe('proxy.ts must not redirect to req.url (public-origin only)', () => {
  it('contains no new URL(..., req.url) / req.nextUrl redirect base', () => {
    const src = stripComments(readFileSync(join(process.cwd(), 'src', 'proxy.ts'), 'utf-8'));
    // A redirect base is new URL(<path>, <base>). The only legal base in a
    // browser-facing redirect here is publicOrigin(req). Flag req.url /
    // req.nextUrl used as the SECOND argument of new URL(...).
    const badBases = /new URL\([^)]*,\s*req\.(url|nextUrl)/.test(src);
    expect(badBases, 'proxy redirect built from req.url leaks 0.0.0.0; use publicOrigin(req)').toBe(
      false,
    );
    // And it must import the SSOT it is required to use.
    expect(src.includes('publicOrigin')).toBe(true);
  });
});
