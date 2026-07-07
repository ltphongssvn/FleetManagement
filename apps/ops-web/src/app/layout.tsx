// apps/ops-web/src/app/layout.tsx
// Root layout for App Router. RSC by default per Frozen Stack PDF.
// Routing/layout only — feature logic lives in src/features.
import type { ReactNode, JSX } from 'react';
import './globals.css';
import { CommandPalette } from '@/features/copilot/command-palette';

export const metadata = {
  title: 'Fleet Ops',
  description: 'Intermodal Fleet Platform — Dispatcher Console',
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>
        {children}
        <CommandPalette />
      </body>
    </html>
  );
}
