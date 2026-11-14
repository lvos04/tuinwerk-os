CREATE TABLE system_settings(id integer PRIMARY KEY CHECK(id=1),values jsonb NOT NULL DEFAULT '{}',secrets jsonb NOT NULL DEFAULT '{}',version integer NOT NULL DEFAULT 1,updated_by uuid REFERENCES users,updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO system_settings(id) VALUES(1);
