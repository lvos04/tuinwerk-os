-- 0.3.0: wijzigingsmoment op voorraadsaldi, herbevestiging per sessie en ontbrekende indexen.
ALTER TABLE inventory_balances ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE OR REPLACE FUNCTION inventory_balances_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS inventory_balances_touch ON inventory_balances;
CREATE TRIGGER inventory_balances_touch BEFORE UPDATE ON inventory_balances
  FOR EACH ROW EXECUTE FUNCTION inventory_balances_touch();
CREATE INDEX IF NOT EXISTS inventory_balances_updated ON inventory_balances(updated_at);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS reauthenticated_at timestamptz;
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_refresh_expires ON sessions(refresh_expires_at);

CREATE INDEX IF NOT EXISTS time_entries_started ON time_entries(started_at);
CREATE INDEX IF NOT EXISTS time_entries_task ON time_entries(task_id);
CREATE INDEX IF NOT EXISTS tasks_category ON tasks(category);
