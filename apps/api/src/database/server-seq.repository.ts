// apps/api/src/database/server-seq.repository.ts
// Single source of truth for server_seq allocation. Wraps nextval('fleet_server_seq')
// (introduced in migration 0003) so callsites don't duplicate the unwrap boilerplate.
// Per Frozen Stack PDF: monotonic gap-tolerant server_seq bigint.
import { sql } from 'drizzle-orm';
import type { FleetDb } from './database.module.js';

type TxLike = Parameters<Parameters<FleetDb['transaction']>[0]>[0];

export class ServerSeqAllocationError extends Error {
  constructor() { super('fleet_server_seq nextval returned no row'); this.name = 'ServerSeqAllocationError'; }
}

export async function allocateServerSeq(tx: TxLike | FleetDb): Promise<bigint> {
  const result = await tx.execute(
    sql<{ next_seq: string }>`SELECT nextval('fleet_server_seq')::text AS next_seq`,
  );
  const rows = (result as unknown as { rows: readonly { next_seq: string }[] }).rows;
  const nextSeqStr = rows[0]?.next_seq;
  if (nextSeqStr === undefined) throw new ServerSeqAllocationError();
  return BigInt(nextSeqStr);
}
