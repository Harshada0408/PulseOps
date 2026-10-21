#!/usr/bin/env node
/**
 * Runs the Prisma CLI against backend/prisma/schema.prisma using the repo-root .env
 * (the Prisma CLI would otherwise only look in backend/). Cross-platform (Windows-safe).
 *
 *   node scripts/prisma-cli.js migrate deploy
 *   node scripts/prisma-cli.js generate
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env');
const env = { ...process.env };
if (fs.existsSync(envFile)) {
  const parsed = require('dotenv').parse(fs.readFileSync(envFile));
  for (const [k, v] of Object.entries(parsed)) if (env[k] === undefined) env[k] = v;
} else if (!env.DATABASE_URL) {
  console.error('No .env found and DATABASE_URL is not set. Run:  npm run setup:env   then edit DATABASE_URL in .env');
  process.exit(1);
}

const args = process.argv.slice(2);
const needsSchema = !['--version', '-v', 'version'].includes(args[0]);
const result = spawnSync('npx', ['prisma', ...args, ...(needsSchema ? ['--schema', 'backend/prisma/schema.prisma'] : [])], {
  cwd: root, env, stdio: 'inherit', shell: true,
});
process.exit(result.status ?? 1);
