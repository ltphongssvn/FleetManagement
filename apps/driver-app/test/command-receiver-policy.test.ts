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
