# SAIRS Security Architecture

[← README](../README.md) · [Architecture](ARCHITECTURE.md) · [Vulnerability Reporting](../SECURITY.md)

This document describes implemented controls, not a certification or guarantee.

## Identity and sessions

Passwords are hashed with Argon2id (64 MiB memory, time cost 3, parallelism 1). Temporary credentials require first-login replacement. Authentication returns a random opaque token in an HttpOnly cookie; only its SHA-256 hash is stored. Logout revokes the database session, password changes revoke other sessions, and failed logins can lock an account. State-changing requests require a separate CSRF token.

## Authorisation and isolation

The API reconstructs user ID, school ID and role from the server session. Fixed role middleware is followed by service-level checks for teacher assignment, routed management reviewer, linked parent-child relationship and report status/version. SQL access binds the authenticated `school_id` throughout the domain.

## Input, browser and storage protections

- Zod schemas, service rules and PostgreSQL constraints validate data.
- Queries use parameter binding.
- Helmet applies security headers and a restrictive CSP; framing and object content are blocked.
- Import size is bounded and workbook/CSV data is validated before transactional writes.
- PDFs live outside the public directory and pass through authorisation.
- Verification uses random version-specific token material plus checksum integrity.
- Offline snapshots/files/outbox entries use AES-256-GCM with a PBKDF2-derived PIN key.
- Audit records capture authentication, mutations, workflow decisions and report access.

## Deployment responsibilities

Operators must use unique production secrets, HTTPS, least-privilege database credentials, protected report storage, SMTP controls, encrypted backups and restore tests. Do not publish `.env`, database dumps, imports, reports, credential artifacts or personal records. Review proxy trust and cookie behaviour before Internet exposure.

## Known security roadmap

MFA, self-service password recovery, an administrator session console, automated backup/restore validation, formal retention controls and independent penetration testing are not implemented in this repository.
