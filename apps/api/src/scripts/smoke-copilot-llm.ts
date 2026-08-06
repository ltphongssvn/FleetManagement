// apps/api/src/scripts/smoke-copilot-llm.ts
// Live smoke check for the copilot LLM boundary. Registered as a Turbo task
// rather than a throw-away CLI because its ABSENCE is why an HTTP 500 reached a
// dispatcher: the adapter carried 100 percent unit coverage while every test
// fed it an ALREADY-RESOLVED value, so nothing ever asked whether a REAL model
// reply parses. This costs one API call per utterance and covers the whole
// malformed-output class that expensive judge-style evals miss.
//
// It earned its keep twice on its first two runs: a live 400 (Schema type oneOf
// is not supported) that every unit test passed straight through, and a
// FABRICATED driver for unintelligible input, which is what added the escape
// hatch. Unit tests assert the REQUEST SHAPE; only a real call proves the
// provider accepts it and the model behaves.
//
// ESCAPE-USE RATE. The guidance behind the escape hatch is explicit that an
// escape value must be MEASURED, not assumed: schema compliance is a hard
// decoder constraint while abstention is only a soft preference, and whether a
// given model resolves that conflict honestly varies BY MODEL. So nonsense
// input is asserted to produce type unknown, and a fabricated command instead
// FAILS this check rather than passing quietly.
//
// Non-zero exit on any failure, so it gates a release. Reads only.
//
// Run: railway run --service api -- pnpm exec turbo run smoke:copilot-llm --filter=@fleet/api
import { z } from 'zod';
import { AnthropicCopilotLlmAdapter } from '../copilot/anthropic-copilot-llm.adapter.js';
import { toAnthropicJsonSchema } from '../copilot/anthropic-json-schema.js';

// Mirrors the planner DraftSchema. Duplicated deliberately and narrowly: the
// planner keeps its schema module-private and a smoke check must not force it
// public. Divergence that changes ACCEPTANCE would surface here as a failure.
const DraftCreateDriverSchema = z.strictObject({
  type: z.literal('create_driver'),
  fullName: z.string().min(1).max(200).describe('Ho ten day du cua tai xe'),
  phone: z.string().min(8).max(32).describe('So dien thoai, chi chu so'),
});
const DraftAssignSchema = z.strictObject({
  type: z.literal('assign_driver_to_vehicle'),
  driverName: z.string().min(1).max(200).describe('Ho ten tai xe can gan'),
  vehiclePlate: z.string().min(1).max(32).describe('Bien so xe dung nhu nguoi dung viet'),
});
const DraftUnknownSchema = z.strictObject({
  type: z.literal('unknown'),
});
const DraftSchema = z.strictObject({
  summaryVi: z.string().min(1).describe('Tom tat ngan bang tieng Viet'),
  commands: z
    .array(
      z.discriminatedUnion('type', [
        DraftCreateDriverSchema,
        DraftAssignSchema,
        DraftUnknownSchema,
      ]),
    )
    .min(1)
    .describe('It nhat mot lenh; dung type unknown khi khong hieu yeu cau'),
});

interface Case {
  readonly utterance: string;
  // Expected FIRST command type. 'unknown' asserts the model abstained rather
  // than fabricating -- the escape-use measurement.
  readonly expect: 'create_driver' | 'assign_driver_to_vehicle' | 'unknown';
}

const CASES: readonly Case[] = [
  { utterance: 'them tai xe Nguyen Van Test 0900000456', expect: 'create_driver' },
  {
    utterance: 'Them tai xe Nguyen Van B 0900000456 va gan vao xe 62H 05194',
    expect: 'create_driver',
  },
  { utterance: 'zzz khong hieu gi ca', expect: 'unknown' },
  { utterance: 'hom nay troi dep qua', expect: 'unknown' },
];

async function main(): Promise<void> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (apiKey === undefined || apiKey.trim().length === 0) {
    console.error('smoke:copilot-llm: ANTHROPIC_API_KEY is not set');
    process.exit(2);
  }
  const model = process.env['COPILOT_LLM_MODEL'] ?? 'claude-haiku-4-5-20251001';
  const schema = toAnthropicJsonSchema(
    z.toJSONSchema(DraftSchema, { io: 'output' }) as Record<string, unknown>,
  );
  const adapter = new AnthropicCopilotLlmAdapter({ apiKey, model });

  console.log('=== smoke:copilot-llm ===');
  console.log('model: ' + model);
  let failures = 0;
  for (const c of CASES) {
    const started = Date.now();
    let raw: unknown;
    try {
      raw = await adapter.proposeDraft(c.utterance, schema);
    } catch (err) {
      failures += 1;
      console.log('utterance : ' + c.utterance);
      console.log('  THREW   : ' + String(err));
      continue;
    }
    const elapsed = Date.now() - started;
    const parsed = DraftSchema.safeParse(raw);
    // A non-string raw proves JSON.parse succeeded; the adapter returns the raw
    // TEXT (a string) only when parsing failed.
    const jsonOk = typeof raw !== 'string';
    const firstType = parsed.success ? parsed.data.commands[0]?.type : undefined;
    const behaviourOk = firstType === c.expect;
    console.log('utterance : ' + c.utterance);
    console.log('  latency : ' + String(elapsed) + 'ms');
    console.log('  json    : ' + (jsonOk ? 'parsed' : 'NOT JSON (raw text returned)'));
    console.log('  schema  : ' + (parsed.success ? 'valid' : 'rejected -> planner clarifies'));
    console.log(
      '  command : expected ' +
        c.expect +
        ', got ' +
        String(firstType) +
        (behaviourOk ? '' : '  <-- MISMATCH'),
    );
    console.log('  payload : ' + JSON.stringify(raw).slice(0, 160));
    if (!jsonOk || !parsed.success || !behaviourOk) failures += 1;
  }
  console.log('');
  console.log(failures === 0 ? 'RESULT: PASS' : 'RESULT: FAIL (' + String(failures) + ')');
  process.exit(failures === 0 ? 0 : 1);
}

const invoked = process.argv[1] ?? '';
if (invoked.endsWith('smoke-copilot-llm.ts') || invoked.endsWith('smoke-copilot-llm.js')) {
  void main();
}
