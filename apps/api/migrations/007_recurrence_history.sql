CREATE TABLE recurrence_occurrence_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule_id uuid NOT NULL REFERENCES recurrence_rules(id),
 due_date date NOT NULL, task_id uuid NOT NULL REFERENCES tasks(id), superseded_at timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL DEFAULT 'Herhaalregel gewijzigd'
);
CREATE INDEX recurrence_history_rule ON recurrence_occurrence_history(rule_id,due_date);
