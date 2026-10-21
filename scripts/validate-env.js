#!/usr/bin/env node

require('dotenv').config();

/**
 * Environment variable validation script
 * Ensures all required environment variables are set before starting the application
 */

const requiredEnvVars = [
  // Backend
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',

  // Frontend
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_API_URL',

  // Stripe
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',

  // Email
  'RESEND_API_KEY',

  // Redis
  'REDIS_URL',
];

const missingVars = [];

for (const varName of requiredEnvVars) {
  const value = process.env[varName];

  if (
    !value ||
    value.trim() === '' ||
    value.includes('[project-ref]') ||
    value.includes('[anon-key]') ||
    value.includes('[service-role-key]') ||
    value.includes('[password]')
  ) {
    missingVars.push(varName);
  }
}

if (missingVars.length > 0) {
  console.error('❌ Missing or placeholder environment variables:');

  missingVars.forEach((varName) => {
    console.error(`  - ${varName}`);
  });

  console.error('\nPlease update your .env file with real values.');

  process.exit(1);
}

console.log('✅ All required environment variables are set');
process.exit(0);