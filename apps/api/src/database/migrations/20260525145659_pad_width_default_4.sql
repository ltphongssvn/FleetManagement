-- T3 (2026-Q2): align the order_sequence.pad_width column-level DEFAULT
-- with the XT.NNNN contract enforced by the earlier order_number_seq
-- migration and the runtime seed. Without this, a freshly provisioned
-- tenant whose order_sequence row is created without an explicit pad_width
-- would land at the legacy default of 3 — producing XT.NNNN refs that
-- collide with the project-wide XT.NNNN regex on every layer (UI banner,
-- API DTO, projection worker, dispatch board).
ALTER TABLE order_sequence ALTER COLUMN pad_width SET DEFAULT 4;
