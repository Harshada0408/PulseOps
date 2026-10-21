// Tests only inherit the database settings from the repo-root .env. Everything else (JWT_SECRET, AUTH_MODE, ...)
// is deliberately NOT inherited so tests behave the same on every machine and in CI.
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '../.env');
if (fs.existsSync(file)) {
  const parsed = require('dotenv').parse(fs.readFileSync(file));
  for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL']) {
    if (parsed[key] && !process.env[key]) process.env[key] = parsed[key];
  }
}
