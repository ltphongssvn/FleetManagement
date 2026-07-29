// packages/design-tokens/src/react-native.ts
// React Native token adapter -- the platform token layer that extends the base
// SSOT for RN (2026 cross-platform pattern: one base token set, a platform
// layer per target). RN styles are unitless plain objects (ViewStyle/TextStyle)
// and the app screens read a FLAT color shape (colors.slate900, colors.backdrop,
// colors.white). This module presents that flat shape as an explicit const:
// EVERY value references the canonical palette, so the compiler rejects a
// non-existent stop and values can never drift from the SSOT; as const keeps the
// keys literal (autocomplete, no any). No mapped-type gymnastics for a fixed
// palette -- explicit + precise is the 2026-preferred, most readable form. Scale
// primitives pass through unchanged; semanticColors is re-exported to give RN a
// semantic path (the preferred way to reference colors going forward).
import {
  palette,
  spacing,
  radius,
  typography,
  fontSize,
  shadow,
  semanticColors,
} from './index.js';

export const colors = {
  slate50: palette.slate[50],
  slate100: palette.slate[100],
  slate200: palette.slate[200],
  slate300: palette.slate[300],
  slate400: palette.slate[400],
  slate500: palette.slate[500],
  slate600: palette.slate[600],
  slate700: palette.slate[700],
  slate800: palette.slate[800],
  slate900: palette.slate[900],
  slate950: palette.slate[950],
  indigo50: palette.indigo[50],
  indigo200: palette.indigo[200],
  indigo500: palette.indigo[500],
  indigo600: palette.indigo[600],
  indigo700: palette.indigo[700],
  indigo950: palette.indigo[950],
  sky50: palette.sky[50],
  violet950: palette.violet[950],
  red50: palette.red[50],
  red200: palette.red[200],
  red600: palette.red[600],
  red700: palette.red[700],
  green600: palette.green[600],
  amber500: palette.amber[500],
  white: palette.base.white,
  black: palette.base.black,
  backdrop: palette.slate[950],
} as const;

export { spacing, radius, typography, fontSize, shadow, semanticColors };
