// apps/ops-web/src/app/layout.tsx
// Root layout for App Router. RSC by default per Frozen Stack PDF.
// Routing/layout only -- feature logic lives in src/features.
//
// Auth-gated palette WITHOUT a hydration mismatch: this Server Component reads
// the session/refresh cookie and passes a stable authed boolean into the
// CommandPalette client leaf. Because the server renders the SAME value the
// client hydrates with (props, not a client-side cookie read), there is no
// SignedIn/SignedOut-style flash or React #418.
//
// No Cloudflare Web Analytics beacon is self-hosted here. The domain is
// proxied through Cloudflare, so edge analytics already measure every request
// without a client beacon. A manual next/script beacon was previously rendered
// in <head>, but on a proxied domain it POSTs to the cross-origin
// cloudflareinsights.com/cdn-cgi/rum endpoint, which 404s and is CORS-blocked
// (zero analytics value), and it participated in hydration. Edge auto-injection
// is separately prevented by the Cache-Control: no-transform header set in
// proxy.ts, so with the manual beacon removed there is no beacon in the tree at
// all -> server and client match -> no #418.
import type { ReactNode, JSX } from 'react';
import { cookies } from 'next/headers';
import './globals.css';
import { CommandPalette } from '@/features/copilot/command-palette';
export const metadata = {
  title: 'Fleet Ops',
  description: 'Intermodal Fleet Platform -- Dispatcher Console',
};
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const store = await cookies();
  const authed = store.has('fleet_session') || store.has('fleet_refresh');
  return (
    <html lang="en">
      <body>
        {children}
        <CommandPalette authed={authed} />
      </body>
    </html>
  );
}
