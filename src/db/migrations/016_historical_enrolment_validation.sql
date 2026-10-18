-- Rollover-created historical enrolments that predate a student's admission and
-- have no academic evidence are retained for review but excluded from rosters.
WITH candidates AS (
  SELECT e.*,st.admission_date,se.name session_name,
    COALESCE(se.end_date,
      CASE WHEN se.name ~ '^[0-9]{4}'
        THEN make_date(substring(se.name from 1 for 4)::int+1,12,31)
      END) session_boundary
  FROM student_session_enrolments e
  JOIN students st ON st.id=e.student_id AND st.school_id=e.school_id
  JOIN academic_sessions se ON se.id=e.academic_session_id AND se.school_id=e.school_id
  WHERE e.status='ACTIVE'
    AND EXISTS(SELECT 1 FROM academic_session_rollovers ar
      WHERE ar.school_id=e.school_id AND ar.target_session_id=e.academic_session_id
        AND ar.status='COMPLETED')
), unsupported AS (
  SELECT c.* FROM candidates c
  WHERE c.session_boundary IS NOT NULL AND c.admission_date>c.session_boundary
    AND NOT EXISTS(SELECT 1 FROM results r JOIN result_batches rb ON rb.id=r.batch_id
      WHERE r.school_id=c.school_id AND r.student_id=c.student_id
        AND rb.academic_session_id=c.academic_session_id)
    AND NOT EXISTS(SELECT 1 FROM scores sc JOIN assessments a ON a.id=sc.assessment_id
      WHERE sc.school_id=c.school_id AND sc.student_id=c.student_id
        AND a.academic_session_id=c.academic_session_id)
    AND NOT EXISTS(SELECT 1 FROM report_cards rc WHERE rc.school_id=c.school_id
      AND rc.student_id=c.student_id AND rc.academic_session_id=c.academic_session_id)
    AND NOT EXISTS(SELECT 1 FROM student_class_history h WHERE h.school_id=c.school_id
      AND h.student_id=c.student_id AND h.academic_session_id=c.academic_session_id)
), recorded AS (
  INSERT INTO historical_migration_conflicts(school_id,entity_type,entity_key,details)
  SELECT school_id,'ROLLOVER_ENROLMENT_REVIEW',student_id||':'||academic_session_id,
    jsonb_build_object(
      'reason','Admission date is after the historical session and no academic evidence supports attendance',
      'studentId',student_id,'academicSessionId',academic_session_id,
      'sessionName',session_name,'admissionDate',admission_date,
      'sessionBoundary',session_boundary,'previousStatus',status)
  FROM unsupported
  ON CONFLICT(school_id,entity_type,entity_key) DO NOTHING
  RETURNING entity_key
)
UPDATE student_session_enrolments e SET status='ARCHIVED',updated_at=now()
FROM unsupported u
WHERE e.id=u.id AND EXISTS(SELECT 1 FROM recorded r
  WHERE r.entity_key=u.student_id||':'||u.academic_session_id);

