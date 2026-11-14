CREATE TABLE task_templates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,template jsonb NOT NULL,active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES users,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE user_preferences(user_id uuid PRIMARY KEY REFERENCES users,preferences jsonb NOT NULL DEFAULT '{}',version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE attachments ADD COLUMN version integer NOT NULL DEFAULT 1;
