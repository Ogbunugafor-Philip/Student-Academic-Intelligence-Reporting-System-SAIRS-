ALTER TABLE results ADD COLUMN IF NOT EXISTS ca1_score numeric(8,2) NOT NULL DEFAULT 0;
ALTER TABLE results ADD COLUMN IF NOT EXISTS ca2_score numeric(8,2) NOT NULL DEFAULT 0;
ALTER TABLE results ADD COLUMN IF NOT EXISTS subject_position integer;
ALTER TABLE results ADD COLUMN IF NOT EXISTS student_average numeric(5,2);
ALTER TABLE results ADD COLUMN IF NOT EXISTS overall_position integer;

