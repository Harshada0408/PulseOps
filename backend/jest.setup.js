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

// Non-secret placeholder values so modules that validate the environment at import time can load under test.
// (Unit tests mock every network/database dependency; the integration suite only uses DATABASE_URL.)
const testDefaults = {
  JWT_SECRET: 'test-only-secret-'.repeat(5),
  FRONTEND_URL: 'http://localhost:3000',
  FROM_EMAIL: 'test@example.com',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
};
for (const [k, v] of Object.entries(testDefaults)) if (!process.env[k]) process.env[k] = v;
