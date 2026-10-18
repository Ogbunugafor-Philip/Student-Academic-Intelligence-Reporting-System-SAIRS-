ALTER TABLE schools ADD COLUMN IF NOT EXISTS principal_name varchar(160);

CREATE TABLE IF NOT EXISTS class_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  class_id uuid NOT NULL REFERENCES classes(id),
  subject_id uuid NOT NULL REFERENCES subjects(id),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','INACTIVE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,class_id,subject_id)
);
CREATE INDEX IF NOT EXISTS class_subjects_school_class_idx ON class_subjects(school_id,class_id,status);
