// apps/api/src/scripts/inspect-order-state.ts
// Read-only inspector (T16 completion-routing arc). Boots the same standalone
// ProjectionRebuildModule context repair-ghost-runs uses (config + database,
// no HTTP), resolves drizzle via DI, and prints a transport order's actual
// server-side state: the transport_order row, every linked road_run (state +
// started_at/completed_at), and the last N append-path events for those runs.
// MUTATES NOTHING -- diagnosis only. Anchored output lines (INSPECT_*) for grep.
//
// Invoke via the Turbo task:
//   pnpm exec turbo run inspect:order-state --filter=@fleet/api -- --ref XTT.07-020
import { NestFactory } from "@nestjs/core";
import { z } from "zod";
import { eq, desc, inArray } from "drizzle-orm";
import { ProjectionRebuildModule } from "../projections/projection-rebuild.module.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import type { FleetDb } from "../database/database.module.js";
import { transportOrder, roadRun, roadRunTransportOrder } from "../database/schema/transport.js";
import { manifest } from "../database/schema/manifest.js";
import { fleetAuditLog } from "../database/schema/append-paths.js";

function bigintSafe(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

const RefSchema = z.string().min(1);

function argValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const runFlag = argValue(argv, "--run");
  const refFlag = argValue(argv, "--ref");
  const app = await NestFactory.createApplicationContext(ProjectionRebuildModule, {
    logger: ["error", "warn"],
  });
  try {
    const db = app.get<FleetDb>(DRIZZLE_DB);
    let ref: string;
    if (runFlag !== undefined) {
      const runId = z.uuid().parse(runFlag);
      const linkRows = await db
        .select({ orderId: roadRunTransportOrder.transportOrderId })
        .from(roadRunTransportOrder)
        .where(eq(roadRunTransportOrder.roadRunId, runId));
      process.stdout.write("INSPECT_RUN_LINKS " + JSON.stringify(linkRows, bigintSafe) + "\n");
      const firstLink = linkRows[0];
      if (firstLink === undefined) {
        process.stdout.write("INSPECT_RESULT run-has-no-linked-order" + "\n");
        return;
      }
      const orderRows = await db.select({ r: transportOrder.externalRef }).from(transportOrder).where(eq(transportOrder.transportOrderId, firstLink.orderId));
      ref = RefSchema.parse(orderRows[0]?.r);
    } else {
      ref = RefSchema.parse(refFlag);
    }
    const orders = await db
      .select()
      .from(transportOrder)
      .where(eq(transportOrder.externalRef, ref));
    process.stdout.write("INSPECT_ORDER " + JSON.stringify(orders, bigintSafe) + "\n");
    const order = orders[0];
    if (order === undefined) {
      process.stdout.write("INSPECT_RESULT no-order-for-ref" + "\n");
      return;
    }
    const orderId = order.transportOrderId;
    const links = await db
      .select()
      .from(roadRunTransportOrder)
      .where(eq(roadRunTransportOrder.transportOrderId, orderId));
    process.stdout.write("INSPECT_LINKS " + JSON.stringify(links, bigintSafe) + "\n");
    const runIds = links.map((l) => l.roadRunId);
    if (runIds.length === 0) {
      process.stdout.write("INSPECT_RESULT order-has-no-linked-run" + "\n");
      return;
    }
    const runs = await db
      .select()
      .from(roadRun)
      .where(inArray(roadRun.roadRunId, runIds));
    process.stdout.write("INSPECT_RUNS " + JSON.stringify(runs, bigintSafe) + "\n");
    const manifests = await db
      .select({
        manifestId: manifest.manifestId,
        state: manifest.state,
        stopId: manifest.stopId,
        committedAt: manifest.committedAt,
        createdAt: manifest.createdAt,
      })
      .from(manifest)
      .where(eq(manifest.transportOrderId, orderId));
    process.stdout.write("INSPECT_MANIFESTS " + JSON.stringify(manifests, bigintSafe) + "\n");
    const events = await db
      .select()
      .from(fleetAuditLog)
      .where(inArray(fleetAuditLog.aggregateId, runIds))
      .orderBy(desc(fleetAuditLog.createdAt))
      .limit(20);
    process.stdout.write("INSPECT_EVENTS " + JSON.stringify(events, bigintSafe) + "\n");
    const runStates = runs.map((r) => r.state);
    process.stdout.write("INSPECT_RESULT " + JSON.stringify({ orderState: order.state, runStates }, bigintSafe) + "\n");
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack !== undefined ? err.stack : "";
  process.stderr.write("INSPECT_ERROR msg=" + msg + "\n");
  process.stderr.write("INSPECT_STACK " + stack + "\n");
  // Full own-property dump (includes any nested cause chain) -- this is how
  // the drizzle-wrapped pg cause (e.g. password auth failure) is surfaced.
  const full = err instanceof Error ? JSON.stringify(err, Object.getOwnPropertyNames(err)) : "";
  process.stderr.write("INSPECT_FULL " + full + "\n");
  process.exitCode = 1;
});
