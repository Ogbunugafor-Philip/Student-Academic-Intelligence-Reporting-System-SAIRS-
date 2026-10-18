# Google Sheets migration

The Apps Script spreadsheet remains the source and rollback reference until production acceptance. Never point the importer at the live spreadsheet. Export every tab to a protected staging directory as JSON arrays whose property names match the original headers in `SAIRS/Database.gs`.

## Migration sequence

1. Freeze writes for a final export window and make a timestamped copy of the spreadsheet.
2. Export Settings, Users, AcademicSessions, Terms, Classes, ClassArms, Subjects, AssessmentStructures and GradingRules.
3. Export Students, Parents, ParentStudentLinks, Teachers, TeacherAssignments and StudentClassHistory.
4. Export Assessments, Scores, ScoreHistory, ResultBatches, Results and ResultWorkflowHistory.
5. Export Warnings, AcademicRecommendations, ReportCards, AuditLog and SyncOperations.
6. Store each tab as `<SheetName>.json`; keep IDs as strings and timestamps in ISO-8601 form.
7. Run the importer without `--apply`. A dry run opens a transaction, validates foreign keys and constraints, logs its preview, and rolls the transaction back.
8. Reconcile counts, duplicate legacy IDs, orphan references, active class-teacher uniqueness, score ranges, result state order and parent links.
9. Run the importer with `--apply` only against a fresh staging database. Repeat the reconciliation and exercise every role.
10. Repeat from a new immutable export for production during an approved cutover.

```bash
node scripts/import-google-sheets.js /secure/path/to/json-export <school-uuid>
node scripts/import-google-sheets.js /secure/path/to/json-export <school-uuid> --apply
```

The importer uses `legacy_id` uniqueness for repeatable upserts. Dependency records must be loaded before rows that reference them. Missing optional sheets are reported as empty; missing IDs and database constraint failures stop and roll back the entire run. The spreadsheet is never modified.

The old `PasswordHash` and `PasswordSalt` values are deliberately not copied. Apps Script used a different password format and it cannot safely become an Argon2id value without knowing the password. Imported users must receive a one-time reset through an administrator, sign in with the temporary value, and choose a new Argon2id-protected password. Never export old hashes to support staff or logs.

Apps Script session rows and pending sync rows are not trusted as web sessions. Users authenticate again. Legacy report metadata may be retained for audit, but Drive file IDs are not production storage objects; regenerate PDFs from published PostgreSQL results or perform a separately reviewed file transfer.

Before acceptance, compare per-table counts and sampled joins, calculate checksums of exports, verify all legacy IDs resolve, and archive the import log with the export manifest. Keep Apps Script available as read-only fallback until the school signs off.
