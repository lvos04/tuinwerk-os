CREATE TABLE onedrive_connection (
 id integer PRIMARY KEY CHECK(id=1), client_id text NOT NULL, tenant text NOT NULL, drive_id text NOT NULL, drive_type text NOT NULL,
 account_name text NOT NULL DEFAULT '', folder_id text, connected_by uuid REFERENCES users,
 connected_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE onedrive_device_flows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_by uuid NOT NULL REFERENCES users,
 device_code text NOT NULL, client_id text NOT NULL, tenant text NOT NULL,
 interval_seconds integer NOT NULL CHECK(interval_seconds>=5), expires_at timestamptz NOT NULL,
 next_poll_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','connected','expired','denied','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX onedrive_device_flows_expiry ON onedrive_device_flows(expires_at) WHERE status='pending';
CREATE TABLE onedrive_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), backup_id uuid NOT NULL, direction text NOT NULL CHECK(direction IN ('upload','download')),
 state text NOT NULL CHECK(state IN ('running','completed','failed')), bytes_transferred bigint NOT NULL DEFAULT 0,
 size bigint NOT NULL, sha256 text NOT NULL, remote_id text, error text,
 started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX onedrive_transfers_recent ON onedrive_transfers(started_at DESC);
