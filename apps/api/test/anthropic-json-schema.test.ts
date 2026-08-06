// apps/api/test/anthropic-json-schema.test.ts
// Spec for the Zod -> Anthropic JSON Schema dialect adapter.
//
// WHY THIS EXISTS. Anthropic strictly validates output_config.format.schema and
// accepts only a subset of JSON Schema. Zod z.toJSONSchema emits valid JSON
// Schema that the API nonetheless rejects. Proven live, not assumed:
//   HTTP 400 invalid_request_error
//   output_config.format.schema: Schema type 'oneOf' is not supported
// z.discriminatedUnion emits oneOf; Anthropic accepts anyOf. The provider SDK
// performs this sanitization internally, which is why SDK users never see it
// and a raw-fetch adapter must do it explicitly.
//
// Kept as a PURE function so the dialect rules are unit-testable without a
// network call, and so a future provider quirk is a table change there rather
// than a scattered patch at the call site.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toAnthropicJsonSchema } from '../src/copilot/anthropic-json-schema.js';

const DQ = String.fromCharCode(34);

describe('toAnthropicJsonSchema', () => {
  it('rewrites oneOf to anyOf (the live 400 that blocked structured outputs)', () => {
    const input = {
      type: 'object',
      properties: {
        cmd: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      },
    };
    const out = toAnthropicJsonSchema(input);
    expect(JSON.stringify(out)).not.toContain('oneOf');
    const cmd = (out['properties'] as Record<string, Record<string, unknown>>)['cmd'];
    expect(cmd?.['anyOf']).toEqual([{ type: 'string' }, { type: 'number' }]);
  });

  it('rewrites oneOf at every depth, not just the top level', () => {
    const input = {
      type: 'object',
      properties: {
        list: {
          type: 'array',
          items: { oneOf: [{ type: 'object' }, { type: 'null' }] },
        },
      },
    };
    const out = toAnthropicJsonSchema(input);
    expect(JSON.stringify(out)).not.toContain('oneOf');
    expect(JSON.stringify(out)).toContain('anyOf');
  });

  it('drops the $schema dialect marker Anthropic does not expect', () => {
    const input = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' };
    const out = toAnthropicJsonSchema(input);
    expect(out['$schema']).toBeUndefined();
    expect(out['type']).toBe('object');
  });

  it('preserves additionalProperties false, which the provider REQUIRES', () => {
    const input = { type: 'object', additionalProperties: false, properties: {} };
    const out = toAnthropicJsonSchema(input);
    expect(out['additionalProperties']).toBe(false);
  });

  it('preserves descriptions, which guide generation', () => {
    const input = {
      type: 'object',
      properties: { name: { type: 'string', description: 'Ho ten day du' } },
    };
    const out = toAnthropicJsonSchema(input);
    const name = (out['properties'] as Record<string, Record<string, unknown>>)['name'];
    expect(name?.['description']).toBe('Ho ten day du');
  });

  it('does not mutate the caller schema (the planner reuses it every request)', () => {
    const input = { type: 'object', properties: { c: { oneOf: [{ type: 'string' }] } } };
    const before = JSON.stringify(input);
    toAnthropicJsonSchema(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('converts a real discriminated-union DraftSchema into an accepted shape', () => {
    // The exact structure that produced the live 400.
    const Draft = z.strictObject({
      summaryVi: z.string().min(1).describe('Tom tat ngan bang tieng Viet'),
      commands: z
        .array(
          z.discriminatedUnion('type', [
            z.strictObject({
              type: z.literal('create_driver'),
              fullName: z.string().min(1).max(200).describe('Ho ten day du cua tai xe'),
              phone: z.string().min(8).max(32).describe('So dien thoai, chi chu so'),
            }),
            z.strictObject({
              type: z.literal('assign_driver_to_vehicle'),
              driverName: z.string().min(1).max(200).describe('Ho ten tai xe can gan'),
              vehiclePlate: z.string().min(1).max(32).describe('Bien so xe'),
            }),
          ]),
        )
        .min(1),
    });
    const raw = z.toJSONSchema(Draft, { io: 'output' }) as Record<string, unknown>;
    const serialized = JSON.stringify(raw);
    // Guard the premise: if Zod stops emitting oneOf this spec must be revisited.
    expect(serialized).toContain('oneOf');

    const out = toAnthropicJsonSchema(raw);
    const outSerialized = JSON.stringify(out);
    expect(outSerialized).not.toContain('oneOf');
    // The JSON-encoded key, built without escapes so no backslash reaches disk.
    expect(outSerialized).not.toContain(DQ + '$schema' + DQ);
    expect(out['type']).toBe('object');
    expect(out['additionalProperties']).toBe(false);
    expect(outSerialized).toContain('Ho ten day du cua tai xe');
  });
});
