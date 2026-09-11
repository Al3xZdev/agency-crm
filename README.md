# Agency CRM

Creative review and approval workflow for marketing agencies and their clients.

![Node](https://img.shields.io/badge/Node-%3E%3D22.12-339933?style=flat-square)
![pnpm](https://img.shields.io/badge/pnpm-11.23-F69220?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square)
![Tests](https://img.shields.io/badge/tests-228%20passing-4B32C3?style=flat-square)
![License](https://img.shields.io/badge/license-All%20rights%20reserved-critical?style=flat-square)

Agency CRM is a vertical CRM for the creative production business. It centralizes the complete lifecycle of a creative asset — from the moment the creative team uploads a new version (image or video) to the moment a client reviews, comments, approves or rejects it — with feedback anchored to the exact content, a full version history, and automatic notifications.

It replaces the email/WhatsApp back-and-forth and the "final_v5_FINAL_APP.jpg" chaos with a single, auditable place for approvals.

## Features

- **Creative review**: clients review each version in a lightbox viewer with version navigation and full history.
- **Anchored feedback**: comments with drawing overlay on the artwork and, for video, **timestamped pins** — comment on second 0:23, not "at the end".
- **Decisions**: approve / reject / request changes per version, with an audit trail of who decided and when.
- **Real versioning**: every upload is a numbered version, content-addressed by sha256 — identical bytes are **deduplicated into one physical asset** with a reference count.
- **Client portal**: clients sign in through a **magic link** — no account creation, no passwords to remember.
- **Agency workspace**: staff roles (SUPER_ADMIN / ACCOUNT_MANAGER / CREATIVE), httpOnly cookie sessions with double-submit CSRF, and dashboards for pending approvals and activity.
- **Notifications**: automatic emails for new versions, stale-approval reminders, and a weekly pending digest.
- **Multi-tenant by agency**: every agency sees exactly its own data; isolation is enforced by an interceptor layer, not by convention.
- **Campaign hierarchy**: client → campaign → creative → versions, with cascade delete.
- **Media processing**: real file-type sniffing (never trusts the extension), deduplication, and sharp-based thumbnails.
- **Job pipeline**: version processing, approval reminders, and weekly digests run on pg-boss, a PostgreSQL-backed job queue.

## Tech stack

| Layer | Technology |
|---|---|
| Web | Next.js 15 (App Router), React 19, Tailwind CSS 3, TanStack Query 5, Tabler Icons |
| API | NestJS 11, Prisma 6 + PostgreSQL, Zod 3 |
| Jobs | pg-boss 12 (Postgres-backed queue) |
| Uploads | Busboy, file-type, content-addressed storage (sha256 + refcount) |
| Media | sharp (thumbnails), AWS SDK S3 / local storage drivers |
| Security | @node-rs/argon2, httpOnly cookies, double-submit CSRF, signed magic links, optional email sealing |
| Email | Nodemailer (console transport in dev, SMTP in prod) |
| Tooling | pnpm workspaces, TypeScript 5.6, ESLint 9, Vitest 3 + Supertest |

## Monorepo layout

```
agency-crm/
├── apps/
│   ├── web/          # Next.js client + staff applications
│   └── api/          # NestJS REST API + worker entrypoint
├── packages/
│   └── shared/       # Zod schemas and shared TypeScript contracts
└── infra/
    └── compose.yaml  # Docker Compose environment
```

The API is modular: `auth`, `campaigns`, `clients`, `creatives`, `versions`, `uploads`, `comments`, `reviews`, `magic-links`, `notifications`, `dashboard`, `tenancy`, `storage`, `media`, `jobs`, `staff`, `agency`, `health` and more.

## Quick start

Requirements: **Node >= 22.12**, **pnpm 11+**, **Docker** (for Postgres).

```bash
# 1. Install dependencies
pnpm install

# 2. Start the environment (Postgres)
docker compose --project-directory . -f infra/compose.yaml up -d

# 3. Apply migrations and seed
pnpm --filter @agency-crm/api db:migrate
pnpm --filter @agency-crm/api db:seed

# 4. Build shared contracts and the API
pnpm --filter @agency-crm/shared build
pnpm --filter @agency-crm/api build

# 5. Run
pnpm --filter @agency-crm/api start      # REST API (+ optionally dist/main-worker.js for jobs)
pnpm --filter @agency-crm/web dev        # web app
```

## Testing

```bash
pnpm test                    # runs tests in every workspace
pnpm --filter @agency-crm/api test   # API e2e suite (Vitest + Supertest)
```

The API suite currently has **228 passing tests** covering authentication, tenancy enforcement, the upload/version pipeline, comments, reviews, notifications, jobs and more — with the genuine tenancy layer running against mocked data.

## Configuration

Key environment variables (see `infra/compose.yaml` and `apps/api/src/config` for the full set):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `NODE_ENV` | `development` / `test` / `production` |
| `SESSION_TTL_DAYS` | Staff/client session lifetime |
| `PUBLIC_WEB_URL` | Public web origin (for links) |
| `STORAGE_DRIVER` | `local` (dev) or `s3` |
| `LOCAL_STORAGE_PATH` | Root for the local storage driver |
| `SMTP_URL` | SMTP connection for email; falls back to console transport |
| `MAIL_SEAL_KEY` | Optional key to encrypt email bodies |

## Status

Actively developed (v0.1.0), self-hosted via Docker Compose.

---

## Copyright

Copyright © 2026 **Al3xz-dev** (alexisboianelli@gmail.com). All rights reserved.

This repository is provided for evaluation and collaboration purposes. Unauthorized copying, distribution, modification, or commercial use is prohibited without prior written permission.