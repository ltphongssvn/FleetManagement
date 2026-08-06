// apps/api/test/copilot-planner-escape.test.ts
// RED-first spec for the ESCAPE HATCH in DraftSchema.
//
// WHY. Constrained decoding compiles the schema into a grammar and mechanically
// forbids any token sequence that violates it. commands is required with at
// least one entry and every member carries a concrete action type, so the model
// has NO grammatical way to report that a request was unintelligible. Observed
// live against the real API with the input zzz khong hieu gi ca:
//
//   {"summaryVi":"Yeu cau khong ro rang...",
//    "commands":[{"type":"create_driver","fullName":"Unknown","phone":"0000000000"}]}
//
// A fabricated driver, structurally perfect and schema-valid. This is the
// documented escape-less-enum anti-pattern: schema compliance is a HARD
// constraint enforced at the decoder while abstention is only a soft
// preference, so when the two conflict the constraint wins. Prompting cannot
// fix it; the schema must offer a truthful option.
//
// ASSERTION DISCIPLINE. Asserting merely kind === clarify would pass TODAY for
// the wrong reason: DraftSchema rejects the unknown member, safeParse fails,
// and the planner returns the GENERIC clarify. A test that passes before the
// feature exists proves nothing. So these specs pin the MESSAGE, which only
// the escape path produces.
import { describe, expect, it, vi } from 'vitest';
import type { OperatorContext } from '@fleet/domain';
import {
  CLARIFY_UNCLEAR,
  CopilotPlannerService,
  type CopilotCatalogPort,
  type CopilotLlmPort,
} from '../src/copilot/copilot-planner.service.js';

const OP: OperatorContext = {
  operatorId: 'f8aa6d43-daf4-4ddd-8e67-f139cba98557',
  companyId: 'f9bb7e54-eb05-4eee-8f78-a24adcba9668',
  businessUnitId: 'aacc8f65-fc16-4aff-8a89-b35bedcba779',
  depotId: 'bbdd9a76-ad27-4b00-9b9a-c46cfedcb88a',
  legalEntityId: 'ccee0b87-be38-4c11-8cab-d57dafedc99b',
};
const D1 = 'a3bb189e-8bf9-4888-9912-ace4e6543002';
const V1 = 'c5dd3a10-ad1b-4aaa-bb34-ce06f8765224';

function catalog(): CopilotCatalogPort {
  return {
    drivers: vi.fn(() =>
      Promise.resolve([
        { driverId: D1, operatorId: OP.operatorId, fullName: 'Nguyen Van A', phone: '0900000123' },
      ]),
    ),
    vehiclesAdmin: vi.fn(() => Promise.resolve([{ id: V1, label: '62H05194' }])),
  };
}

function llmReturning(payload: unknown): CopilotLlmPort {
  return { proposeDraft: vi.fn(() => Promise.resolve(payload)) };
}

describe('CopilotPlannerService escape hatch', () => {
  it('accepts an unknown command as a VALID draft shape and clarifies with its own message', async () => {
    // If DraftSchema rejected this the model would have no grammatical way to
    // abstain -- the condition that manufactures a fabricated driver.
    const draft = {
      summaryVi: 'Khong hieu yeu cau',
      commands: [{ type: 'unknown' }],
    };
    const svc = new CopilotPlannerService(catalog(), llmReturning(draft));
    const out = await svc.plan('zzz khong hieu gi ca', OP);
    expect(out.kind).toBe('clarify');
    if (out.kind === 'clarify') {
      expect(out.questionVi).toBe(CLARIFY_UNCLEAR);
    }
  });

  it('clarifies rather than planning when ANY command in the draft is unknown', async () => {
    // Mixed drafts must not half-execute: one unintelligible clause makes the
    // whole utterance ambiguous, and the palette never guesses.
    const draft = {
      summaryVi: 'Mot phan khong ro',
      commands: [
        { type: 'create_driver', fullName: 'Nguyen Van B', phone: '0900000456' },
        { type: 'unknown' },
      ],
    };
    const svc = new CopilotPlannerService(catalog(), llmReturning(draft));
    const out = await svc.plan('them tai xe roi lam gi do la', OP);
    expect(out.kind).toBe('clarify');
    if (out.kind === 'clarify') {
      expect(out.questionVi).toBe(CLARIFY_UNCLEAR);
    }
  });

  it('still plans normally when no command is unknown (escape must not swallow good drafts)', async () => {
    const draft = {
      summaryVi: 'Se tao tai xe',
      commands: [{ type: 'create_driver', fullName: 'Nguyen Van B', phone: '0900000456' }],
    };
    const svc = new CopilotPlannerService(catalog(), llmReturning(draft));
    const out = await svc.plan('them tai xe Nguyen Van B 0900000456', OP);
    expect(out.kind).toBe('plan');
  });

  it('keeps the escape message distinct from the generic parse-failure clarify', async () => {
    // The two must never collapse into one string: they mean different things
    // operationally (the model abstained vs the draft was malformed) and the
    // logs plus these specs depend on telling them apart.
    const svc = new CopilotPlannerService(catalog(), llmReturning({ garbage: true }));
    const out = await svc.plan('cai gi do', OP);
    expect(out.kind).toBe('clarify');
    if (out.kind === 'clarify') {
      expect(out.questionVi).not.toBe(CLARIFY_UNCLEAR);
    }
  });
});
