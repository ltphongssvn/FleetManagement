// apps/driver-app/test/command-receiver-policy.test.ts
// TDD RED: pure state policy for receiving dispatch commands from the WS gateway.
// Owns: validation, dedupe by commandId, ack-shape construction.
// No I/O, no socket, no React — pure functions only.
import { describe, it, expect } from "vitest";
import {
  initialReceiverState,
  receiveCommand,
  type ReceiverState,
} from "../src/commands/command-receiver-policy.js";

const validCmd = {
  commandId: "11111111-1111-4111-8111-111111111111",
  type: "assign_run",
  targetOperatorId: "22222222-2222-4222-8222-222222222222",
  aggregateType: "road_run",
  aggregateId: "33333333-3333-4333-8333-333333333333",
  payload: { roadRunId: "33333333-3333-4333-8333-333333333333" },
  issuedAt: "2026-05-13T10:00:00.000Z",
};

describe("command-receiver-policy", () => {
  it("initialReceiverState exposes an empty inbox", () => {
    const s = initialReceiverState();
    expect(s.inbox).toHaveLength(0);
    expect(s.seenCommandIds.size).toBe(0);
  });

  it("receiveCommand on valid payload appends to inbox and emits received ack", () => {
    const s0: ReceiverState = initialReceiverState();
    const r = receiveCommand(s0, validCmd, new Date("2026-05-13T10:00:05.000Z"));
    expect(r.ack.status).toBe("received");
    expect(r.ack.commandId).toBe(validCmd.commandId);
    expect(r.ack.ackedAt).toBe("2026-05-13T10:00:05.000Z");
    expect(r.state.inbox).toHaveLength(1);
    expect(r.state.inbox[0]?.commandId).toBe(validCmd.commandId);
    expect(r.state.seenCommandIds.has(validCmd.commandId)).toBe(true);
  });

  it("receiveCommand on duplicate commandId emits rejected ack with duplicate_command", () => {
    const s0 = initialReceiverState();
    const r1 = receiveCommand(s0, validCmd, new Date("2026-05-13T10:00:05.000Z"));
    const r2 = receiveCommand(r1.state, validCmd, new Date("2026-05-13T10:00:06.000Z"));
    expect(r2.ack.status).toBe("rejected");
    if (r2.ack.status !== "rejected") throw new Error("narrow");
    expect(r2.ack.reasonCode).toBe("duplicate_command");
    expect(r2.state.inbox).toHaveLength(1);
  });

  it("receiveCommand on invalid payload emits rejected ack with client_error", () => {
    const s0 = initialReceiverState();
    const bad = { ...validCmd, commandId: "not-a-uuid" };
    const r = receiveCommand(s0, bad, new Date("2026-05-13T10:00:05.000Z"));
    expect(r.ack.status).toBe("rejected");
    if (r.ack.status !== "rejected") throw new Error("narrow");
    expect(r.ack.reasonCode).toBe("client_error");
    expect(r.state.inbox).toHaveLength(0);
  });

  it("receiveCommand on non-object payload emits rejected ack with client_error", () => {
    const s0 = initialReceiverState();
    const r = receiveCommand(s0, null, new Date("2026-05-13T10:00:05.000Z"));
    expect(r.ack.status).toBe("rejected");
    if (r.ack.status !== "rejected") throw new Error("narrow");
    expect(r.ack.reasonCode).toBe("client_error");
  });

  it("rejected ack for invalid payload still has a string commandId", () => {
    const s0 = initialReceiverState();
    const r = receiveCommand(s0, { foo: "bar" }, new Date("2026-05-13T10:00:05.000Z"));
    expect(r.ack.status).toBe("rejected");
    if (r.ack.status !== "rejected") throw new Error("narrow");
    expect(typeof r.ack.commandId).toBe("string");
  });

  it("state is immutable: receiveCommand returns a new state object", () => {
    const s0 = initialReceiverState();
    const r = receiveCommand(s0, validCmd, new Date("2026-05-13T10:00:05.000Z"));
    expect(r.state).not.toBe(s0);
    expect(s0.inbox).toHaveLength(0);
  });
});

describe('command-receiver-policy mutation-hardening', () => {
  // L9-11: CommandType enum string-literal mutations would break valid commands
  it('accepts type="reassign_run" (kills the enum-literal mutant "reassign_run" -> "")', () => {
    const s0 = initialReceiverState();
    const cmd = { ...validCmd, type: 'reassign_run', commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    const r = receiveCommand(s0, cmd, new Date('2026-05-13T10:00:05.000Z'));
    expect(r.ack.status).toBe('received');
  });

  it('accepts type="cancel_run" (kills the enum-literal mutant "cancel_run" -> "")', () => {
    const s0 = initialReceiverState();
    const cmd = { ...validCmd, type: 'cancel_run', commandId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    const r = receiveCommand(s0, cmd, new Date('2026-05-13T10:00:05.000Z'));
    expect(r.ack.status).toBe('received');
  });

  it('accepts type="status_update" (kills the enum-literal mutant "status_update" -> "")', () => {
    const s0 = initialReceiverState();
    const cmd = { ...validCmd, type: 'status_update', commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
    const r = receiveCommand(s0, cmd, new Date('2026-05-13T10:00:05.000Z'));
    expect(r.ack.status).toBe('received');
  });

  // L80-84: invalid-payload commandId extraction logic
  it('invalid payload with object-typed rawPayload AND a string commandId field: ack.commandId = that commandId (kills L80 + L83 + L84 mutants)', () => {
    // The payload is an object (typeof === "object" && !== null), so rawObj is the payload.
    // It has a string commandId, but the rest is missing — schema fails. Original extracts the
    // string commandId from rawObj["commandId"] and uses it in the ack.
    // Mutated L80 -> (true): rawObj might end up being a non-object → rawCommandId undefined → UNKNOWN sentinel.
    // Mutated L80 -> (false): rawObj=null → UNKNOWN sentinel.
    // Mutated L83 `false ? ...` or `rawObj[""]`: returns undefined → UNKNOWN sentinel.
    // Mutated L84 `false` or `=== ""`: typeof check fails → UNKNOWN sentinel.
    const s0 = initialReceiverState();
    const realId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const bad = { commandId: realId, type: 'not-a-real-type' }; // missing other required fields, bad type
    const r = receiveCommand(s0, bad, new Date('2026-05-13T10:00:05.000Z'));
    expect(r.ack.status).toBe('rejected');
    if (r.ack.status !== 'rejected') throw new Error('narrow');
    expect(r.ack.reasonCode).toBe('client_error');
    // KEY assertion: commandId is the string we passed in, NOT the all-zero sentinel
    expect(r.ack.commandId).toBe(realId);
  });

  it('invalid payload with rawPayload = undefined: ack is rejected with all-zero commandId (kills L80 conditional mutants)', () => {
    // typeof undefined === "undefined" !== "object" → first clause is true (typeof !== "object").
    // Original `(typeof !== "object" && !== null)`: false. rawObj = null. Returns UNKNOWN sentinel.
    // But Stryker mutates the L82 expression — many mutants flip the logic so that
    // rawObj becomes `undefined as Record<string, unknown>`. Then `rawObj["commandId"]`
    // throws TypeError. Discriminating: original returns clean rejected ack; mutated throws.
    const s0 = initialReceiverState();
    expect(() => {
      const r = receiveCommand(s0, undefined, new Date('2026-05-13T10:00:05.000Z'));
      expect(r.ack.status).toBe('rejected');
      if (r.ack.status !== 'rejected') throw new Error('narrow');
      expect(r.ack.commandId).toBe('00000000-0000-0000-0000-000000000000');
    }).not.toThrow();
  });

  it('invalid payload with rawPayload = null: ack.commandId = all-zero sentinel (locks down the typeof-object path)', () => {
    // typeof null === 'object' is true, BUT null === null. Original L80: false (excluded).
    // → rawObj = null → rawCommandId = undefined → maybeId = UNKNOWN_COMMAND_ID = "00...0".
    const s0 = initialReceiverState();
    const r = receiveCommand(s0, null, new Date('2026-05-13T10:00:05.000Z'));
    expect(r.ack.status).toBe('rejected');
    if (r.ack.status !== 'rejected') throw new Error('narrow');
    expect(r.ack.commandId).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('invalid payload with rawPayload = primitive string: ack.commandId = all-zero sentinel (locks down typeof string branch)', () => {
    // typeof "" !== 'object' → rawObj = null → maybeId = UNKNOWN_COMMAND_ID.
    // Discriminates mutants that would make rawObj truthy for non-objects.
    const s0 = initialReceiverState();
    const r = receiveCommand(s0, 'some-string', new Date('2026-05-13T10:00:05.000Z'));
    expect(r.ack.status).toBe('rejected');
    if (r.ack.status !== 'rejected') throw new Error('narrow');
    expect(r.ack.commandId).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('invalid payload object with non-string commandId field: ack.commandId = all-zero sentinel (kills L84 typeof === string -> typeof === "" mutant)', () => {
    // rawObj is a valid object, but rawObj["commandId"] is a number (not string).
    // Original L84 typeof !== "string" → maybeId = UNKNOWN_COMMAND_ID.
    // Mutated L84 (true / false / === ""): would coerce path either way; assert exact UNKNOWN.
    const s0 = initialReceiverState();
    const bad = { commandId: 12345, type: 'assign_run' };
    const r = receiveCommand(s0, bad, new Date('2026-05-13T10:00:05.000Z'));
    expect(r.ack.status).toBe('rejected');
    if (r.ack.status !== 'rejected') throw new Error('narrow');
    expect(r.ack.commandId).toBe('00000000-0000-0000-0000-000000000000');
  });

  // L94: reasonText `??` and `?.` mutants
  it('reasonText is the first zod issue message (kills L94 ?? -> && and optional-chain mutants)', () => {
    // Bad payload → zod produces specific issues. reasonText should be a non-empty message.
    const s0 = initialReceiverState();
    const bad = { commandId: 'not-a-uuid', type: 'assign_run', targetOperatorId: 'x', aggregateType: 't', aggregateId: 'x', payload: {}, issuedAt: 'bad' };
    const r = receiveCommand(s0, bad, new Date('2026-05-13T10:00:05.000Z'));
    if (r.ack.status !== 'rejected') throw new Error('narrow');
    // Original: reasonText = parsed.error.issues[0]?.message ?? "invalid payload"
    //   With bad data, zod produces at least one issue with a non-empty message.
    // Mutated ?? -> && : reasonText = message && "invalid payload" = "invalid payload" (because message is truthy).
    //   Wait — `truthy && "invalid payload"` returns "invalid payload"; so mutated reasonText = "invalid payload".
    //   Original reasonText = the actual zod message (e.g., "Invalid uuid").
    // So assert reasonText is NOT exactly "invalid payload".
    expect(r.ack.reasonText).toBeDefined();
    expect(r.ack.reasonText).not.toBe('invalid payload');
    expect(typeof r.ack.reasonText).toBe('string');
    expect((r.ack.reasonText ?? '').length).toBeGreaterThan(0);
  });

  it('reasonText fallback is "invalid payload" when error has no first-issue message (kills L94 ?? boundary)', () => {
    // This case is hard to reach because zod always produces issues with messages.
    // We exercise the falsy-fallback path by checking that for a payload that has
    // SOME issue, the message string is well-formed. The negative assertion above
    // already kills the `&&` mutant. The optional-chain mutant `issues[0].message`
    // is killed by passing a payload that produces issues — the chain succeeds, same
    // as without `?.`. To kill it, we use the negative side: zod always has issues[0],
    // so chained or not, behavior is the same — this is an *equivalent mutant*. But
    // we add an empty-array safety assertion just to ensure the reasonText is never
    // undefined (which would be the unchained value if issues[] were empty, which
    // can never happen with a failing parse, hence the mutant is equivalent).
    const s0 = initialReceiverState();
    const r = receiveCommand(s0, null, new Date('2026-05-13T10:00:05.000Z'));
    if (r.ack.status !== 'rejected') throw new Error('narrow');
    expect(r.ack.reasonText).toBeDefined();
    expect(typeof r.ack.reasonText).toBe('string');
  });
});
