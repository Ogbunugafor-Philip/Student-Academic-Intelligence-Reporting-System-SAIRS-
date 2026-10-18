# SAIRS-WEB

Standalone Student Academic Intelligence and Record System. The application serves an installable offline-capable PWA from Express, stores authoritative records in PostgreSQL, generates report-card PDFs locally, and sends published reports through SMTP.

## Local development

1. Copy `.env.example` to `.env` and supply development-only secrets and a dedicated database.
2. Create the role and database using the manual commands in `DEPLOYMENT.md`.
3. Run `npm install`, `npm run migrate`, and `node scripts/bootstrap-school.js`.
4. Run `npm test`, `npm run check`, then `npm start`.

The server binds to `127.0.0.1:3400` by default. `/health` returns HTTP 200 only when both the app and database are healthy. Production traffic is intended to enter through Nginx. Google Apps Script and Google Sheets are not used during normal operation.

## Application areas

- Authentication, PostgreSQL-backed sessions, CSRF protection, lockout, password reset and audit logs
- Students, guardians, lifecycle history, teachers and assignments
- Academic sessions, terms, classes, arms, subjects, grading and assessment structures
- Assessments, validated score entry/import and score history
- Weighted results with Draft → Submitted → Reviewed → Approved → Published workflow
- Performance warnings and deterministic recommendations
- Authorized PDF report generation, download, publication and SMTP delivery
- Encrypted IndexedDB offline workspace, offline PIN, score outbox and idempotent synchronization

Operational procedures are in `DEPLOYMENT.md`; legacy-data conversion is in `MIGRATION.md`; security controls are in `SECURITY.md`.
# Student-Academic-Intelligence-Reporting-System-SAIRS-
