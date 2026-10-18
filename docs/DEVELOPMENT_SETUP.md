# Development Setup

[← README](../README.md) · [Architecture](ARCHITECTURE.md) · [Deployment](../DEPLOYMENT.md)

## Requirements

- Node.js 20+
- npm with lockfile support
- PostgreSQL (use a dedicated non-production database)
- Optional SMTP test account

## Configure

```bash
npm ci
cp .env.example .env
```

Replace placeholders locally. `APP_ORIGIN`, `DATABASE_PASSWORD` and `SESSION_SECRET` are required in production. Never commit `.env`. Create a least-privilege runtime role and apply migrations with a separate owner/migration role where possible.

## Initialise a local database

The following commands change the configured database. Confirm `.env` points to a disposable local environment first.

```bash
npm run migrate:status
npm run migrate
node scripts/bootstrap-school.js
```

The bootstrap script reads required initial school/admin values from its documented environment inputs. Do not paste real credentials into source or shell history.

## Run and verify

```bash
npm run dev       # watch mode
npm start         # normal server
npm test          # Node test suite
npm run check     # syntax validation
```

The default bind is `127.0.0.1:3400`; `/health` checks application/database availability. Email and public verification URLs require appropriate local SMTP and `APP_ORIGIN` configuration.

## Safe development data

Use invented schools, names, admission numbers, emails and scores. Never copy production dumps or report PDFs into the repository. Generated artifacts belong under ignored `storage/` paths. Run acceptance/benchmark scripts only against an isolated environment because they may create records.
