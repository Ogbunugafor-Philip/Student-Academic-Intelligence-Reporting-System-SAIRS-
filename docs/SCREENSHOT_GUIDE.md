# Privacy-Safe Screenshot Guide

[← README](../README.md)

No application screenshot is published until it is captured from an isolated demo tenant with entirely synthetic data. Do not use production access, existing generated PDFs, real names, contact information, admission numbers, school identifiers or live verification tokens.

## Capture standard

- Use one fictional school and coherent fictional academic period.
- Use invented people, emails on `example.test`, phone placeholders and non-real admission numbers.
- Clear browser extensions, bookmarks, hostnames, console errors and OS notifications.
- Capture desktop at approximately 1440×900 and selected mobile screens at 390×844.
- Prefer WebP or optimised PNG; preserve readable text and consistent viewport.
- Review pixels, PDF text/metadata, URLs and filenames for private information.
- Store approved files in `docs/assets/screenshots/` using the filenames below; add README references only after the files exist.

## 20-screen capture plan

| # | Filename | Page / state | Caption |
|---:|---|---|---|
| 1 | `01-login.webp` | Signed-out `/` | Secure, school-scoped access to SAIRS |
| 2 | `02-admin-dashboard.webp` | Admin dashboard | A single operating view for school administration |
| 3 | `03-management-dashboard.webp` | Management dashboard | Academic oversight and pending decisions at a glance |
| 4 | `04-subject-teacher-workspace.webp` | Teacher portals | A focused workspace for assigned teaching responsibilities |
| 5 | `05-form-teacher-compilation.webp` | Form class view | Validated class compilation before management review |
| 6 | `06-parent-dashboard.webp` | Parent dashboard | Private family access across linked children |
| 7 | `07-student-register.webp` | Student directory | A guardian-aware student register |
| 8 | `08-teacher-responsibilities.webp` | Teacher detail | Academic responsibilities mapped to staff |
| 9 | `09-student-import.webp` | Import preview/history | Safe, recoverable bulk enrolment |
| 10 | `10-academic-setup-import.webp` | Setup import preview | Transactional academic configuration |
| 11 | `11-score-entry.webp` | CA1/CA2/Exam sheet | Progressive score capture with validation |
| 12 | `12-component-review.webp` | Management review | Evidence-based component approval |
| 13 | `13-compiled-result-review.webp` | Compiled detail | Guarded approval before family release |
| 14 | `14-performance-intelligence.webp` | Performance view | Published evidence transformed into insight |
| 15 | `15-report-card.webp` | Browser report | A professional report built from approved results |
| 16 | `16-report-pdf.webp` | Synthetic PDF | Versioned, printable and verifiable reporting |
| 17 | `17-public-verification.webp` | Synthetic verify URL | Independent report authenticity check |
| 18 | `18-academic-history.webp` | Earlier period | Durable history across academic years |
| 19 | `19-audit-trail.webp` | Audit page | Traceability across sensitive operations |
| 20 | `20-mobile-offline.webp` | Mobile/offline state | Responsive work under intermittent connectivity |

After capture, run an OCR/search review and have a second person verify anonymity before committing.
