// apps/driver-app/src/theme/tokens.ts
// Shared design tokens — the driver-app's visual language, kept deliberately
// in lockstep with ops-web. ops-web is Tailwind (slate neutrals + indigo
// accent); React Native cannot consume Tailwind, so the same palette,
// spacing scale, radii and type scale are re-expressed here as plain
// constants. Any ops-web restyle should be mirrored here so the two apps
// keep an identical look and feel.
export const colors = {
  // slate neutrals (Tailwind slate-*)
  slate50: '#f8fafc',
  slate800: '#1e293b',
  slate950: '#020617',
  slate100: '#f1f5f9',
  slate200: '#e2e8f0',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
  slate600: '#475569',
  slate700: '#334155',
  slate900: '#0f172a',
  // indigo accent (Tailwind indigo-*)
  indigo50: '#eef2ff',
  indigo200: '#c7d2fe',
  indigo500: '#6366f1',
  indigo600: '#4f46e5',
  indigo700: '#4338ca',
  indigo950: '#1e1b4b',
  violet950: '#2e1065',
  // App backdrop. Matches ops-web's page background exactly: its AppShell
  // root is bg-slate-950 (#020617). ops-web layers a subtle gradient over
  // it, but the base slate-950 is the colour to match for the two apps to
  // look identical.
  backdrop: '#020617',
  // sky accent (gradient companion)
  sky50: '#f0f9ff',
  // semantic
  white: '#ffffff',
  red50: '#fef2f2',
  red200: '#fecaca',
  red600: '#dc2626',
  red700: '#b91c1c',
  green600: '#059669',
  // amber (Tailwind amber-*). amber50/amber700 back the "not yet available"
  // locked-action surface (e.g. the delivery-capture button while pickups are
  // incomplete): a calm advisory tone, deliberately NOT the red error palette.
  amber50: '#fffbeb',
  amber500: '#f59e0b',
  amber700: '#b45309',
} as const;

// 4px spacing scale (matches Tailwind's spacing rhythm).
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// border radii (Tailwind rounded-md / rounded-xl / rounded-2xl).
export const radius = {
  md: 6,
  lg: 12,
  xl: 16,
} as const;

// type scale.
export const typography = {
  title: { fontSize: 20, fontWeight: '700' as const },
  heading: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.6 },
  caption: { fontSize: 12, fontWeight: '400' as const },
} as const;

// reusable shadow (Tailwind shadow-sm / shadow-xl approximations).
export const shadow = {
  card: {
    shadowColor: colors.slate900,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
} as const;
