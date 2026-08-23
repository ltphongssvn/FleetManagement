# Cloudflare beacon vs React 19 hydration (#418) -- Jul 2026

Production-only React error #418 (hydration mismatch) on the dispatch board, invisible in dev and
CI. Two separate beacons caused it, in sequence, and the first fix created the second failure.
Recorded so the pattern is not re-derived.

## Symptom

Hard React #418 in the browser console at xe.vominhchau.com, never locally. Dev and CI render an
identical tree server and client; only production sits behind a Cloudflare proxy, so only production
had a third party editing the HTML after the origin had finished with it.

## Root cause 1: edge auto-injection

Cloudflare Web Analytics RUM auto-injects beacon.min.js as the LAST child of

<body>, at the edge, for browser requests only. React 19 compares the client
DOM against the server-rendered tree and THROWS on the extra node; React 18
only warned, which is why the class of bug surfaced on the 19 upgrade.

Deterministic evidence, not inference: a browser-UA curl of /login showed beacon count HEAD:1 (the
app own server-rendered one) but BODY:2 (the extra edge one). cf-cache-status DYNAMIC proved a live
per-request transform rather than a stale cached document. The response Cache-Control carried no
no-transform directive, so the proxy was free to rewrite the body.

## Fix 1: Cache-Control no-transform (PR #273)

Per Cloudflare documentation a response carrying Cache-Control: no-transform is never modified by
the proxy, so the beacon is not auto-injected.

Why NOT next.config headers(): the root layout calls cookies(), which marks every route dynamic, and
Next stamps its own private/no-store Cache-Control that OVERRIDES next.config headers() for dynamic
routes (vercel/next.js issue 89439). proxy.ts response headers ARE honored, so the fix lives there:
passThroughNoTransform() merges no-transform into the Cache-Control of the two HTML document
pass-throughs (public /login and the authenticated app). JSON, redirect, RSC and Server-Action
responses are left untouched -- they carry no HTML body for the edge to inject into.

This guard is durable regardless of the Cloudflare dashboard RUM setting, which was observed to keep
auto-injecting even after switching to manual snippet mode and purging cache. Dashboard state is not
a contract; the header is.

## Root cause 2: the self-hosted beacon that replaced it

An earlier attempt (PR #263) had tried to dodge the edge injection by rendering the beacon OURSELVES
via next/script in the root layout <head>, so server and client would agree. That traded one defect
for another: a MANUAL beacon reports to the cross-origin cloudflareinsights.com/cdn-cgi/rum
endpoint, which returned 404 and was CORS-blocked. The beacon therefore delivered ZERO analytics
while still participating in hydration -- #418 persisted after fix 1.

## Fix 2: remove the beacon entirely (PR #283)

The deciding insight: the domain is proxied through Cloudflare, so a client Web Analytics beacon is
the WRONG TOOL. Cloudflare edge analytics already measure every request with no client script at
all. Deleted features/analytics/cf-web-analytics.ts, its test, the <Script> block in the root
layout, and the now-dead NEXT_PUBLIC_CF_BEACON_TOKEN env entry.

Combined with no-transform from fix 1 there is now NO beacon in the document: the edge cannot inject
one and the app does not render one. Server and client render identically, #418 is eliminated, and
the 404/CORS console noise is gone. Analytics remain available on the Cloudflare dashboard.

## Transferable rules

1. A production-only hydration error means something BETWEEN the origin and the browser is editing
   the HTML. Look at the proxy before the app code.
2. Prove it with a browser-UA curl and a node count, not by reading code. The edge only injects for
   browser user agents, so a default curl shows nothing.
3. React 19 THROWS where 18 warned. Any third-party script injection that was survivable before the
   upgrade is now fatal.
4. Do not answer an injected-node mismatch by rendering the same node yourself. That is
   symmetry-by-duplication and it hides a second defect -- here, a beacon posting to an endpoint
   that 404s.
5. Ask whether the client-side tool is needed at all. Behind a CDN that already measures every
   request at the edge, a RUM beacon adds hydration risk and no data.
6. For dynamic Next.js routes, next.config headers() loses to the framework own Cache-Control. Set
   document response headers in proxy.ts.

## Guard

apps/ops-web/test/proxy\*.test.ts assert that the /login and authenticated pass-throughs carry
no-transform and that JSON/redirect/RSC/Server-Action responses do not. Root layout carries a
comment stating no beacon is self-hosted and why, so a future reader does not re-add one.
