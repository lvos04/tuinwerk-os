CREATE TABLE user_favorites (
 user_id uuid NOT NULL REFERENCES users,
 type text NOT NULL CHECK(type IN ('asset','location','template')),
 target_id uuid NOT NULL,
 saved_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,type,target_id)
);
CREATE TABLE user_capacity (
 user_id uuid PRIMARY KEY REFERENCES users,
 weekday_minutes integer[] NOT NULL DEFAULT ARRAY[0,480,480,480,480,480,0],
 version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(cardinality(weekday_minutes)=7),
 CHECK(0<=ALL(weekday_minutes) AND 1440>=ALL(weekday_minutes))
);
