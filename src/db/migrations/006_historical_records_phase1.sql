CREATE TABLE IF NOT EXISTS historical_migration_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  entity_type varchar(80) NOT NULL,
  entity_key text NOT NULL,
  details jsonb NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(school_id,entity_type,entity_key)
);

CREATE TABLE IF NOT EXISTS student_session_enrolments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  student_id uuid NOT NULL REFERENCES students(id),
  academic_session_id uuid NOT NULL REFERENCES academic_sessions(id),
  class_id uuid NOT NULL REFERENCES classes(id),
  class_arm_id uuid REFERENCES class_arms(id),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','INACTIVE','TRANSFERRED','GRADUATED','ARCHIVED')),
  enrolment_date date,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,student_id,academic_session_id)
);
CREATE INDEX IF NOT EXISTS student_session_enrolments_roster_idx ON student_session_enrolments(school_id,academic_session_id,class_id,class_arm_id,status,student_id);
DROP TRIGGER IF EXISTS student_session_enrolments_touch ON student_session_enrolments;
CREATE TRIGGER student_session_enrolments_touch BEFORE UPDATE ON student_session_enrolments FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE students ADD CONSTRAINT students_school_id_id_unique UNIQUE(school_id,id);
ALTER TABLE classes ADD CONSTRAINT classes_school_id_id_unique UNIQUE(school_id,id);
ALTER TABLE class_arms ADD CONSTRAINT class_arms_school_id_id_class_unique UNIQUE(school_id,id,class_id);
ALTER TABLE academic_sessions ADD CONSTRAINT academic_sessions_school_id_id_unique UNIQUE(school_id,id);
ALTER TABLE student_session_enrolments ADD CONSTRAINT enrolments_student_tenant_fk FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id);
ALTER TABLE student_session_enrolments ADD CONSTRAINT enrolments_session_tenant_fk FOREIGN KEY(school_id,academic_session_id) REFERENCES academic_sessions(school_id,id);
ALTER TABLE student_session_enrolments ADD CONSTRAINT enrolments_class_tenant_fk FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id);
ALTER TABLE student_session_enrolments ADD CONSTRAINT enrolments_arm_class_tenant_fk FOREIGN KEY(school_id,class_arm_id,class_id) REFERENCES class_arms(school_id,id,class_id);

-- Detect contradictory legacy placement evidence rather than inventing a placement.
WITH evidence AS (
  SELECT school_id,student_id,academic_session_id,to_class_id class_id,to_class_arm_id class_arm_id FROM student_class_history
  UNION
  SELECT rb.school_id,r.student_id,rb.academic_session_id,rb.class_id,rb.class_arm_id FROM results r JOIN result_batches rb ON rb.id=r.batch_id AND rb.school_id=r.school_id
  UNION
  SELECT school_id,student_id,academic_session_id,class_id,class_arm_id FROM report_cards WHERE class_id IS NOT NULL
), conflicts AS (
  SELECT school_id,student_id,academic_session_id,count(DISTINCT (class_id,class_arm_id)) placements,jsonb_agg(DISTINCT jsonb_build_object('classId',class_id,'classArmId',class_arm_id)) details
  FROM evidence GROUP BY school_id,student_id,academic_session_id HAVING count(DISTINCT (class_id,class_arm_id))>1
)
INSERT INTO historical_migration_conflicts(school_id,entity_type,entity_key,details)
SELECT school_id,'STUDENT_SESSION_ENROLMENT',student_id||':'||academic_session_id,jsonb_build_object('reason','Conflicting legacy placements','placements',details) FROM conflicts
ON CONFLICT(school_id,entity_type,entity_key) DO NOTHING;

WITH evidence AS (
  SELECT school_id,student_id,academic_session_id,to_class_id class_id,to_class_arm_id class_arm_id,effective_date enrolment_date,created_by,1 priority FROM student_class_history
  UNION ALL
  SELECT rb.school_id,r.student_id,rb.academic_session_id,rb.class_id,rb.class_arm_id,NULL,NULL,2 FROM results r JOIN result_batches rb ON rb.id=r.batch_id AND rb.school_id=r.school_id
  UNION ALL
  SELECT school_id,student_id,academic_session_id,class_id,class_arm_id,NULL,NULL,3 FROM report_cards WHERE class_id IS NOT NULL
), unambiguous AS (
  SELECT school_id,student_id,academic_session_id FROM evidence GROUP BY school_id,student_id,academic_session_id HAVING count(DISTINCT (class_id,class_arm_id))=1
), chosen AS (
  SELECT DISTINCT ON(e.school_id,e.student_id,e.academic_session_id) e.* FROM evidence e JOIN unambiguous u USING(school_id,student_id,academic_session_id)
  ORDER BY e.school_id,e.student_id,e.academic_session_id,e.priority,e.enrolment_date DESC NULLS LAST
)
INSERT INTO student_session_enrolments(school_id,student_id,academic_session_id,class_id,class_arm_id,enrolment_date,created_by)
SELECT school_id,student_id,academic_session_id,class_id,class_arm_id,enrolment_date,created_by FROM chosen
ON CONFLICT(school_id,student_id,academic_session_id) DO NOTHING;

-- Current placement is a safe fallback only for the school's explicitly current session.
INSERT INTO student_session_enrolments(school_id,student_id,academic_session_id,class_id,class_arm_id,status,enrolment_date,created_by,updated_by)
SELECT s.school_id,s.id,se.id,s.class_id,s.class_arm_id,CASE WHEN s.status='ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END,s.admission_date,s.created_by,s.updated_by
FROM students s JOIN academic_sessions se ON se.school_id=s.school_id AND se.is_current=true AND se.status='ACTIVE'
ON CONFLICT(school_id,student_id,academic_session_id) DO NOTHING;

ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS report_version integer NOT NULL DEFAULT 1;
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS supersedes_report_card_id uuid REFERENCES report_cards(id);
ALTER TABLE report_cards ADD COLUMN IF NOT EXISTS publication_snapshot jsonb;
ALTER TABLE report_cards DROP CONSTRAINT IF EXISTS report_cards_school_id_student_id_academic_session_id_term__key;
DROP INDEX IF EXISTS report_cards_period_context_unique;
CREATE UNIQUE INDEX IF NOT EXISTS report_cards_period_version_unique ON report_cards(school_id,student_id,academic_session_id,term_id,class_id,COALESCE(class_arm_id,'00000000-0000-0000-0000-000000000000'::uuid),report_version);
CREATE INDEX IF NOT EXISTS report_cards_latest_published_idx ON report_cards(school_id,student_id,academic_session_id,term_id,report_version DESC) WHERE status='PUBLISHED';

ALTER TABLE terms ADD CONSTRAINT terms_school_id_id_session_unique UNIQUE(school_id,id,academic_session_id);
ALTER TABLE assessments ADD CONSTRAINT assessments_term_session_fk FOREIGN KEY(school_id,term_id,academic_session_id) REFERENCES terms(school_id,id,academic_session_id) NOT VALID;
ALTER TABLE result_batches ADD CONSTRAINT result_batches_term_session_fk FOREIGN KEY(school_id,term_id,academic_session_id) REFERENCES terms(school_id,id,academic_session_id) NOT VALID;
ALTER TABLE report_cards ADD CONSTRAINT report_cards_term_session_fk FOREIGN KEY(school_id,term_id,academic_session_id) REFERENCES terms(school_id,id,academic_session_id) NOT VALID;
ALTER TABLE warnings ADD CONSTRAINT warnings_term_session_fk FOREIGN KEY(school_id,term_id,academic_session_id) REFERENCES terms(school_id,id,academic_session_id) NOT VALID;

INSERT INTO historical_migration_conflicts(school_id,entity_type,entity_key,details)
SELECT school_id,'ASSESSMENT_DUPLICATE',structure_id||':'||academic_session_id||':'||term_id||':'||class_id||':'||coalesce(class_arm_id::text,'-')||':'||subject_id,
 jsonb_build_object('reason','Duplicate active assessment identity','count',count(*),'assessmentIds',jsonb_agg(id))
FROM assessments WHERE status<>'ARCHIVED'
GROUP BY school_id,structure_id,academic_session_id,term_id,class_id,class_arm_id,subject_id HAVING count(*)>1
ON CONFLICT(school_id,entity_type,entity_key) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM historical_migration_conflicts WHERE entity_type='ASSESSMENT_DUPLICATE') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS assessments_fixed_identity_unique ON assessments(school_id,structure_id,academic_session_id,term_id,class_id,COALESCE(class_arm_id,'00000000-0000-0000-0000-000000000000'::uuid),subject_id) WHERE status<>'ARCHIVED';
  END IF;
END $$;
