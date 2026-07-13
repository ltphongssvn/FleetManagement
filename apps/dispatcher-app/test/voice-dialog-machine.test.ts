// apps/dispatcher-app/test/voice-dialog-machine.test.ts
// RED-first spec for the voice-dispatch dialog FSM (T17). Pure xstate v5
// logic, no Expo natives: STT/TTS/plan-execute are EVENTS injected by
// adapters, so the safety contract is testable in the unit lane.
// THE invariant this machine exists to guarantee: Tao lenh is TAP-ONLY.
// In the reviewing state, voice events (VOICE_CONFIRM, TRANSCRIPT) are
// no-ops -- only the TAP_TAO_LENH ui event may enter submitting, so the
// dispatcher consciously sends every order. Written before
// src/voice/voice-dialog-machine.ts exists -> fails at import resolution.
import { describe, expect, it } from 'vitest';
import { createActor, type Actor } from 'xstate';
import type { CopilotPlan } from '@fleet/sync-protocol';
import { voiceDialogMachine } from '../src/voice/voice-dialog-machine.js';
const GUID_A = 'a3bb189e-8bf9-4888-9912-ace4e6543002';
const GUID_B = 'b4cc290f-9c0a-4999-aa23-bdf5f7654113';
const PLAN: CopilotPlan = {
  planId: GUID_A,
  summaryVi: 'Sẽ tạo lệnh điều xe 62H-05194 cho Nguyễn Văn A',
  commands: [{ type: 'create_cargo_type', commandId: GUID_B, name: 'Gạo' }],
};
function startActor(): Actor<typeof voiceDialogMachine> {
  const actor = createActor(voiceDialogMachine);
  actor.start();
  return actor;
}
function driveToReviewing(): Actor<typeof voiceDialogMachine> {
  const actor = startActor();
  actor.send({ type: 'START_LISTENING' });
  actor.send({ type: 'TRANSCRIPT', text: 'Điều xe 62H 05194' });
  actor.send({ type: 'PLAN_OK', plan: PLAN });
  actor.send({ type: 'TTS_DONE' });
  return actor;
}
describe('@fleet/dispatcher-app voiceDialogMachine', () => {
  it('starts idle and enters listening on the mic tap', () => {
    const actor = startActor();
    expect(actor.getSnapshot().value).toBe('idle');
    actor.send({ type: 'START_LISTENING' });
    expect(actor.getSnapshot().value).toBe('listening');
  });
  it('stores the transcript and moves to planning', () => {
    const actor = startActor();
    actor.send({ type: 'START_LISTENING' });
    actor.send({ type: 'TRANSCRIPT', text: 'Điều xe' });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('planning');
    expect(snap.context.transcript).toBe('Điều xe');
  });
  it('speaks the plan summary then reaches reviewing with the plan held', () => {
    const actor = driveToReviewing();
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('reviewing');
    expect(snap.context.plan?.planId).toBe(GUID_A);
  });
  it('INVARIANT: voice can never submit -- only TAP_TAO_LENH leaves reviewing', () => {
    const actor = driveToReviewing();
    actor.send({ type: 'VOICE_CONFIRM' });
    expect(actor.getSnapshot().value).toBe('reviewing');
    actor.send({ type: 'TRANSCRIPT', text: 'đồng ý tạo lệnh' });
    expect(actor.getSnapshot().value).toBe('reviewing');
    actor.send({ type: 'TAP_TAO_LENH' });
    expect(actor.getSnapshot().value).toBe('submitting');
  });
  it('clarify loops back to listening after the question is spoken', () => {
    const actor = startActor();
    actor.send({ type: 'START_LISTENING' });
    actor.send({ type: 'TRANSCRIPT', text: 'Điều xe' });
    actor.send({ type: 'PLAN_CLARIFY', questionVi: 'Xe nào?' });
    expect(actor.getSnapshot().value).toBe('clarifying');
    expect(actor.getSnapshot().context.questionVi).toBe('Xe nào?');
    actor.send({ type: 'TTS_DONE' });
    expect(actor.getSnapshot().value).toBe('listening');
  });
  it('cancel from reviewing returns to idle and drops the plan', () => {
    const actor = driveToReviewing();
    actor.send({ type: 'TAP_CANCEL' });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('idle');
    expect(snap.context.plan).toBeNull();
  });
});
