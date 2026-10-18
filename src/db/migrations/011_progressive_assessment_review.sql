CREATE TABLE IF NOT EXISTS assessment_component_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  assessment_id uuid NOT NULL REFERENCES assessments(id),
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','SUBMITTED','APPROVED','RETURNED')),
  routed_management_user_id uuid REFERENCES users(id),
  submitted_by uuid REFERENCES users(id),
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  decision varchar(20) CHECK(decision IS NULL OR decision IN('APPROVED','RETURNED')),
  review_comment text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,assessment_id)
);
CREATE INDEX IF NOT EXISTS assessment_component_management_queue_idx ON assessment_component_submissions(school_id,routed_management_user_id,status,submitted_at DESC);
CREATE INDEX IF NOT EXISTS assessment_component_status_idx ON assessment_component_submissions(school_id,assessment_id,status);
DROP TRIGGER IF EXISTS assessment_component_submissions_touch ON assessment_component_submissions;
CREATE TRIGGER assessment_component_submissions_touch BEFORE UPDATE ON assessment_component_submissions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
