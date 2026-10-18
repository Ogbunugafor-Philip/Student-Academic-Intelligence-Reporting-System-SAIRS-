CREATE UNIQUE INDEX IF NOT EXISTS one_current_session_per_school
  ON academic_sessions(school_id) WHERE is_current=true AND status='ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS one_current_term_per_school
  ON terms(school_id) WHERE is_current=true AND status='ACTIVE';

CREATE INDEX IF NOT EXISTS results_published_history_idx
  ON results(school_id,student_id,batch_id,percentage);

CREATE INDEX IF NOT EXISTS result_batches_analytics_idx
  ON result_batches(school_id,academic_session_id,term_id,class_id,class_arm_id,subject_id)
  WHERE status='PUBLISHED';

CREATE INDEX IF NOT EXISTS teacher_assignments_analytics_idx
  ON teacher_assignments(school_id,academic_session_id,class_id,class_arm_id,subject_id,teacher_id)
  WHERE status='ACTIVE';
