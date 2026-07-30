// apps/ops-web/src/app/admin/layout.tsx
// Segment layout: every route under /admin wears the AppShell.
//
// ROOT CAUSE THIS REMOVES. AppShell was mounted PER PAGE -- hand-imported and
// hand-rendered inside app/page.tsx and app/dispatch/orders/[id]/page.tsx. A
// shell that each author must remember to wrap will eventually be forgotten,
// and it was: /admin/co-so-du-lieu never mounted it, so the page rendered on
// the default white body while its text used the on-dark token roles. The
// heading Co so du lieu was white-on-white and INVISIBLE IN PRODUCTION, and
// the page fell outside the nav entirely -- reachable only by the shell link
// at AppShell.tsx line 32, which pointed at a page that did not wear it.
//
// Retro-fitting on-light colours onto that page would have hidden the symptom
// and left the mechanism intact, guaranteeing the next admin route repeats it.
// A segment layout is the App Router primitive for exactly this: it wraps all
// routes at its level and below, so /admin/drivers and /admin/reference are
// covered too, and any future admin route is covered before it is written.
//
// Reading cookies here opts the segment into dynamic rendering. That costs
// nothing: app/page.tsx already declares force-dynamic, every ops-web route
// builds as server-rendered-on-demand, and the whole app sits behind Keycloak.
// If an admin route ever needs static/PPR, the shell should become static and
// the username stream in via a Suspense child instead.
//
// Routing/layout only -- feature logic lives in src/features.
import type { ReactNode, JSX } from 'react';
import { AppShell } from '@/features/shell/AppShell';
import { getSessionUsername } from '@/features/auth/session';

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const username = await getSessionUsername();
  return (
    <AppShell {...(username ? { username } : {})}>
      {children}
    </AppShell>
  );
}
