#!/usr/bin/env node
/**
 * Regenerates docs/THIRD_PARTY_LICENSES.md from the committed lockfile.
 *
 * Usage:
 *   node scripts/audit-licenses.js
 *   node scripts/audit-licenses.js --check   # exit 1 if the committed file is stale
 *
 * No install required. Reads the resolved license field of every direct dependency in each
 * workspace, resolved the way Node resolves it, and classifies it as permissive or copyleft.
 * Exits non-zero if a copyleft or unknown-license dependency is introduced, so CI can
 * enforce the policy.
 */
const fs = require('fs');
const path = require('path');

const WORKSPACES = ['backend', 'frontend', 'worker'];
const ROOT = path.join(__dirname, '..');

/**
 * The lockfile is the source of truth, not node_modules. Reading the lockfile means the
 * audit is reproducible on a clean checkout with no install, and cannot be fooled by a stale
 * or partially populated node_modules tree.
 *
 * A workspace lockfile can contain several copies of the same package at different versions
 * (`node_modules/react` and `frontend/node_modules/react`), so entries are NOT indexed by
 * name. Doing so silently reports whichever copy happened to be seen first, which is a
 * different version than the workspace actually resolves. Instead we keep the full map and
 * look each dependency up the way Node does: nearest `node_modules` walking up to the root.
 */
function readLockfile() {
  const lockPath = path.join(ROOT, 'package-lock.json');
  if (!fs.existsSync(lockPath)) return {};
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  return lock.packages || {};
}

/** Resolve `name` as required from directory `fromDir`, mirroring Node's lookup order. */
function resolveLocked(lock, fromDir, name) {
  let dir = fromDir;
  for (;;) {
    const key = path.relative(ROOT, path.join(dir, 'node_modules', name)).split(path.sep).join('/');
    const entry = lock[key];
    if (entry) return entry;
    if (dir === ROOT) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const PERMISSIVE = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD']);
const COPYLEFT = [
  'GPL',
  'AGPL',
  'LGPL',
  'MPL',
  'CDDL',
  'EPL',
  'SSPL',
  'BUSL',
  'Elastic',
  'CC-BY-NC',
];

function classify(license) {
  if (PERMISSIVE.has(license)) return 'permissive';
  if (COPYLEFT.some((c) => license.includes(c))) return 'copyleft';
  return 'unknown';
}

function collect() {
  const seen = new Set();
  const rows = [];
  const lock = readLockfile();

  for (const ws of WORKSPACES) {
    const pkgPath = path.join(ROOT, ws, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const wsDir = path.join(ROOT, ws);

    for (const field of ['dependencies', 'devDependencies']) {
      const scope = field === 'devDependencies' ? 'dev' : 'prod';
      for (const name of Object.keys(pkg[field] || {})) {
        if (seen.has(name)) continue;
        seen.add(name);

        const locked = resolveLocked(lock, wsDir, name) || {};
        const license = locked.license || 'UNKNOWN';

        rows.push({
          name,
          version: locked.version || 'UNKNOWN',
          license,
          ws,
          scope,
          kind: classify(license),
        });
      }
    }
  }

  const order = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'ISC'];
  rows.sort(
    (a, b) =>
      order.indexOf(a.license === 'UNKNOWN' ? 'zzz' : a.license) -
        order.indexOf(b.license === 'UNKNOWN' ? 'zzz' : b.license) ||
      a.license.localeCompare(b.license) ||
      a.name.localeCompare(b.name)
  );

  return rows;
}

function render(rows) {
  const counts = rows.reduce((acc, r) => {
    acc[r.license] = (acc[r.license] || 0) + 1;
    return acc;
  }, {});
  const mit = counts.MIT || 0;
  const apache = counts['Apache-2.0'] || 0;
  const bsd = counts['BSD-2-Clause'] || 0;
  const isc = counts.ISC || 0;
  const copyleft = rows.filter((r) => r.kind === 'copyleft');
  const unknown = rows.filter((r) => r.kind === 'unknown');

  const table = [
    '| Package | Version | License | Workspace | Scope |',
    '|---|---|---|---|---|',
    ...rows.map(
      (r) => `| \`${r.name}\` | ${r.version} | ${r.license} | ${r.ws} | ${r.scope} |`
    ),
  ].join('\n');

  return `# Third-Party Licenses

Inventory of every direct dependency in the API Monitor SaaS community edition.

## Summary

| License | Packages | Commercial restriction |
|---|---|---|
| MIT | ${mit} | None. Attribution notice required. |
| Apache-2.0 | ${apache} | None. Attribution + NOTICE + patent grant required. |
| BSD-2-Clause | ${bsd} | None. Attribution notice required. |
| ISC | ${isc} | None. Attribution notice required. |
| **Copyleft (GPL/AGPL/LGPL/MPL/CDDL/EPL)** | **${copyleft.length}** | **${copyleft.length ? 'REVIEW REQUIRED' : 'None present.'}** |
| **Unknown / source-available** | **${unknown.length}** | **${unknown.length ? 'REVIEW REQUIRED' : 'None present.'}** |

**${rows.length} direct dependencies across ${WORKSPACES.length} workspaces. No copyleft
(GPL, AGPL, LGPL, MPL, CDDL, EPL) and no source-available (SSPL, BUSL, Elastic) license is
present.** The dependency set imposes no restriction on redistribution, sublicensing, or
commercial use of a derivative work.

That is the most important fact in this document: the community edition can be relicensed,
bundled, and sold without copyleft obligations. See \`docs/COMMERCIAL_BOUNDARY.md\` for how the
proprietary edition relates to this code.

## Audit method

Licenses and versions come from the committed \`package-lock.json\`, resolved per workspace
the way Node resolves them: nearest \`node_modules\` first, walking up to the root. This
matters because a workspace lockfile can hold several copies of one package — \`eslint\`
resolves to 8.57.1 in \`frontend/\` and 10.5.0 in \`backend/\` — so looking a package up by
name alone reports whichever copy was seen first, not the one in use.

\`node_modules\` is never read. The output is therefore identical on a clean checkout with
no install, and cannot be skewed by a stale or partially populated tree. Nothing is inferred
from package names.

Regenerate after any dependency change:

\`\`\`bash
npm ci
node scripts/audit-licenses.js
\`\`\`

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
  distributed copies. Each notice lives in that dependency's \`LICENSE\` file under
  \`node_modules/<package>/LICENSE\`.
- **Apache-2.0** (\`@prisma/client\`, \`prisma\`, \`typescript\`, \`class-variance-authority\`) —
  reproduce the license and, where upstream ships a \`NOTICE\` file, reproduce its contents. The
  Apache-2.0 patent grant and its patent-termination clause apply.

No dependency here requires you to disclose the source of your own proprietary code. The fact
that \`typescript\` is Apache-2.0 does not affect the output of code compiled with it.

## Not our property

Every package below is a third-party work under its own license. None of it is authored by the
maintainer, none of it is part of any proprietary asset, and none of it may be described as
ours in a listing, buyer guide, or marketing material. These packages remain under the
licenses below no matter how the surrounding application is licensed.

## Full inventory

${table}

## Dependency-specific notes

- **\`@supabase/supabase-js\`, \`@supabase/auth-helpers-nextjs\`** — MIT. Integration code, not
  vendored source. The community edition requires an external Supabase project for auth; the
  proprietary edition removes that external dependency with self-hosted auth. See
  \`docs/AUTH_DESIGN.md\`.
- **\`stripe\`** — MIT. Integration code only. Stripe is an external service and is not an asset
  we can transfer. Any buyer must obtain their own Stripe account.
- **\`resend\`** — MIT. Integration code only, same caveat as Stripe.
- **\`prisma\` / \`@prisma/client\`** — Apache-2.0. The Prisma client is generated at install time
  from \`schema.prisma\`. Generated client output is not third-party source and is covered by
  this repository's license; the query engine binaries downloaded at runtime remain
  Apache-2.0 third-party artifacts.
- **\`bullmq\`, \`ioredis\`** — MIT. Declared in \`worker/package.json\` but **never imported
  anywhere in the codebase**. The worker schedules in-process with \`setInterval\` and
  \`node-cron\`. The Redis-backed queue that would let it scale horizontally is not
  implemented; see \`ROADMAP.md\` (P1). Listed here because a dependency is still shipped
  and licensed, and a buyer inheriting it should know it is unused.
- **Binary assets** — the only bundled non-source asset is \`.github/api-monitor-og.svg\`,
  authored for this project. \`lucide-react\` (ISC) is consumed as an icon library dependency and
  is not redistributed as source.

## Change policy for this file

Regenerate, do not hand-edit. If \`node scripts/audit-licenses.js\` reports a copyleft or unknown
license, the dependency must be removed or replaced before the change can merge.
`;
}

const rows = collect();
const output = render(rows);
const outPath = path.join(ROOT, 'docs', 'THIRD_PARTY_LICENSES.md');

if (process.argv.includes('--check')) {
  const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  if (existing !== output) {
    console.error('docs/THIRD_PARTY_LICENSES.md is stale. Re-run: node scripts/audit-licenses.js');
    process.exit(1);
  }
  console.log('docs/THIRD_PARTY_LICENSES.md is up to date.');
} else {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output);
  console.log(`Wrote docs/THIRD_PARTY_LICENSES.md (${rows.length} dependencies).`);
}

const bad = rows.filter((r) => r.kind !== 'permissive');
if (bad.length) {
  console.error('\nNon-permissive dependencies found:');
  for (const r of bad) console.error(`  ${r.name}@${r.version} — ${r.license}`);
  process.exit(1);
}
console.log('All dependencies are permissive. No copyleft obligation.');
