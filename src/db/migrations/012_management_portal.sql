CREATE TABLE IF NOT EXISTS class_result_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  academic_session_id uuid NOT NULL REFERENCES academic_sessions(id),
  term_id uuid NOT NULL REFERENCES terms(id),
  class_id uuid NOT NULL REFERENCES classes(id),
  class_arm_id uuid REFERENCES class_arms(id),
  form_teacher_id uuid NOT NULL REFERENCES teachers(id),
  status varchar(24) NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN('SUBMITTED','REVIEWED','APPROVED','RETURNED','PUBLISHED')),
  routed_management_user_id uuid NOT NULL REFERENCES users(id),
  submitted_by uuid NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_comment text,
  published_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,academic_session_id,term_id,class_id,class_arm_id)
);
CREATE INDEX IF NOT EXISTS class_result_management_queue_idx ON class_result_submissions(school_id,routed_management_user_id,status,submitted_at DESC);
DROP TRIGGER IF EXISTS class_result_submissions_touch ON class_result_submissions;
CREATE TRIGGER class_result_submissions_touch BEFORE UPDATE ON class_result_submissions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
