// apps/owner-app/src/theme/tokens.ts
// Shared design tokens - kept in lockstep with ops-web and driver-app (slate
// neutrals + indigo accent), re-expressed as plain RN constants.
export const colors = {
  slate50: '#f8fafc',
  slate100: '#f1f5f9',
  slate200: '#e2e8f0',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
  slate600: '#475569',
  slate700: '#334155',
  slate800: '#1e293b',
  slate900: '#0f172a',
  slate950: '#020617',
  indigo50: '#eef2ff',
  indigo200: '#c7d2fe',
  indigo500: '#6366f1',
  indigo600: '#4f46e5',
  indigo700: '#4338ca',
  backdrop: '#020617',
  white: '#ffffff',
  red200: '#fecaca',
  red600: '#dc2626',
  green600: '#059669',
  amber500: '#f59e0b',
} as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16, xl: 24 } as const;
export const fontSize = { sm: 13, base: 15, lg: 18, xl: 24, xxl: 34, huge: 56 } as const;
