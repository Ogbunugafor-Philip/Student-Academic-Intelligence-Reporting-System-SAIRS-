ALTER TABLE historical_migration_conflicts
  ADD COLUMN IF NOT EXISTS review_status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK(review_status IN('PENDING','CONFIRMED','CORRECTED','ARCHIVED')),
  ADD COLUMN IF NOT EXISTS review_decision varchar(40),
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

WITH evidence AS (
  SELECT e.school_id,e.student_id,e.academic_session_id,e.id enrolment_id,
    st.admission_date,se.name session_name,se.end_date,
    COALESCE(se.end_date,CASE WHEN se.name ~ '^[0-9]{4}' THEN make_date(substring(se.name from 1 for 4)::int+1,12,31) END) session_boundary,
    (SELECT count(*) FROM scores sc JOIN assessments a ON a.id=sc.assessment_id WHERE sc.school_id=e.school_id AND sc.student_id=e.student_id AND a.academic_session_id=e.academic_session_id) score_count,
    (SELECT count(*) FROM results r JOIN result_batches rb ON rb.id=r.batch_id WHERE r.school_id=e.school_id AND r.student_id=e.student_id AND rb.academic_session_id=e.academic_session_id) result_count,
    (SELECT count(*) FROM report_cards rc WHERE rc.school_id=e.school_id AND rc.student_id=e.student_id AND rc.academic_session_id=e.academic_session_id) report_count,
    (SELECT count(*) FROM student_class_history h WHERE h.school_id=e.school_id AND h.student_id=e.student_id AND h.academic_session_id=e.academic_session_id AND h.action<>'ADMISSION') history_count
  FROM student_session_enrolments e
  JOIN students st ON st.id=e.student_id AND st.school_id=e.school_id
  JOIN academic_sessions se ON se.id=e.academic_session_id AND se.school_id=e.school_id
)
INSERT INTO historical_migration_conflicts(school_id,entity_type,entity_key,details)
SELECT school_id,'HISTORICAL_ENROLMENT_REVIEW',student_id||':'||academic_session_id,
  jsonb_build_object('reason','Recorded admission date is after this academic session','studentId',student_id,'academicSessionId',academic_session_id,'enrolmentId',enrolment_id,'sessionName',session_name,'admissionDate',admission_date,'sessionBoundary',session_boundary,'scoreCount',score_count,'resultCount',result_count,'reportCount',report_count,'historyCount',history_count,'classification',CASE WHEN score_count+result_count+report_count+history_count>0 THEN 'SUPPORTED_BY_ACADEMIC_EVIDENCE' ELSE 'AMBIGUOUS' END)
FROM evidence
WHERE session_boundary IS NOT NULL AND admission_date>session_boundary
  AND NOT EXISTS(SELECT 1 FROM historical_migration_conflicts existing
    WHERE existing.school_id=evidence.school_id
      AND existing.entity_type='ROLLOVER_ENROLMENT_REVIEW'
      AND existing.entity_key=evidence.student_id||':'||evidence.academic_session_id)
ON CONFLICT(school_id,entity_type,entity_key) DO UPDATE SET details=EXCLUDED.details;

CREATE INDEX IF NOT EXISTS historical_conflicts_review_idx
  ON historical_migration_conflicts(school_id,review_status,entity_type,detected_at);
