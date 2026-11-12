ALTER TABLE users ADD COLUMN system_account boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD CONSTRAINT system_account_cannot_login CHECK(NOT system_account OR (active=false AND role='employee' AND password_hash='!'));
CREATE UNIQUE INDEX one_anonymous_system_account ON users((system_account)) WHERE system_account;
CREATE TABLE privacy_file_cleanup (
 id bigserial PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('upload','export')),
 filename text NOT NULL,
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(kind,filename)
);
CREATE INDEX privacy_file_cleanup_due ON privacy_file_cleanup(next_attempt_at);
CREATE FUNCTION privacy_scrub_json(value jsonb, old_id text, old_email text, old_name text, anonymous_id text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb; element jsonb; pair record; contents text;
BEGIN
 IF value IS NULL THEN RETURN NULL; END IF;
 CASE jsonb_typeof(value)
 WHEN 'object' THEN
  result='{}'::jsonb;
  FOR pair IN SELECT * FROM jsonb_each(value) LOOP
   result=result||jsonb_build_object(replace(pair.key,old_id,anonymous_id),privacy_scrub_json(pair.value,old_id,old_email,old_name,anonymous_id));
  END LOOP;
  RETURN result;
 WHEN 'array' THEN
  result='[]'::jsonb;
  FOR element IN SELECT * FROM jsonb_array_elements(value) LOOP
   IF element=to_jsonb(old_id) THEN CONTINUE; END IF;
   result=result||jsonb_build_array(privacy_scrub_json(element,old_id,old_email,old_name,anonymous_id));
  END LOOP;
  RETURN result;
 WHEN 'string' THEN
  contents=value#>>'{}';
  IF contents=old_name THEN contents='Verwijderde medewerker'; END IF;
  contents=replace(contents,old_id,anonymous_id);
  IF old_email<>'' THEN contents=replace(contents,old_email,'[e-mailadres verwijderd]'); END IF;
  RETURN to_jsonb(contents);
 ELSE RETURN value;
 END CASE;
END $$;
