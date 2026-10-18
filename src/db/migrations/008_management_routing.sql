ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name varchar(200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone varchar(80);

ALTER TABLE result_batches ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES users(id);
ALTER TABLE result_batches ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE result_batches ADD COLUMN IF NOT EXISTS routed_management_user_id uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS result_batches_management_queue_idx
  ON result_batches(school_id,routed_management_user_id,status,submitted_at DESC);
