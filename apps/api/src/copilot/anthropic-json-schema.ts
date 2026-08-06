// apps/api/src/copilot/anthropic-json-schema.ts
// Zod -> Anthropic JSON Schema DIALECT ADAPTER.
//
// Anthropic strictly validates output_config.format.schema and accepts only a
// subset of JSON Schema. Zod z.toJSONSchema emits perfectly valid JSON Schema
// that the API nonetheless rejects. Observed live, not inferred:
//
//   HTTP 400 invalid_request_error
//   output_config.format.schema: Schema type 'oneOf' is not supported
//
// z.discriminatedUnion serializes as oneOf; Anthropic accepts anyOf. The two
// are equivalent here because a discriminated union is mutually exclusive by
// construction, so relaxing exactly-one to at-least-one cannot admit a value
// the original forbade. The provider SDK performs this sanitization
// internally, which is why SDK users never encounter it and a raw-fetch
// adapter (the house pattern) must do it explicitly.
//
// PURE and total: input schema in, adapted copy out, caller schema never
// mutated (the planner derives its schema once at module load and reuses that
// object on every request, so in-place mutation would corrupt it permanently).
// Kept separate from the adapter so the dialect rules are unit-testable with
// no network, and so the next provider quirk is one entry here rather than a
// patch smeared across the call site.
type Json = unknown;

function isPlainObject(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Keys stripped outright. $schema is a dialect marker the API does not expect;
// Zod emits it by default and it carries no constraint meaning for a compiled
// grammar.
const DROPPED_KEYS: readonly string[] = ['$schema'];

function adapt(node: Json): Json {
  if (Array.isArray(node)) {
    return node.map((child) => adapt(child));
  }
  if (!isPlainObject(node)) {
    return node;
  }
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_KEYS.includes(key)) {
      continue;
    }
    // The one rename. Recurse into the branches so a nested union is adapted
    // too -- the live failure was nested under commands.items, not at the root.
    if (key === 'oneOf') {
      out['anyOf'] = adapt(value);
      continue;
    }
    out[key] = adapt(value);
  }
  return out;
}

/**
 * Adapt a JSON Schema produced by Zod into the subset Anthropic accepts for
 * structured outputs. Returns a NEW object; the input is left untouched.
 */
export function toAnthropicJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return adapt(schema) as Record<string, unknown>;
}
