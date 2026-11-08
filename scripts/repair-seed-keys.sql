-- OPTIONAL, OWNER ONLY (D167). Repairs a database that was seeded BEFORE the fix of D165: it rewrites the seed keys that the old seed left inside the JSON
-- payloads of complaint_events ("user:5000000004", "complaint:...", "flat:...") to the UUID of that key, the same UUID the fixed seed writes. The app works
-- WITHOUT this repair (the pages show "Assigned to someone", D166); run it only to make the timeline show the names again.
-- complaint_events is append-only (a trigger rejects UPDATE), so the owner switches that one trigger off inside the transaction and on again before the check.
-- Run it as the OWNER, once: runsql -f scripts/repair-seed-keys.sql   (the helper of docs/live-refresh-runbook.md). Safe to run twice (the second run changes 0 rows).
-- The last SELECT must return 0; if it does not, the transaction is still open: run ROLLBACK and tell the agent.
BEGIN;

SELECT current_database() AS database_being_repaired;

-- The same function as src/server/seed/uuid.ts: first 16 bytes of SHA-256("township-app/demo-seed/v1" + newline + key), version nibble 5, variant bits 10.
CREATE OR REPLACE FUNCTION pg_temp.seed_uuid(key text) RETURNS text LANGUAGE sql AS $f$
  WITH h AS (SELECT encode(substring(sha256(convert_to('township-app/demo-seed/v1' || chr(10) || key, 'UTF8')) FROM 1 FOR 16), 'hex') AS x),
       v AS (SELECT overlay(overlay(x PLACING '5' FROM 13 FOR 1) PLACING to_hex((('x' || substr(x, 17, 1))::bit(4)::int & 3) | 8) FROM 17 FOR 1) AS y FROM h)
  SELECT substr(y, 1, 8) || '-' || substr(y, 9, 4) || '-' || substr(y, 13, 4) || '-' || substr(y, 17, 4) || '-' || substr(y, 21, 12) FROM v
$f$;

ALTER TABLE complaint_events DISABLE TRIGGER complaint_events_no_update_delete;

UPDATE complaint_events
   SET payload = (SELECT jsonb_object_agg(e.k, CASE WHEN jsonb_typeof(e.v) = 'string' AND (e.v #>> '{}') ~ '^(user|flat|complaint|bill|member|staff):' THEN to_jsonb(pg_temp.seed_uuid(e.v #>> '{}')) ELSE e.v END)
                    FROM jsonb_each(payload) AS e(k, v))
 WHERE jsonb_typeof(payload) = 'object' AND payload::text ~ '"(user|flat|complaint|bill|member|staff):';

ALTER TABLE complaint_events ENABLE TRIGGER complaint_events_no_update_delete;

SELECT count(*)::int AS rows_still_holding_a_seed_key FROM complaint_events WHERE payload::text ~ '"(user|flat|complaint|bill|member|staff):';
SELECT tgname, tgenabled AS trigger_state_O_means_on FROM pg_trigger WHERE tgname = 'complaint_events_no_update_delete';

COMMIT;
