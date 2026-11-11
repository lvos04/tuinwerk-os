CREATE TABLE inventory_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sku text NOT NULL UNIQUE, name text NOT NULL,
 description text NOT NULL DEFAULT '', category text NOT NULL DEFAULT '', unit text NOT NULL DEFAULT 'stuk',
 minimum numeric(16,4) NOT NULL DEFAULT 0 CHECK(minimum >= 0), price numeric(16,4) CHECK(price >= 0),
 supplier text NOT NULL DEFAULT '', supplier_sku text NOT NULL DEFAULT '', compatible_asset_ids jsonb NOT NULL DEFAULT '[]',
 active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory_balances (
 item_id uuid NOT NULL REFERENCES inventory_items(id), location_id uuid NOT NULL REFERENCES locations(id),
 quantity numeric(16,4) NOT NULL DEFAULT 0 CHECK(quantity >= 0), minimum numeric(16,4) CHECK(minimum >= 0), version integer NOT NULL DEFAULT 1,
 PRIMARY KEY(item_id,location_id)
);
CREATE TABLE inventory_operations (
 user_id uuid NOT NULL REFERENCES users(id), operation_id uuid NOT NULL, request_hash text NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,operation_id)
);
CREATE TABLE inventory_counts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, location_id uuid REFERENCES locations(id),
 created_by uuid NOT NULL REFERENCES users(id), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz
);
CREATE TABLE inventory_count_lines (
 count_id uuid NOT NULL REFERENCES inventory_counts(id), item_id uuid NOT NULL REFERENCES inventory_items(id), location_id uuid NOT NULL REFERENCES locations(id),
 snapshot_quantity numeric(16,4) NOT NULL, snapshot_version integer NOT NULL, counted_quantity numeric(16,4) CHECK(counted_quantity >= 0),
 PRIMARY KEY(count_id,item_id,location_id)
);
CREATE TABLE inventory_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operation_id uuid NOT NULL, item_id uuid NOT NULL REFERENCES inventory_items(id),
 location_id uuid NOT NULL REFERENCES locations(id), type text NOT NULL CHECK(type IN ('receipt','usage','transfer','correction')),
 delta numeric(16,4) NOT NULL, quantity_after numeric(16,4) NOT NULL CHECK(quantity_after >= 0),
 reason text NOT NULL DEFAULT '', task_id uuid REFERENCES tasks(id), count_id uuid REFERENCES inventory_counts(id),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_movements_item_idx ON inventory_movements(item_id,created_at DESC);
CREATE INDEX inventory_movements_task_idx ON inventory_movements(task_id);
CREATE TABLE recurrence_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, description text NOT NULL DEFAULT '',
 config jsonb NOT NULL, task_template jsonb NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE recurrence_occurrences (
 rule_id uuid NOT NULL REFERENCES recurrence_rules(id), due_date date NOT NULL, task_id uuid NOT NULL REFERENCES tasks(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(rule_id,due_date), UNIQUE(task_id)
);
CREATE TABLE season_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, activities jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE season_activations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_id uuid NOT NULL REFERENCES season_templates(id),
 operation_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES users(id), anchor_date date NOT NULL,
 task_ids jsonb NOT NULL, request_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(created_by,operation_id)
);
