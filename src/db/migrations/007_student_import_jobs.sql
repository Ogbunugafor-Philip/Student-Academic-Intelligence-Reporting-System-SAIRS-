CREATE SEQUENCE student_import_reference_seq;

CREATE TABLE student_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id),
  started_by uuid NOT NULL REFERENCES users(id),
  academic_session_id uuid NOT NULL REFERENCES academic_sessions(id),
  term_id uuid NOT NULL REFERENCES terms(id),
  import_reference varchar(32) NOT NULL UNIQUE,
  original_filename varchar(255) NOT NULL,
  total_rows integer NOT NULL CHECK(total_rows BETWEEN 1 AND 2000),
  fingerprint char(64) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','PROCESSING','COMPLETED','FAILED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  students_created integer NOT NULL DEFAULT 0 CHECK(students_created>=0),
  guardians_created integer NOT NULL DEFAULT 0 CHECK(guardians_created>=0),
  guardian_links_created integer NOT NULL DEFAULT 0 CHECK(guardian_links_created>=0),
  enrolments_created integer NOT NULL DEFAULT 0 CHECK(enrolments_created>=0),
  error_message text,
  source_ciphertext bytea,
  source_iv bytea,
  source_auth_tag bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX student_import_jobs_active_fingerprint_unique
  ON student_import_jobs(school_id,fingerprint)
  WHERE status IN('PENDING','PROCESSING','COMPLETED');
CREATE INDEX student_import_jobs_school_started_idx
  ON student_import_jobs(school_id,started_at DESC);

CREATE TABLE student_import_credentials (
  job_id uuid PRIMARY KEY REFERENCES student_import_jobs(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES schools(id),
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  auth_tag bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_downloaded_at timestamptz
);
CREATE INDEX student_import_credentials_school_idx
  ON student_import_credentials(school_id,job_id);

CREATE TRIGGER student_import_jobs_touch BEFORE UPDATE ON student_import_jobs
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
