ALTER TABLE class_result_submissions
  DROP CONSTRAINT IF EXISTS class_result_submissions_school_id_academic_session_id_term_key;
ALTER TABLE class_result_submissions
  ADD CONSTRAINT class_result_submissions_context_key
  UNIQUE NULLS NOT DISTINCT(school_id,academic_session_id,term_id,class_id,class_arm_id);
