// apps/driver-app/test/commands-screen-state.test.ts
// TDD RED: pure presenter that turns the receiver inbox into a UI view-model
// (sorted, with humanized labels) for the commands screen.
import { describe, it, expect } from 'vitest';
import { presentCommands, type CommandsViewModel } from '../src/commands/commands-screen-state.js';
import type { CommandPayload } from '../src/commands/command-receiver-policy.js';

const cmdA: CommandPayload = {
  commandId: '11111111-1111-4111-8111-111111111111',
  type: 'assign_run',
  targetOperatorId: 'aa',
  aggregateType: 'road_run',
  aggregateId: 'rr-A',
  payload: { roadRunId: 'rr-A' },
  issuedAt: '2026-05-13T10:00:00.000Z',
};
const cmdB: CommandPayload = {
  ...cmdA,
  commandId: '22222222-2222-4222-8222-222222222222',
  aggregateId: 'rr-B',
  type: 'cancel_run',
  issuedAt: '2026-05-13T10:05:00.000Z',
};
const cmdC: CommandPayload = {
  ...cmdA,
  commandId: '33333333-3333-4333-8333-333333333333',
  aggregateId: 'rr-C',
  type: 'reassign_run',
  issuedAt: '2026-05-13T09:55:00.000Z',
};

describe('commands-screen-state', () => {
  it('empty inbox -> empty view model', () => {
    const vm: CommandsViewModel = presentCommands([]);
    expect(vm.kind).toBe('empty');
  });

  it('non-empty inbox -> list view model sorted newest-first', () => {
    const vm = presentCommands([cmdA, cmdB, cmdC]);
    expect(vm.kind).toBe('list');
    if (vm.kind !== 'list') throw new Error('narrow');
    // cmdB issued 10:05 (newest), cmdA 10:00, cmdC 09:55
    expect(vm.items[0]?.commandId).toBe(cmdB.commandId);
    expect(vm.items[1]?.commandId).toBe(cmdA.commandId);
    expect(vm.items[2]?.commandId).toBe(cmdC.commandId);
  });

  it('each item exposes a Vietnamese type label', () => {
    const vm = presentCommands([cmdA, cmdB, cmdC]);
    if (vm.kind !== 'list') throw new Error('narrow');
    const labelByCommandId = new Map(vm.items.map((it) => [it.commandId, it.typeLabel]));
    expect(labelByCommandId.get(cmdA.commandId)).toBe('Giao xe');
    expect(labelByCommandId.get(cmdB.commandId)).toBe('Hủy chuyến');
    expect(labelByCommandId.get(cmdC.commandId)).toBe('Chuyển xe');
  });

  it('unknown command type falls back to the raw type string', () => {
    const weird: CommandPayload = { ...cmdA, type: 'status_update' };
    const vm = presentCommands([weird]);
    if (vm.kind !== 'list') throw new Error('narrow');
    expect(vm.items[0]?.typeLabel).toBe('Cập nhật trạng thái');
  });

  it('returns a roadRunId convenience pulled from payload.roadRunId when present', () => {
    const vm = presentCommands([cmdA]);
    if (vm.kind !== 'list') throw new Error('narrow');
    expect(vm.items[0]?.roadRunId).toBe('rr-A');
  });

  it('roadRunId is null when payload lacks one', () => {
    const noRr: CommandPayload = { ...cmdA, payload: { foo: 'bar' } };
    const vm = presentCommands([noRr]);
    if (vm.kind !== 'list') throw new Error('narrow');
    expect(vm.items[0]?.roadRunId).toBeNull();
  });

  it('roadRunId is null when payload is null (line 27 right-side branch)', () => {
    const nullPayload: CommandPayload = { ...cmdA, payload: null };
    const vm = presentCommands([nullPayload]);
    if (vm.kind !== 'list') throw new Error('narrow');
    expect(vm.items[0]?.roadRunId).toBeNull();
  });

  it('roadRunId is null when payload is a non-object primitive (line 27 left-side branch)', () => {
    const primitivePayload: CommandPayload = { ...cmdA, payload: 'not-an-object' as never };
    const vm = presentCommands([primitivePayload]);
    if (vm.kind !== 'list') throw new Error('narrow');
    expect(vm.items[0]?.roadRunId).toBeNull();
  });

  it('roadRunId is null when payload.roadRunId is not a string', () => {
    const intRr: CommandPayload = { ...cmdA, payload: { roadRunId: 12345 } };
    const vm = presentCommands([intRr]);
    if (vm.kind !== 'list') throw new Error('narrow');
    expect(vm.items[0]?.roadRunId).toBeNull();
  });
});

describe('commands-screen-state mutation-hardening', () => {
  it('roadRunId is null when payload is undefined (kills L27 typeof !== object || === null -> false mutant)', () => {
    // Original L27: typeof undefined !== "object" is true → return null. Safe.
    // Mutated `false || payload === null`: false || undefined === null (false) → fall through.
    //   Then (undefined)["roadRunId"] → TypeError: Cannot read properties of undefined.
    // So with payload=undefined: original returns null cleanly; mutated throws.
    const undefPayload: CommandPayload = { ...cmdA, payload: undefined as never };
    expect(() => {
      const vm = presentCommands([undefPayload]);
      if (vm.kind !== 'list') throw new Error('narrow');
      expect(vm.items[0]?.roadRunId).toBeNull();
    }).not.toThrow();
  });
});
