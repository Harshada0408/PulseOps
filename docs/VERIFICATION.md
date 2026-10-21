# Verification log

Verified in the build environment (Linux sandbox, Node 22, PostgreSQL 16.15 installed locally):

| Check | Result |
|---|---|
| Migrations (init + PulseOps) applied to an empty PostgreSQL 16 database with `psql` | passed |
| `core` typecheck (strict), build, lint | passed |
| `core` tests: 227 (incl. 179 inherited executor/SSRF tests) | 227 passed |
| `backend` tests: 93 (incl. 29 HTTP integration tests on a real database) | 93 passed |
| `worker` tests: 7 scheduler tests on a real database | 7 passed |
| `worker` typecheck, lint; `backend` lint (0 errors) | passed |
| `frontend` typecheck and `next build` | passed |
| Browser run (Chromium via Playwright): signup, monitor creation with validation + SSRF rejection, manual checks opening an incident, simulation walkthrough, incident timeline, theme toggle (instant, persisted, keyboard), system-theme fallback | passed |

NOT verified (the sandbox could not reach `binaries.prisma.sh`, so Prisma's native engines were unavailable):

* `prisma generate`, `prisma migrate deploy`, `prisma validate` CLI runs. The schema was validated with Prisma 5.22's own schema validator (`@prisma/prisma-schema-wasm`) and the SQL migrations were applied with `psql`, but `npm run db:generate` / `npm run db:deploy` are for you to run on Windows.
* The Prisma-backed adapter `prismaSqlDb` (about 20 lines) and the production auth middleware's Prisma user lookup. Tests use the equivalent `pg` adapter and a stubbed auth middleware. The browser run used a harness that supplied a `pg`-backed SQL handle and a JWT-only auth middleware.
* `backend` `tsc` fails only in the inherited `routes/alerts.ts` on `Prisma.AlertWhereInput` until `prisma generate` has been run (the generated client was not available here).
* Docker / Render builds, the optional e-mail path (Resend) and the optional AI provider with a real key.
* Everything on Windows itself.
