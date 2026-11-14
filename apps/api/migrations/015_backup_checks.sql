CREATE TABLE backup_restore_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL UNIQUE REFERENCES backup_jobs(id),
 archive_id uuid NOT NULL, source text NOT NULL CHECK(source IN ('local','onedrive')),
 requested_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1, task_reference text, file_reference text, notes text NOT NULL DEFAULT '',
 task_checked boolean NOT NULL DEFAULT false, file_checked boolean NOT NULL DEFAULT false,
 recorded_at timestamptz, recorded_by uuid REFERENCES users(id),
 CHECK(recorded_at IS NULL OR (task_checked AND file_checked AND task_reference IS NOT NULL AND file_reference IS NOT NULL))
);
CREATE TABLE backup_check_reminders (
 reminder_key text NOT NULL, user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(reminder_key,user_id)
);
