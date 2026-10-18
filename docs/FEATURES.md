# Verified SAIRS Features

[← README](../README.md) · [Architecture](ARCHITECTURE.md) · [Workflows](BUSINESS_WORKFLOWS.md)

This catalogue summarises capabilities verified in routes, services, migrations, frontend modules and tests during the 18 October 2026 audit. “Verified” describes the audited revision; it is not a hosted-service claim.

## Identity and access

- Tenant-aware login using email and school slug.
- Opaque server sessions, CSRF validation, logout/revocation and account locking.
- Forced replacement of temporary passwords.
- Four roles: IT Administrator, Management, Teacher and Parent.
- Subject Teacher and Form Teacher responsibilities under the Teacher role.
- Assignment-, tenant-, linked-child- and report-level server authorisation.

## Academic administration

- School identity and contact configuration.
- Academic session and term management with one current period per school.
- Class, arm, subject, curriculum and grading-rule configuration.
- Assessment structures with validated score weights.
- Transactional academic-setup workbook import.
- Session rollover preview, creation and reconciliation.
- Promotion roster and individual promotion.
- Explicit review of ambiguous historical enrolments.

## Student and guardian records

- Searchable, paginated student register and history.
- Atomic student, guardian account, parent-child link and session-enrolment creation.
- Guardian reuse and support for multiple linked children.
- Student profile/status management and CSV export.
- XLSX/CSV template, preview and persisted bulk-import jobs.
- Recoverable jobs, import history and encrypted one-time credential artifacts.

## Staff and account administration

- Searchable teacher directory, detail and status management.
- Atomic teacher account creation with multiple responsibilities.
- Form-teacher and subject-teacher assignment administration.
- Form-class coverage visibility and all-arms assignment expansion.
- Three-sheet teacher import template, preview and transactional import.
- Management-user directory, create/edit/status and password reset.

## Assessment and review

- Session-aware assigned teaching workspace and enrolled rosters.
- Standard CA1/20, CA2/20 and Examination/60 components.
- Draft saving, score validation and independent component submission.
- Score-change history and authorised score import.
- Routed management review queue with approve/return decisions.
- Parent visibility of approved current-period components only.

## Results and intelligence

- Weighted score, percentage, grade and remark calculation.
- Subject competition rank, student average and overall position.
- Curriculum/roster completeness gate before compilation.
- Form-teacher class compilation and deterministic management routing.
- Guarded review, return, approval and publication workflow.
- Role-scoped student performance history.
- Published-only trend direction, academic warnings and support recommendations.

## Reports, verification and history

- Browser report preview, print, secure download and guardian email.
- Branded PDF containing scores, grades, ranks, grade key and publication context.
- Versioned, superseding publication snapshots.
- QR-linked public verification page and verified PDF download.
- Checksum validation and version-specific token protection.
- Session enrolment, class history, workflow history and historical retrieval.

## PWA, operations and governance

- Installable responsive PWA and offline navigation shell.
- PIN-derived AES-GCM encryption for opted-in offline data.
- Role-scoped offline snapshots and report files.
- UUID-idempotent score outbox with retry and conflict resolution.
- Tenant-scoped audit trail plus own-activity views.
- Database health endpoint, unfinished-import recovery, PM2 and Nginx assets.

## Explicitly incomplete or absent

Automated backup scheduling is not implemented. Email is report-specific rather than a general notification centre. Custom permission editing, attendance, result unpublish, MFA and self-service password recovery are not present. See the [Roadmap](../README.md#future-development-roadmap).
