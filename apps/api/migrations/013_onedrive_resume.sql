ALTER TABLE onedrive_connection ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE onedrive_connection ADD COLUMN IF NOT EXISTS tenant text;
ALTER TABLE onedrive_transfers ADD COLUMN upload_session text;
ALTER TABLE onedrive_transfers ADD COLUMN session_expires_at timestamptz;
ALTER TABLE onedrive_transfers ADD COLUMN session_scope text;
