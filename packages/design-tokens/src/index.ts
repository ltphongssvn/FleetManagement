// packages/design-tokens/src/index.ts
// Public barrel for @fleet/design-tokens. The ops-web Tailwind emitter and the
// React Native tokens emitter import the token SSOT from the package root; this
// file re-exports the full surface (base palette + scales, and the semantic
// role layer -- schemas, values, and z.infer types). Pure re-exports only;
// excluded from coverage (see vitest.config.ts).
export * from './tokens.js';
export * from './semantic.js';
