-- apps/api/src/database/migrations/20260810180000_driver_canonical_name.sql
-- Canonical driver.full_name: repair the data, then make the defect impossible.
--
-- INCIDENT. Two ACTIVE rows existed for one human, NGUYEN AN BINH DUC. The only
-- difference was a single TRAILING SPACE on the real driver's row. The unique
-- index was on lower(full_name), so "...duc " and "...duc" are different keys
-- and both rows were legal. reference-seed.ts then re-inserted the canonical
-- spelling on every boot, so deleting the twin only removed it until the next
-- deploy. Soft-delete made it self-perpetuating: active=false drops the row out
-- of the partial index, so the next seed run saw no conflict again.
--
-- WHY THE DATABASE AND NOT ONLY THE APP. normalizeDisplayName already trims,
-- and it was not enough: it shipped after the offending row was written, and
-- the seed writes full_name raw with no schema. An application-only rule also
-- loses to concurrency, since two sessions can both observe "no duplicate" and
-- both insert. normalize(), btrim(), regexp_replace() and lower() are all
-- IMMUTABLE, so the canonical form is directly indexable.
--
-- CHECK, NOT TRIGGER. A trigger that silently rewrote the value would hide the
-- offending writer forever; a CHECK names it at the moment of the write. The
-- app keeps normalizing, so a well-behaved caller never sees this constraint --
-- it exists to catch the callers we do not control.
--
-- ORDER IS LOAD-BEARING: repair BEFORE constrain. Adding the index or the CHECK
-- first would fail against live production rows.

-- Step 1: canonicalize every existing name in place. NFC-compose, collapse
-- internal whitespace runs to one space, trim the ends. Accents and case are
-- deliberately preserved -- diacritics are meaning in Vietnamese, and the fold
-- to lower() belongs in the index, not in storage.
UPDATE driver
SET full_name = btrim(regexp_replace(normalize(full_name, NFC), '\s+', ' ', 'g'))
WHERE full_name IS DISTINCT FROM btrim(regexp_replace(normalize(full_name, NFC), '\s+', ' ', 'g'));

--> statement-breakpoint

-- Step 2: the repair above can make two ACTIVE rows collide that previously did
-- not (exactly the production case: the trailing-space row now equals its bare
-- twin). Keep ONE active row per (company_id, canonical-folded name) and
-- soft-delete the rest. The survivor is chosen by operational richness, NOT by
-- age: the row an operator actually uses is the one carrying a phone, a live
-- vehicle assignment and a registered device. Deactivating that one instead
-- would strand a working driver, so created_at is only the final tiebreak.
WITH ranked AS (
  SELECT d.driver_id,
         row_number() OVER (
           PARTITION BY d.company_id, lower(d.full_name)
           ORDER BY
             (d.phone IS NOT NULL) DESC,
             (d.operator_id IS NOT NULL) DESC,
             (SELECT count(*) FROM driver_vehicle_assignment a
               WHERE a.driver_id = d.driver_id AND a.revoked_at IS NULL) DESC,
             d.created_at ASC
         ) AS rn
  FROM driver d
  WHERE d.active = true
)
UPDATE driver
SET active = false
WHERE driver_id IN (SELECT driver_id FROM ranked WHERE rn > 1);

--> statement-breakpoint

-- Step 3: a soft-deleted row must not reserve a phone. driver_company_phone_uq
-- was a PLAIN unique on (company_id, phone), so deleting a driver locked their
-- number out of re-registration permanently -- production held four such
-- phones. Replace it with a PARTIAL unique mirroring the name index, so the
-- number frees the moment the row is deactivated.
ALTER TABLE driver DROP CONSTRAINT IF EXISTS driver_company_phone_uq;

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS driver_company_active_phone_uq
  ON driver (company_id, phone)
  WHERE active = true AND phone IS NOT NULL;

--> statement-breakpoint

-- Step 4: swap the name index onto the canonical expression. Dropping and
-- recreating under one transaction keeps the uniqueness guarantee unbroken --
-- there is no window in which two active twins could be inserted.
DROP INDEX IF EXISTS driver_company_active_name_ci_uq;

--> statement-breakpoint

CREATE UNIQUE INDEX driver_company_active_name_ci_uq
  ON driver (company_id, lower(btrim(regexp_replace(normalize(full_name, NFC), '\s+', ' ', 'g'))))
  WHERE active = true;

--> statement-breakpoint

-- Step 5: refuse a non-canonical name outright. This is what makes the class
-- extinct rather than this instance fixed: no writer -- seed, migration,
-- console, future service -- can store a name that differs from its canonical
-- form, so a look-alike twin can never be created again.
ALTER TABLE driver
  ADD CONSTRAINT driver_full_name_canonical
  CHECK (full_name = btrim(regexp_replace(normalize(full_name, NFC), '\s+', ' ', 'g')));
