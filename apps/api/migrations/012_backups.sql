CREATE TABLE backup_jobs (
 id uuid PRIMARY KEY, operation text NOT NULL CHECK(operation IN ('backup','restore_preview','restore')),
 state text NOT NULL DEFAULT 'preparing' CHECK(state IN ('preparing','queued','running','completed','failed')),
 requested_by uuid NOT NULL, archive_id uuid, source text NOT NULL DEFAULT 'local' CHECK(source IN ('local','onedrive')),
 upload_to_onedrive boolean NOT NULL DEFAULT false, schedule_key text UNIQUE, result jsonb NOT NULL DEFAULT '{}',
 error text, remote_state text CHECK(remote_state IN ('pending','uploading','completed','failed')), remote_result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE UNIQUE INDEX backup_single_active_job ON backup_jobs((true)) WHERE state IN ('preparing','queued','running');
CREATE INDEX backup_jobs_created ON backup_jobs(created_at DESC);
CREATE TABLE backup_archives (
 id uuid PRIMARY KEY, filename text NOT NULL UNIQUE, manifest jsonb NOT NULL, source text NOT NULL DEFAULT 'local',
 created_at timestamptz NOT NULL DEFAULT now(), remote_state text, remote_result jsonb
);
