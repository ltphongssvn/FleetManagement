// apps/ops-web/src/app/layout.tsx
// Root layout for App Router. RSC by default per Frozen Stack PDF.
// Routing/layout only -- feature logic lives in src/features.
//
// Auth-gated palette WITHOUT a hydration mismatch: this Server Component reads
// the session/refresh cookie and passes a stable  boolean into the
// CommandPalette client leaf. Because the server renders the SAME value the
// client hydrates with (props, not a client-side cookie read), there is no
// SignedIn/SignedOut-style flash or React #418 (2026 App Router guidance:
// server-component auth check -> prop -> client boundary at the leaf). The
// response is already per-request (cookies() opts the layout out of static
// caching), so the CDN never serves an authed-false shell to an authed user.
import type { ReactNode, JSX } from 'react';
import { cookies } from 'next/headers';
import Script from 'next/script';
import { cfBeaconScriptProps } from '@/features/analytics/cf-web-analytics';
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
  const beacon = cfBeaconScriptProps(process.env['NEXT_PUBLIC_CF_BEACON_TOKEN']);
  return (
    <html lang="en">
      <head>
        {beacon !== null ? (
          <Script
            src={beacon.src}
            strategy={beacon.strategy}
            data-cf-beacon={beacon['data-cf-beacon']}
          />
        ) : null}
      </head>
      <body>
        {children}
        <CommandPalette authed={authed} />
      </body>
    </html>
  );
}
