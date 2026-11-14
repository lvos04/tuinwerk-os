ALTER TABLE tasks ADD COLUMN moderation_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE task_comments ADD COLUMN moderation_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE attachments ADD COLUMN moderation_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE notifications ADD COLUMN moderation_hidden boolean NOT NULL DEFAULT false;
CREATE TABLE moderation_settings (
 id integer PRIMARY KEY CHECK(id=1), version integer NOT NULL DEFAULT 1,
 prohibited_phrases jsonb NOT NULL DEFAULT '["kankerhoer","kankerlijer","kill yourself"]',
 updated_by uuid REFERENCES users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO moderation_settings(id) VALUES(1);
CREATE TABLE moderation_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
 target_type text NOT NULL CHECK(target_type IN ('task','comment','attachment')), target_id uuid NOT NULL,
 target_author_id uuid REFERENCES users(id) ON DELETE SET NULL, reason text NOT NULL, snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','dismissed','hidden','restored')),
 version integer NOT NULL DEFAULT 1, resolution_note text, resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE UNIQUE INDEX moderation_open_report ON moderation_reports(reporter_id,target_type,target_id) WHERE status='open';
CREATE INDEX moderation_report_queue ON moderation_reports(status,created_at);
