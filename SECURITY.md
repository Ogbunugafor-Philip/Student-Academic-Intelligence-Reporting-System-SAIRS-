# Security model

SAIRS uses Argon2id password hashes and opaque random session tokens. Only a SHA-256 digest of each token is stored in PostgreSQL. Session cookies are HttpOnly, SameSite=Lax and Secure in production; state-changing routes require a matching CSRF token. Login attempts are rate limited and repeated failures create a timed account lock. Password reset invalidates active sessions and issues a forced-change temporary password.

Every API request resolves a server-side identity and school. Queries scope records by `school_id`; role middleware limits modules; assignment checks limit teachers; ownership checks limit parents to linked children and published material. Result transitions are sequential and recorded. Important changes, authentication events, scores, reports and synchronization actions are audited without passwords, cookies, tokens, PINs or database credentials.

Offline academic data is encrypted in IndexedDB with AES-GCM. Its key is derived from the user's PIN with PBKDF2 and held only in memory after unlock. The PIN is never stored. Offline authorization is a cached capability for previously downloaded data; the server rechecks authorization and versions when queued score changes synchronize.

Production must use HTTPS, unique high-entropy `SESSION_SECRET` and database credentials, loopback-only Node binding, least-privilege PostgreSQL grants, protected report-storage permissions, encrypted backups, and restricted `.env` permissions. Review database listener and host firewall rules before production; this project does not alter either. Rotate credentials after suspected exposure and revoke affected `refresh_sessions` and `offline_devices`.

Uploads are size limited, parsed in memory, validated fully before transactional writes, and never executed. PDF files are stored outside the public directory and downloaded through authorized API routes. SMTP attachments are local buffers; Nodemailer URL and file access are disabled.
