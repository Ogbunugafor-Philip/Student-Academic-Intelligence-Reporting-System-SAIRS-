ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES classes(id);
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS class_arm_id uuid REFERENCES class_arms(id);
ALTER TABLE report_cards DROP CONSTRAINT IF EXISTS report_cards_school_id_student_id_academic_session_id_term_i_key;
CREATE UNIQUE INDEX IF NOT EXISTS report_cards_period_context_unique ON report_cards(school_id,student_id,academic_session_id,term_id,class_id,class_arm_id);

