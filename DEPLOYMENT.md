# Deployment guide

## Deployment identity

- Application directory: choose a dedicated path owned by the service operator
- Default internal bind: `127.0.0.1:3400`; verify availability before deployment
- PM2 process: `sairs-web`; verify it does not conflict with an existing process
- Proposed database: `sairs_web`
- Proposed login role: `sairs_web_app`
- Domain: deliberately unset; configure `APP_ORIGIN` when one is assigned

Inspect the target host before deployment. Do not reuse an existing database, role, virtual host, process name, or port.

## Manual staging preparation

Run these as an authorized operator, replacing both placeholder passwords with separate strong values. These commands were **not** run while building the project.

```sql
-- Run in psql as a PostgreSQL administrator.
CREATE ROLE sairs_web_owner NOLOGIN;
CREATE ROLE sairs_web_app LOGIN PASSWORD '<STRONG_DATABASE_PASSWORD>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE DATABASE sairs_web OWNER sairs_web_owner;
\connect sairs_web
GRANT CONNECT ON DATABASE sairs_web TO sairs_web_app;
GRANT USAGE ON SCHEMA public TO sairs_web_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sairs_web_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sairs_web_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sairs_web_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sairs_web_app;
ALTER DEFAULT PRIVILEGES FOR ROLE sairs_web_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sairs_web_app;
```

Apply migrations as the owner (or a separate migration role), not as the least-privilege runtime account:

```bash
cd /path/to/SAIRS-WEB
cp .env.example .env
# Edit .env: unique secrets, staging origin, database password, and SMTP details.
npm ci --omit=dev
npm run migrate:status
npm run migrate
node scripts/bootstrap-school.js
npm test
npm run check
```

Perform a migration dry run using exported JSON files before applying any records; follow `MIGRATION.md`. Test all roles and workflows against staging data. Start the staging process only after review with `pm2 start ecosystem.config.js`, then test `curl -i http://127.0.0.1:3400/health`.

## Nginx and production

Copy `nginx/sairs-web.conf.example` to a uniquely named site only after replacing `sairs.example.invalid` with the approved domain. Check with `nginx -t`, obtain certificates through the operator's normal process, and reload Nginx during an approved change window. The Node port remains loopback-only.

Before production cutover: take immutable Google Sheet exports, validate record counts and foreign-key reconciliation, import into a fresh production database, run acceptance and role-isolation tests, configure backup/restore monitoring, set production SMTP, verify report storage permissions, then switch traffic. Keep Apps Script and Sheets read-only as the rollback source until formal sign-off. Never use `pm2 restart all`.

## Rollback

Remove only the new SAIRS virtual host from traffic, stop only `sairs-web`, and restore the prior application entry point. Do not delete source exports or the old Apps Script project. Database rollback should use a verified snapshot rather than destructive ad-hoc SQL.
