CREATE TABLE IF NOT EXISTS session_class_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  academic_session_id uuid NOT NULL REFERENCES academic_sessions(id),
  class_id uuid NOT NULL REFERENCES classes(id),
  subject_id uuid NOT NULL REFERENCES subjects(id),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','INACTIVE','ARCHIVED')),
  source_session_class_subject_id uuid REFERENCES session_class_subjects(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,academic_session_id,class_id,subject_id)
);

CREATE INDEX IF NOT EXISTS session_class_subjects_scope_idx
  ON session_class_subjects(school_id,academic_session_id,class_id,status,subject_id);

DROP TRIGGER IF EXISTS session_class_subjects_touch ON session_class_subjects;
CREATE TRIGGER session_class_subjects_touch BEFORE UPDATE ON session_class_subjects
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Establish a historical curriculum baseline without changing the legacy mapping.
INSERT INTO session_class_subjects(school_id,academic_session_id,class_id,subject_id,status)
SELECT cs.school_id,se.id,cs.class_id,cs.subject_id,cs.status
FROM class_subjects cs
JOIN academic_sessions se ON se.school_id=cs.school_id
ON CONFLICT(school_id,academic_session_id,class_id,subject_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS academic_session_rollovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  source_session_id uuid REFERENCES academic_sessions(id),
  target_session_id uuid NOT NULL REFERENCES academic_sessions(id),
  mode varchar(20) NOT NULL CHECK(mode IN('CREATE','RECONCILE')),
  status varchar(20) NOT NULL CHECK(status IN('COMPLETED','FAILED')),
  students_created integer NOT NULL DEFAULT 0 CHECK(students_created >= 0),
  subject_assignments_created integer NOT NULL DEFAULT 0 CHECK(subject_assignments_created >= 0),
  form_teacher_assignments_created integer NOT NULL DEFAULT 0 CHECK(form_teacher_assignments_created >= 0),
  curriculum_mappings_created integer NOT NULL DEFAULT 0 CHECK(curriculum_mappings_created >= 0),
  initiated_by uuid REFERENCES users(id),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS academic_session_rollovers_target_idx
  ON academic_session_rollovers(school_id,target_session_id,created_at DESC);

-- Rollover writes session-wide assignments (term_id NULL). The existing partial
-- unique index protects those rows while historical term-bound rows are retained.

