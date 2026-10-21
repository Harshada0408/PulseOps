# Contributing

Thanks for your interest in contributing to **API Monitor SaaS**! Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Get started

1. **Fork the repository and create a branch off `main`:**

   ```bash
   git checkout -b feature/my-change
   ```

2. Make your changes following our conventions.

3. **Verify** your work locally before opening a pull request:

   ```bash
   docker compose up -d           # full stack, migrations applied automatically
   curl -s localhost:3001/health  # expect "status":"healthy"

   npm run build
   npm run lint
   npm run typecheck
   npm test
   ```

   Only `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
   required in `.env`. See [ENV_GUIDE.txt](ENV_GUIDE.txt).

4. Commit with a clear conventional message (see below).

5. Push the branch and open a pull request against `main`, using the [pull request template](.github/pull_request_template.md).

## Adding a dependency

Only permissive licenses are permitted: MIT, BSD-2-Clause, BSD-3-Clause, ISC,
0BSD, or Apache-2.0. Copyleft (GPL, AGPL, LGPL, MPL, CDDL, EPL) and
source-available licenses (SSPL, BUSL, Elastic) are prohibited.

After changing any `package.json`, regenerate the license inventory and commit the
result:

```bash
npm run licenses
```

CI runs `npm run licenses:check` and fails if the inventory is stale or a
non-permissive license appears. The audit reads only the lockfile, so it needs no install. The reasoning is in
[docs/COMMERCIAL_BOUNDARY.md](docs/COMMERCIAL_BOUNDARY.md) — the community
edition must stay freely redistributable, which it could not be under a copyleft
dependency.

## Documentation rule

- Implemented behavior goes in [ARCHITECTURE.md](ARCHITECTURE.md).
- Planned behavior goes in [ROADMAP.md](ROADMAP.md).
- Development records go in `docs/history/`.

Keep all three consistent when you add a feature. Do not describe intended
behavior as though it ships — a previous `ARCHITECTURE.md` documented a mobile
app, a CLI, a webhook service, Prometheus, Grafana, and Kubernetes, none of which
existed.

## Commit conventions

Use conventional commit prefixes so history stays readable:

```
feat: add multi-region checks
fix: resolve monitor timeout handling
docs: update API documentation
refactor: simplify check logic
test: add monitor unit tests
chore: update dependencies
```

## Reporting issues

Use the [bug report](.github/ISSUE_TEMPLATE/bug_report.md) or [feature request](.github/ISSUE_TEMPLATE/feature_request.md) templates. For security issues, see [SECURITY.md](SECURITY.md) and report privately.

## Code style

- TypeScript everywhere (no plain JS in `src`).
- Follow the existing ESLint (`npm run lint`) and TypeScript (`npm run typecheck`) rules — both must pass with zero errors.
- This is an **npm workspaces** monorepo. Do not use pnpm/yarn — it can corrupt `node_modules`.

## Project structure

- `frontend/` — Next.js 14 dashboard + marketing site
- `backend/` — Express API (routes, services, Prisma schema)
- `worker/` — background monitoring worker
- `supabase/` — Supabase auth schema migrations

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full picture and [docs/](docs/) for deployment, licensing, and commercial documentation.
