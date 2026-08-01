// apps/owner-app/src/theme/tokens.ts
// Thin re-export of the React Native token adapter from the design-token SSOT.
// Holds NO values of its own -- it forwards @fleet/design-tokens/react-native so
// this app theme can never drift from the single source of truth. (The previous
// hand-maintained copy had already diverged from ops-web and the sibling app --
// exactly the drift this removes.) The adapter presents the flat RN shape the
// screens import (colors / spacing / radius / typography / fontSize / shadow)
// derived from the canonical primitives; semanticColors is also available for
// the preferred semantic color path going forward.
export * from '@fleet/design-tokens/react-native';
