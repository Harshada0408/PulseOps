# Third-Party Licenses

Inventory of every direct dependency in the API Monitor SaaS community edition.

## Summary

| License | Packages | Commercial restriction |
|---|---|---|
| MIT | 66 | None. Attribution notice required. |
| Apache-2.0 | 4 | None. Attribution + NOTICE + patent grant required. |
| BSD-2-Clause | 1 | None. Attribution notice required. |
| ISC | 2 | None. Attribution notice required. |
| **Copyleft (GPL/AGPL/LGPL/MPL/CDDL/EPL)** | **0** | **None present.** |
| **Unknown / source-available** | **0** | **None present.** |

**73 direct dependencies across 3 workspaces. No copyleft
(GPL, AGPL, LGPL, MPL, CDDL, EPL) and no source-available (SSPL, BUSL, Elastic) license is
present.** The dependency set imposes no restriction on redistribution, sublicensing, or
commercial use of a derivative work.

That is the most important fact in this document: the community edition can be relicensed,
bundled, and sold without copyleft obligations. See `docs/COMMERCIAL_BOUNDARY.md` for how the
proprietary edition relates to this code.

## Audit method

Licenses and versions come from the committed `package-lock.json`, resolved per workspace
the way Node resolves them: nearest `node_modules` first, walking up to the root. This
matters because a workspace lockfile can hold several copies of one package — `eslint`
resolves to 8.57.1 in `frontend/` and 10.5.0 in `backend/` — so looking a package up by
name alone reports whichever copy was seen first, not the one in use.

`node_modules` is never read. The output is therefore identical on a clean checkout with
no install, and cannot be skewed by a stale or partially populated tree. Nothing is inferred
from package names.

Regenerate after any dependency change:

```bash
npm ci
node scripts/audit-licenses.js
```

The script exits non-zero if a copyleft or unrecognized license is introduced, so the policy
below is enforced mechanically rather than by review.

## Policy

1. Only permissive licenses may be added: MIT, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Apache-2.0.
2. Any new dependency must be recorded in this file in the same change that introduces it.
3. Dependencies must not require network access or telemetry at runtime in a way that
   complicates self-hosted distribution.
4. Vendored source is prohibited. Dependencies are consumed from the package manager, never
   copied into the repository.

## Attribution requirements

If you redistribute this software or a derivative work:

- **MIT, BSD-2-Clause, ISC** — reproduce the copyright notice and permission notice in the
  distributed copies. Each notice lives in that dependency's `LICENSE` file under
  `node_modules/<package>/LICENSE`.
- **Apache-2.0** (`@prisma/client`, `prisma`, `typescript`, `class-variance-authority`) —
  reproduce the license and, where upstream ships a `NOTICE` file, reproduce its contents. The
  Apache-2.0 patent grant and its patent-termination clause apply.

No dependency here requires you to disclose the source of your own proprietary code. The fact
that `typescript` is Apache-2.0 does not affect the output of code compiled with it.

## Not our property

Every package below is a third-party work under its own license. None of it is authored by the
maintainer, none of it is part of any proprietary asset, and none of it may be described as
ours in a listing, buyer guide, or marketing material. These packages remain under the
licenses below no matter how the surrounding application is licensed.

## Full inventory

| Package | Version | License | Workspace | Scope |
|---|---|---|---|---|
| `@eslint/js` | 10.0.1 | MIT | backend | dev |
| `@radix-ui/react-avatar` | 1.2.0 | MIT | frontend | prod |
| `@radix-ui/react-dialog` | 1.1.16 | MIT | frontend | prod |
| `@radix-ui/react-dropdown-menu` | 2.1.17 | MIT | frontend | prod |
| `@radix-ui/react-label` | 2.1.9 | MIT | frontend | prod |
| `@radix-ui/react-select` | 2.3.0 | MIT | frontend | prod |
| `@radix-ui/react-separator` | 1.1.9 | MIT | frontend | prod |
| `@radix-ui/react-slot` | 1.2.5 | MIT | frontend | prod |
| `@radix-ui/react-switch` | 1.3.0 | MIT | frontend | prod |
| `@radix-ui/react-tabs` | 1.1.14 | MIT | frontend | prod |
| `@radix-ui/react-toast` | 1.2.16 | MIT | frontend | prod |
| `@radix-ui/react-tooltip` | 1.2.9 | MIT | frontend | prod |
| `@supabase/auth-helpers-nextjs` | 0.8.7 | MIT | frontend | prod |
| `@supabase/supabase-js` | 2.108.0 | MIT | backend | prod |
| `@types/bcryptjs` | 2.4.6 | MIT | backend | dev |
| `@types/cors` | 2.8.19 | MIT | backend | dev |
| `@types/express` | 4.17.25 | MIT | backend | dev |
| `@types/jest` | 29.5.14 | MIT | backend | dev |
| `@types/jsonwebtoken` | 9.0.10 | MIT | backend | dev |
| `@types/morgan` | 1.9.10 | MIT | backend | dev |
| `@types/node` | 20.19.42 | MIT | backend | dev |
| `@types/node-cron` | 3.0.11 | MIT | worker | dev |
| `@types/react` | 18.3.31 | MIT | frontend | dev |
| `@types/react-dom` | 18.3.7 | MIT | frontend | dev |
| `@types/supertest` | 6.0.3 | MIT | backend | dev |
| `@types/ws` | 8.18.1 | MIT | backend | dev |
| `@typescript-eslint/eslint-plugin` | 8.62.0 | MIT | backend | dev |
| `@typescript-eslint/parser` | 8.62.0 | MIT | backend | dev |
| `autoprefixer` | 10.5.0 | MIT | frontend | dev |
| `axios` | 1.17.0 | MIT | backend | prod |
| `bcryptjs` | 2.4.3 | MIT | backend | prod |
| `bullmq` | 5.78.0 | MIT | worker | prod |
| `clsx` | 2.1.1 | MIT | frontend | prod |
| `cors` | 2.8.6 | MIT | backend | prod |
| `date-fns` | 3.6.0 | MIT | frontend | prod |
| `eslint` | 10.5.0 | MIT | backend | dev |
| `eslint-config-next` | 14.2.35 | MIT | frontend | dev |
| `express` | 4.22.2 | MIT | backend | prod |
| `express-rate-limit` | 7.5.1 | MIT | backend | prod |
| `framer-motion` | 12.40.0 | MIT | frontend | prod |
| `globals` | 15.15.0 | MIT | worker | dev |
| `helmet` | 7.2.0 | MIT | backend | prod |
| `ioredis` | 5.11.1 | MIT | worker | prod |
| `jest` | 29.7.0 | MIT | backend | dev |
| `jsonwebtoken` | 9.0.3 | MIT | backend | prod |
| `morgan` | 1.11.0 | MIT | backend | prod |
| `next` | 14.2.35 | MIT | frontend | dev |
| `postcss` | 8.5.15 | MIT | frontend | dev |
| `react` | 18.3.1 | MIT | frontend | prod |
| `react-dom` | 18.3.1 | MIT | frontend | prod |
| `recharts` | 2.15.4 | MIT | frontend | prod |
| `resend` | 2.1.0 | MIT | backend | prod |
| `secretlint` | 13.0.2 | MIT | frontend | dev |
| `stripe` | 14.25.0 | MIT | backend | prod |
| `supertest` | 6.3.4 | MIT | backend | dev |
| `tailwind-merge` | 2.6.1 | MIT | frontend | prod |
| `tailwindcss` | 3.4.19 | MIT | frontend | dev |
| `tailwindcss-animate` | 1.0.7 | MIT | frontend | prod |
| `ts-jest` | 29.4.11 | MIT | backend | dev |
| `ts-node` | 10.9.2 | MIT | backend | dev |
| `ts-node-dev` | 2.0.0 | MIT | backend | dev |
| `ts-prune` | 0.10.3 | MIT | backend | dev |
| `winston` | 3.19.0 | MIT | backend | prod |
| `ws` | 8.21.0 | MIT | backend | prod |
| `zod` | 3.25.76 | MIT | backend | prod |
| `zustand` | 4.5.7 | MIT | frontend | prod |
| `@prisma/client` | 5.22.0 | Apache-2.0 | backend | prod |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | frontend | prod |
| `prisma` | 5.22.0 | Apache-2.0 | backend | dev |
| `typescript` | 5.9.3 | Apache-2.0 | backend | dev |
| `dotenv` | 16.6.1 | BSD-2-Clause | backend | prod |
| `lucide-react` | 0.294.0 | ISC | frontend | prod |
| `node-cron` | 3.0.3 | ISC | worker | prod |

## Dependency-specific notes

- **`@supabase/supabase-js`, `@supabase/auth-helpers-nextjs`** — MIT. Integration code, not
  vendored source. The community edition requires an external Supabase project for auth; the
  proprietary edition removes that external dependency with self-hosted auth. See
  `docs/AUTH_DESIGN.md`.
- **`stripe`** — MIT. Integration code only. Stripe is an external service and is not an asset
  we can transfer. Any buyer must obtain their own Stripe account.
- **`resend`** — MIT. Integration code only, same caveat as Stripe.
- **`prisma` / `@prisma/client`** — Apache-2.0. The Prisma client is generated at install time
  from `schema.prisma`. Generated client output is not third-party source and is covered by
  this repository's license; the query engine binaries downloaded at runtime remain
  Apache-2.0 third-party artifacts.
- **`bullmq`, `ioredis`** — MIT. Declared in `worker/package.json` but **never imported
  anywhere in the codebase**. The worker schedules in-process with `setInterval` and
  `node-cron`. The Redis-backed queue that would let it scale horizontally is not
  implemented; see `ROADMAP.md` (P1). Listed here because a dependency is still shipped
  and licensed, and a buyer inheriting it should know it is unused.
- **Binary assets** — the only bundled non-source asset is `.github/api-monitor-og.svg`,
  authored for this project. `lucide-react` (ISC) is consumed as an icon library dependency and
  is not redistributed as source.

## Change policy for this file

Regenerate, do not hand-edit. If `node scripts/audit-licenses.js` reports a copyleft or unknown
license, the dependency must be removed or replaced before the change can merge.
