-- Bedrijfskoppeling API v1: alleen-lezen server-naar-server sleutels. Alleen de SHA-256-hash wordt bewaard.
CREATE TABLE koppelsleutels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 naam text NOT NULL CHECK(length(btrim(naam)) BETWEEN 1 AND 100),
 voorvoegsel text NOT NULL CHECK(length(voorvoegsel)=8),
 sleutel_hash text NOT NULL UNIQUE CHECK(sleutel_hash ~ '^[0-9a-f]{64}$'),
 aangemaakt_op timestamptz NOT NULL DEFAULT now(),
 aangemaakt_door uuid REFERENCES users(id) ON DELETE SET NULL,
 laatst_gebruikt_op timestamptz,
 ingetrokken_op timestamptz,
 ingetrokken_door uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX koppelsleutels_lijst ON koppelsleutels(aangemaakt_op DESC);
CREATE INDEX tasks_updated_id ON tasks(updated_at,id);
