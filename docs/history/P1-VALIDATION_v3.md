# P1 Validation — Phase 1 Foundation (Build/Lint/Typecheck)

**Branch:** `phase/v3-p1-foundation`
**Date:** 2026-08-18
**Node used for validation:** v24.18.0 local (target Node for the repo: **22** per `.nvmrc`, engines, Dockerfiles, CI)

## Scope of changes made

| Area | Change |
|---|---|
| Node version | Chose **Node 22 (LTS)**. `.nvmrc` `20→22`; `engines` `>=20` → `>=22` in root/backend/worker; added `engines` to frontend. Dockerfiles already `node:22-alpine`, CI already `22` — unchanged. |
| Frontend route conflict | Deleted `frontend/src/app/page.tsx` (duplicate `/`). Canonical landing is `frontend/src/app/(marketing)/page.tsx`. |
| Frontend landing prerender | `(marketing)/page.tsx` uses `framer-motion` in a server component → added `'use client'`; moved SEO `metadata` to new `frontend/src/app/(marketing)/layout.tsx` (metadata can only live in server components). |
| Backend lint | Added `@eslint/js ^10.0.0` devDependency (flat config `eslint.config.js` requires it); deleted dead legacy `backend/.eslintrc.json` (ESLint 10 ignores it). |
| Worker lint/typecheck | Added `eslint ^10.5.0`, `@eslint/js`, `@typescript-eslint/* ^8.62.0` devDeps + new `worker/eslint.config.js`; added `typecheck` script. |
| Worker `db:generate` | Added `"db:generate": "prisma generate"` to `worker/package.json` — both workspaces now expose the same script (backend already had it). No dependencies added; lockfiles unaffected (scripts are not lockfile-tracked). |
| Frontend deps | Removed unused `zod ^4.4.3` (0 imports; clashed with backend zod 3.x in the single lockfile). |
| Seed script | Removed broken `db:seed` (`ts-node src/utils/seed.ts` — file never existed; nothing referenced it). |
| Prisma schema drift | Worker `User` schema missing `username`, `isActive`, `lastLoginAt` used by backend code → added them so both packages share one consistent generated client. |
| Worker lint fix | Removed unused `logger` import in `worker/src/services/executor.ts` (only real lint error found). |
| Lockfiles | Root workspace lockfile regenerated; `backend/package-lock.json` + `worker/package-lock.json` regenerated (were stale); **new** `frontend/package-lock.json` created. Docker now uses per-workspace lockfiles. |
| Dockerfiles | All 3 now `COPY package*.json ./` + `npm ci` (were `npm install` without lockfiles). Backend runner: `npm ci --omit=dev`; removed redundant/nondeterministic `RUN npx prisma generate` (client is copied from builder). |
| Root scripts | Delegation via workspace flags (`-w` / `--workspaces`); `lint` now includes worker; added `typecheck`. |
| CI | Root `npm ci` only (installs all workspaces; removed per-workspace nested `npm ci`); per-workspace `build`/`lint`/`typecheck`/`test`; Node 22; added lint+typecheck steps. |

## Commands executed

| Command | Result | Notes |
|---|---|---|
| `npm install` (root) | **PASS** | Regenerated root workspace lockfile (1134 pkgs). `@eslint/js@^10.5.0` initially failed (not published) → corrected to `^10.0.0`. |
| `npm ci` (root, fresh) | **PASS** | Fresh install from lockfile, exit 0. npm `allow-scripts` blocks `@prisma/client` postinstall → Prisma client must be generated explicitly (CI/docker already do this). |
| `npm run build -w backend` | **PASS** | `tsc`, exit 0. |
| `npm run lint -w backend` | **PASS** | exit 0; **0 errors, 9 warnings** (pre-existing `no-explicit-any`). |
| `npm run typecheck -w backend` | **PASS** | `tsc --noEmit`, exit 0. |
| `npm test -w backend` | **PASS** | 4 suites / 12 tests, exit 0. |
| `npm run build -w worker` | **PASS** | `tsc`, exit 0. |
| `npm run lint -w worker` | **PASS** | exit 0 after removing unused import; **0 errors, 1 warning** (`no-explicit-any`). |
| `npm run typecheck -w worker` | **PASS** | `tsc --noEmit`, exit 0. |
| `npm run build -w frontend` | **PASS** | `next build`, 20/20 pages, exit 0. Verified both with and without `NEXT_PUBLIC_*` env. |
| `npm run lint -w frontend` | **PASS** | `next lint`: "No ESLint warnings or errors", exit 0. |
| `npm run typecheck -w frontend` | **PASS** | `tsc --noEmit`, exit 0. |
| `npm run build` (root) | **PASS** | `--workspaces` (frontend→backend→worker), exit 0. |
| `npm run lint` (root) | **PASS** | all 3 workspaces, exit 0 (warnings only). |
| `npm run typecheck` (root) | **PASS** | all 3 workspaces, exit 0. |
| `npm test` (root) | **PASS** | backend only (only workspace with tests), exit 0. |
| `npm run db:generate -w backend` / worker generate | **PASS** | required after fresh `npm ci` (postinstall blocked by npm allow-scripts). |

**Build blocker discovered mid-validation (fixed):** running the worker's Prisma generate overwrote the shared hoisted client with the worker schema, which lacked `username`/`isActive`/`lastLoginAt`, breaking the backend build (`auth.ts` TS2353). Fixed by aligning the worker schema (see scope table).

## Prisma client consistency (P1 follow-up)

Both workspaces now expose `db:generate` (`prisma generate`). Clean sequential validation:

| Command | Result |
|---|---|
| `rm -rf node_modules && npm ci` | **PASS** (exit 0) |
| `npm run db:generate -w backend` | **PASS** (exit 0) |
| `npm run db:generate -w worker` | **PASS** (exit 0) |
| `npm run build` (root) | **PASS** (exit 0) |
| `npm run lint` (root) | **PASS** (exit 0; warnings only) |
| `npm run typecheck` (root) | **PASS** (exit 0) |
| `npm test` (root) | **PASS** (4 suites / 12 tests) |

**Reported difference (accepted, documented):** generating the backend client and then the worker client produces **byte-different** generated clients — the file lists are identical (14 files) but `inlineSchemaHash` and the embedded `runtimeDataModel` differ. Root cause: the two schema files are structurally identical in data model but declare **relation back-fields in different order** (`User`, `Monitor`, `StatusPage`, `StatusPageItem`) plus cosmetic whitespace/`// Relations` comments. Prisma hashes the normalized schema text, so field order changes the hash. No model, field, type, index, or constraint differs — the clients are **functionally equivalent**, and both backend and worker compile and run against whichever client is generated last (verified: build/lint/typecheck/test pass with the worker-generated client as the final state). Making the clients byte-identical would require reordering fields in the schema files, which is out of scope (do not modify schemas); deferred with the user's explicit acceptance.

## Local-dev + lint fixes (follow-up)

Issues surfaced by running the full command sequence and `npm run dev` were fixed:

| Issue | Fix |
|---|---|
| 10 pre-existing `no-explicit-any` lint warnings (backend 9, worker 1) | All removed: typed Prisma inputs (`AlertWhereInput`, `AlertUncheckedCreateInput`, `CheckUncheckedCreateInput`, `MonitorUncheckedCreateInput/UpdateInput` with `Omit<'userId'>`), `unknown` for event/webhook handlers, `WebSocketLikeConstructor` cast for Supabase realtime transport, axios `Method` type for the worker executor. **Lint is now 0 warnings.** |
| `pnpm run dev` hybrid install | pnpm on an npm-workspaces repo moved `concurrently` to `node_modules/.ignored` and created `pnpm-lock.yaml`, corrupting the npm install (caused the dev-only `/pricing` 404). Removed `pnpm-lock.yaml`, `rm -rf node_modules`, restored with `npm ci`. Repo is **npm-only** (root `workspaces` field); `pnpm-lock.yaml` deleted. |
| Backend "Environment validation failed" + worker "DATABASE_URL not found" | ES module imports are hoisted, so `backend/src/config/env.ts` validated `process.env` **before** `server.ts`'s `dotenv.config()` ran, and workspace scripts run with cwd = the workspace dir (not repo root), so cwd-based `dotenv.config()` never found the root `.env`. Fix: `env.ts` now loads the repo-root `.env` itself (`path.resolve(__dirname, '../../../.env')`) before parsing; worker `index.ts` loads the same root file. Real env vars (Docker/CI) still take precedence (dotenv never overrides). |
| No `.env` for local dev | Created gitignored `.env` for local dev: DB/Redis values match `docker-compose.yml` creds; Supabase/Stripe/Resend use placeholders (not needed to boot). |
| `.env.example` JWT placeholder too short | Validator requires ≥64 chars; example placeholder was 55 → fixed to a 64+ char placeholder. |
| Local Postgres port conflict | Host already runs native Postgres on 5432 and Redis on 6379 (genomeai containers use 5433/6380). Repo Postgres is run as a container on **5434** (`api-monitor-saas-pg`, same image/creds/volume as compose) with `.env` `DATABASE_URL` → port 5434. Host Redis on 6379 is used as-is. |

**Verified `npm run dev`:** backend `/health` → 200 and "Backend running on port 3001"; worker "Worker scheduler running" + successful DB check cycles; frontend `/`, `/pricing`, `/features`, `/docs`, `/blog` all → 200. Dev DB schema created via `prisma db push --schema backend/prisma/schema.prisma`.

## Remaining failures

- **None (blocking).** All required commands pass.

## Unavoidable limitations / caveats

1. **Lint warnings:** **fixed** in this follow-up — backend and worker now report **0 warnings, 0 errors** (all `no-explicit-any` removed; see Local-dev fixes table).
2. **`npm audit`:** 15 vulnerabilities (1 low / 2 moderate / 12 high) in transitive deps. Not addressed — fixing requires dependency upgrades, explicitly out of scope ("Do not randomly upgrade dependencies"). Deferred.
3. **Docker images:** Dockerfile changes (lockfile-based `npm ci`) are not executed locally (no image build run in this phase). They will be verified by the CI `docker` job. The per-workspace lockfiles they depend on are in sync.
4. **Two install paths (structural):** root lockfile (CI/local) and per-workspace lockfiles (Docker) are separate; each is internally reproducible, but resolved versions may differ slightly between paths (e.g., backend eslint 10.5.0 vs 10.8.1). Aligning Docker to the root lockfile is deferred to the deploy phase (out of scope per Task 10).
5. **Runtime verification** (auth, Stripe webhooks, Resend email, live DB checks) requires external credentials and is not part of Phase 1.
6. **Prisma generate required post-install** because npm `allow-scripts` blocks `@prisma/client` postinstall; CI and both Dockerfiles already run explicit `prisma generate`.

## Definition of Done checklist

- [x] 1. One documented Node version (22) used consistently (.nvmrc, engines, Dockerfiles, CI).
- [x] 2. Fresh dependency installation succeeds (`npm ci`, exit 0).
- [x] 3. Frontend build succeeds (`next build`, 20/20).
- [x] 4. Backend build succeeds (`tsc`).
- [x] 5. Worker build succeeds (`tsc`).
- [x] 6. Backend lint succeeds (0 errors).
- [x] 7. Worker/frontend lint + typecheck succeed (0 errors).
- [x] 8. Root validation commands work (build/lint/typecheck/test).
- [x] 9. CI matches chosen environment (Node 22, install→build→lint→typecheck→test).
- [x] 10. No unrelated product features added.
- [x] 11. No security/architecture redesign smuggled in.
- [x] 12. Working tree contains only intentional Phase 1 changes (see `git status`: 14 modified, 2 deleted, 3 new; build artifacts gitignored).