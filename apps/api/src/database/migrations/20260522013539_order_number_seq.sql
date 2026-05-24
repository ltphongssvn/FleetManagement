-- T3 (2026): server-authoritative order numbering. This migration:
--   1) Resolves any pre-existing duplicate XT.NNN external_ref rows by
--      tagging older rows with an XT.LEGACY-* sentinel so the unique
--      constraint below can apply cleanly.
--   2) Adds a UNIQUE constraint on (company_id, external_ref) to make
--      duplicate numbers impossible at the database level.
--   3) Seeds the default XT sequence row per pilot company.
--   4) Advances next_value past any existing XT.NNN max so the allocator
--      never collides with rows that predate this migration.
WITH ranked AS (
  SELECT
    transport_order_id,
    company_id,
    external_ref,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, external_ref
      ORDER BY created_at DESC, transport_order_id DESC
    ) AS rn
  FROM transport_order
  WHERE external_ref ~ '^XT\.\d+$'
)
UPDATE transport_order t
SET external_ref = 'XT.LEGACY-' || t.transport_order_id::text
FROM ranked r
WHERE t.transport_order_id = r.transport_order_id AND r.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS transport_order_company_external_ref_uq
  ON transport_order (company_id, external_ref)
  WHERE external_ref IS NOT NULL;
--> statement-breakpoint
INSERT INTO order_sequence (company_id, business_unit_id, depot_id, legal_entity_id, prefix, next_value, pad_width)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000',
  'XT', 1, 4
)
ON CONFLICT ON CONSTRAINT order_sequence_company_prefix_uq DO NOTHING;
--> statement-breakpoint
UPDATE order_sequence os
SET next_value = sub.max_seq + 1,
    updated_at = now()
FROM (
  SELECT company_id,
         MAX((substring(external_ref FROM '^XT\.(\d+)$'))::int) AS max_seq
  FROM transport_order
  WHERE external_ref ~ '^XT\.\d+$'
  GROUP BY company_id
) sub
WHERE os.company_id = sub.company_id
  AND os.prefix = 'XT'
  AND os.next_value <= sub.max_seq;
