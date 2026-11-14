ALTER TABLE users ADD COLUMN mfa_secret text;
ALTER TABLE users ADD COLUMN mfa_pending_secret text;
ALTER TABLE users ADD COLUMN mfa_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN mfa_last_step bigint;
ALTER TABLE users ADD COLUMN mfa_recovery_hashes text[] NOT NULL DEFAULT '{}';
