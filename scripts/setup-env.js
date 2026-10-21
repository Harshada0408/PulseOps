#!/usr/bin/env node
/**
 * Creates .env from .env.example with a freshly generated JWT_SECRET.
 * Never overwrites an existing .env. Works on Windows, macOS and Linux (Node only).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const target = path.join(root, '.env');
if (fs.existsSync(target)) {
  console.log('.env already exists - leaving it untouched.');
  process.exit(0);
}
const secret = crypto.randomBytes(48).toString('base64');
const content = fs.readFileSync(path.join(root, '.env.example'), 'utf8').replace(/^JWT_SECRET=.*$/m, `JWT_SECRET="${secret}"`);
fs.writeFileSync(target, content, { mode: 0o600 });
console.log('Created .env with a new random JWT_SECRET.');
console.log('Next: edit DATABASE_URL in .env so it matches your PostgreSQL user/password/database.');
