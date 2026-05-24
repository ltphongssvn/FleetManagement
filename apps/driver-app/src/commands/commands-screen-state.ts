// apps/driver-app/src/commands/commands-screen-state.ts
// Pure presenter: turns a list of CommandPayload (the receiver inbox) into a
// UI view-model with humanized Vietnamese labels and newest-first ordering.
// No React, no I/O — testable in isolation.
import type { CommandPayload, CommandType } from "./command-receiver-policy.js";

const TYPE_LABEL_VI: Readonly<Record<CommandType, string>> = {
  assign_run: "Giao xe",
  reassign_run: "Chuyển xe",
  cancel_run: "Hủy chuyến",
  status_update: "Cập nhật trạng thái",
};

export interface CommandViewItem {
  readonly commandId: string;
  readonly typeLabel: string;
  readonly aggregateId: string;
  readonly roadRunId: string | null;
  readonly issuedAt: string;
}

export type CommandsViewModel =
  | { readonly kind: "empty" }
  | { readonly kind: "list"; readonly items: readonly CommandViewItem[] };

function extractRoadRunId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const v = (payload as Record<string, unknown>)["roadRunId"];
  return typeof v === "string" ? v : null;
}

export function presentCommands(inbox: readonly CommandPayload[]): CommandsViewModel {
  if (inbox.length === 0) return { kind: "empty" };
  const items: CommandViewItem[] = inbox.map((c) => ({
    commandId: c.commandId,
    typeLabel: TYPE_LABEL_VI[c.type],
    aggregateId: c.aggregateId,
    roadRunId: extractRoadRunId(c.payload),
    issuedAt: c.issuedAt,
  }));
  // Newest first (descending by issuedAt).
  items.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  return { kind: "list", items };
}
