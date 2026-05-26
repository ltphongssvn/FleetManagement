-- T3 (2026-Q2): adopt XTT.MM-NNN per-month numbering as the sole order-
-- numbering contract. This is the only migration that seeds an
-- order_sequence row for the pilot company; the prior 'XT' seed/pad
-- migrations were squashed (no production users depended on them, so the
-- 2026 industry practice is to delete the dead history rather than carry
-- legacy-compat code paths forever).
--
-- Format produced by OrderNumberingService.allocate() against this row:
--   XTT.MM-NNN  (prefix=XTT, MM=2-digit UTC month, NNN=3-digit monthly seq)
--
-- Idempotent: ON CONFLICT DO NOTHING. A re-applied migration leaves the
-- row untouched; allocator monthly rebase computes NNN from MAX of
-- current-month transport_order.external_ref rows under the FOR UPDATE
-- lock, so next_value's role is only the lazy-init witness.
INSERT INTO order_sequence (company_id, business_unit_id, depot_id, legal_entity_id, prefix, next_value, pad_width)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000',
  'XTT', 1, 3
)
ON CONFLICT ON CONSTRAINT order_sequence_company_prefix_uq DO NOTHING;
--> statement-breakpoint
ALTER TABLE order_sequence ALTER COLUMN pad_width SET DEFAULT 3;
