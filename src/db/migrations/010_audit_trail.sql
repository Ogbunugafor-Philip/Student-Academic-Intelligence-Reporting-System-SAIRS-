ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_name varchar(240),
  ADD COLUMN IF NOT EXISTS actor_email varchar(320),
  ADD COLUMN IF NOT EXISTS actor_role varchar(40),
  ADD COLUMN IF NOT EXISTS module varchar(80),
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS result_status varchar(20) NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN IF NOT EXISTS entity_reference text,
  ADD COLUMN IF NOT EXISTS context jsonb;

UPDATE audit_logs a SET actor_email=COALESCE(a.actor_email,u.email),actor_role=COALESCE(a.actor_role,u.role),actor_name=COALESCE(a.actor_name,NULLIF(u.full_name,''),u.email),module=COALESCE(a.module,CASE WHEN a.action ~ 'LOGIN|LOGOUT|PASSWORD|SESSION|SECURITY' THEN 'Authentication' WHEN a.action ~ 'IMPORT' THEN 'Imports' WHEN a.action ~ 'GUARDIAN|PARENT' THEN 'Parents' WHEN a.action ~ 'TEACHER|ASSIGNMENT' THEN 'Teachers' WHEN a.action ~ 'MANAGEMENT|MANAGER' THEN 'Management' WHEN a.action ~ 'SCORE|ASSESSMENT' THEN 'Scores' WHEN a.action ~ '^RESULT|BATCH_(SUBMITTED|REVIEWED|APPROVED|PUBLISHED)' THEN 'Results' WHEN a.action ~ 'REPORT' THEN 'Reports' WHEN a.action ~ 'STUDENT|ENROL|PROMOT|GRADUAT' THEN 'Students' WHEN a.action ~ 'SCHOOL|CLASS|ARM|SUBJECT|CURRICULUM|GRADING|TERM|ACADEMIC' THEN 'Academic Setup' ELSE 'System' END),result_status=CASE WHEN a.action ~ 'FAIL|REJECT|ERROR' THEN 'FAILED' ELSE COALESCE(a.result_status,'SUCCESS') END FROM users u WHERE u.id=a.user_id AND u.school_id=a.school_id;
UPDATE audit_logs SET module=COALESCE(module,'System'),result_status=CASE WHEN action ~ 'FAIL|REJECT|ERROR' THEN 'FAILED' ELSE COALESCE(result_status,'SUCCESS') END WHERE module IS NULL OR result_status IS NULL;

CREATE INDEX IF NOT EXISTS audit_school_actor_time_idx ON audit_logs(school_id,user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS audit_school_action_time_idx ON audit_logs(school_id,action,created_at DESC);
CREATE INDEX IF NOT EXISTS audit_school_module_time_idx ON audit_logs(school_id,module,created_at DESC);

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit records are append-only'; END;
$$;
DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
