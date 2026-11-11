ALTER TABLE imports ADD COLUMN kind text NOT NULL DEFAULT 'tasks' CHECK(kind IN ('tasks','inventory','locations'));
ALTER TABLE notifications ADD COLUMN critical boolean NOT NULL DEFAULT false;
CREATE TABLE push_devices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users,token text NOT NULL UNIQUE,platform text NOT NULL CHECK(platform IN ('ios','android')),active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE notification_deliveries(notification_id uuid NOT NULL REFERENCES notifications ON DELETE CASCADE,channel text NOT NULL CHECK(channel IN ('email','push')),state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sent','failed','skipped')),attempts integer NOT NULL DEFAULT 0,last_error text,next_attempt_at timestamptz NOT NULL DEFAULT now(),sent_at timestamptz,PRIMARY KEY(notification_id,channel));
CREATE INDEX notification_delivery_pending ON notification_deliveries(next_attempt_at) WHERE state='pending';
CREATE FUNCTION enqueue_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO notification_deliveries(notification_id,channel) SELECT NEW.id,'email' FROM notification_preferences WHERE user_id=NEW.user_id AND email;
 INSERT INTO notification_deliveries(notification_id,channel) SELECT NEW.id,'push' FROM notification_preferences WHERE user_id=NEW.user_id AND push;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_delivery_queue AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION enqueue_notification();
