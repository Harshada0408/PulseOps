# Deployment Status

**Current status: LIVE.** The app is deployed on free tiers and reachable by visitors.

| Service | URL | Notes |
|---------|-----|-------|
| Frontend | https://api-monitor-saas-frontend.vercel.app | Next.js 14 on Vercel (auto-deploys from `main`) |
| API + worker | https://api-monitor-api.onrender.com | Combined single service on Render free tier (port 10000); `/health` → 200 |
| Docs | `/docs` on the frontend | In-app docs |

## How it's deployed

- **Render** imports the root `Dockerfile` (combined API + background worker image) via `render.yaml`. Free instance auto-restarts and is kept awake by `.github/workflows/keep-alive.yml` pinging `/health` every 5 minutes.
- **Vercel** builds the `frontend/` workspace; `NEXT_PUBLIC_*` env vars are set in the Vercel project. Repo homepage points at the live frontend.
- **Supabase** (hosted) provides Auth + the database; account confirmation by email is enabled.

## Environment / credentials

- `NEXT_PUBLIC_API_URL` must be the **backend root** (e.g. `https://api-monitor-api.onrender.com`) — the frontend appends `/api/v1` itself. `frontend/src/lib/api-url.ts` is resilient to a stray `/api/v1` suffix being included.
- The following are intentionally **not** configured (deliberate, not blockers):
  - **Stripe** — billing is disabled by design while there are no paying customers. `ENABLE_BILLING=true` but a missing `STRIPE_SECRET_KEY` logs a warning and disables checkout; the UI degrades gracefully. Add Stripe keys only when there is a real need (see below).
  - **Redis** — `REDIS_URL` is unused/optional; the worker runs in-process on an interval.

## Signup / email — RESOLVED

- **Email delivery works.** Supabase custom SMTP is wired to **Resend** (`smtp.resend.com`). "Confirm sign up" is enabled and confirmation emails are sent, delivered, and opened (verified in Resend's logs).
- **Verified end-to-end:** a live signup against the deployed API returns `201 "Account created successfully. Please check your email to verify."` and the confirmation email reaches the visitor's inbox.
- **Visitors can now fully onboard:** sign up → receive confirmation → verify → log in.

## Deferred by design (not blockers)

Only **Stripe** remains intentionally disabled while there are no paying customers. `ENABLE_BILLING=true` but a missing `STRIPE_SECRET_KEY` logs a warning and disables checkout; the UI degrades gracefully. To enable when ready, add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASIC/PRO`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to Render and point the webhook at `/api/v1/billing/webhook`.

To also route the worker's uptime **alert** emails through Resend (they currently use the backend default transport), add `RESEND_API_KEY` and `FROM_EMAIL` to the Render service.

Everything else — signup, signin, monitor management, background checks, analytics, alerts, public status pages — is verified working on the live deployment.

## Known issues affecting the live deployment

Disclosed rather than hidden. See [SECURITY.md](SECURITY.md) and
[ROADMAP.md](ROADMAP.md) for detail.

- **SSRF in the monitoring worker (P0).** Any user who can create a monitor can
  direct the worker at internal addresses or the cloud metadata endpoint. The
  Render deployment is internet-facing, so this is reachable by anyone who signs
  up. The public demo should not be treated as safe for untrusted users until the
  fix lands.
- **The worker cannot scale past one replica.** Correct on Render, which runs a
  single combined container. Relevant only if you move to an orchestrator.
- **No automated restore.** Backups are manual via `scripts/backup.sh`.
- **The frontend's `/docs` page may lag this repository.** It is a separate
  in-app surface; the authoritative documentation is in this repository, indexed
  at [docs/README.md](docs/README.md).
