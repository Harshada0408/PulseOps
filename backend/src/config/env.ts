import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({
  path: path.resolve(__dirname, '../../../.env'),
});

const booleanFromEnv = z.preprocess((val) => {
  if (val === undefined) return undefined;
  return ['1', 'true', 'yes', 'on'].includes(String(val).toLowerCase());
}, z.boolean());

/**
 * An optional variable where "" and whitespace mean "not set".
 *
 * `.optional()` alone accepts `undefined` but rejects `""`, and an empty value is the
 * natural way to write "I have not set this" in a `.env` file or a Compose
 * `environment:` list — which then fails validation and stops the process. That turns a
 * documented, harmless default into an outage, so blank is normalised to absent here
 * rather than at each call site.
 */
const optionalString = z.preprocess(
  (val) => {
    if (typeof val !== 'string') return val;
    return val.trim() === '' ? undefined : val.trim();
  },
  z.string().min(1).optional()
);

const envSchema = z.object({
NODE_ENV: z.enum([
'development',
'production',
'test',
]).default('development'),

PORT: z.coerce.number().int().positive().default(3001),

DATABASE_URL: z.string().min(1),

// Required only when the bundled Supabase identity system is in use. When
// AUTH_PROVIDER_MODULE points at an alternative, this installation has no Supabase
// account at all and demanding these values would make that deployment impossible to
// configure. The check below turns them back into hard requirements for a Supabase
// deployment, so this is a relaxation of *where* they are demanded, not of whether.
SUPABASE_URL: optionalString.refine(
  (val) => val === undefined || z.string().url().safeParse(val).success,
  { message: 'Must be a valid URL' }
),

SUPABASE_ANON_KEY: optionalString,

SUPABASE_SERVICE_ROLE_KEY: optionalString,

AUTH_PROVIDER_MODULE: optionalString,

// 'local' = built-in email/password auth stored in PostgreSQL (no external account needed).
// 'supabase' = the original Supabase-backed auth. Code default stays 'supabase' for
// backward compatibility; .env.example sets 'local'.
AUTH_MODE: z.enum(['local', 'supabase']).default('supabase'),

// Self-hosted default cap (applies when ENABLE_BILLING is false).
MAX_MONITORS_PER_USER: z.coerce.number().int().min(1).max(1000).default(50),

// Optional AI investigation assistant. 'none' (default) disables it entirely.
AI_PROVIDER: z.enum(['none', 'openai-compatible']).default('none'),
AI_BASE_URL: optionalString,
AI_API_KEY: optionalString,
AI_MODEL: optionalString,

JWT_SECRET: z.string().min(
64,
'JWT_SECRET must be at least 64 characters'
),

FRONTEND_URL: z.string().url(),

REDIS_URL: z.string().url().optional(),

STRIPE_SECRET_KEY: z.string().optional(),
STRIPE_WEBHOOK_SECRET: z.string().optional(),
STRIPE_PRICE_BASIC: z.string().optional(),
STRIPE_PRICE_PRO: z.string().optional(),

RESEND_API_KEY: z.string().optional(),

FROM_EMAIL: z.string().email(),

ENABLE_EMAILS: booleanFromEnv.default(false),

ENABLE_BILLING: booleanFromEnv.default(false),

ENABLE_SIGNUPS: booleanFromEnv.default(true),

ENABLE_WORKSPACES: booleanFromEnv.default(true),

ENABLE_TEAMS: booleanFromEnv.default(true),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
console.error(
'Environment validation failed'
);

console.error(
parsed.error.flatten().fieldErrors
);

process.exit(1);
}

const data = parsed.data;

if (
data.NODE_ENV === 'production'
) {
if (
data.ENABLE_EMAILS &&
!data.RESEND_API_KEY
) {
throw new Error(
'RESEND_API_KEY required in production'
);
}

// A Supabase deployment still needs all three values, and finding out at the first login
// attempt rather than at startup is a bad way to learn it. An external provider
// deployment must not have them required at all.
if (!data.AUTH_PROVIDER_MODULE && data.AUTH_MODE === 'supabase') {
  const missing = (['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const).filter(
    (key) => !data[key]
  );
  if (missing.length > 0) {
    console.error(
      `Missing required environment variable(s): ${missing.join(', ')}.\n` +
        'The bundled Supabase identity system is selected because AUTH_PROVIDER_MODULE is not set.\n' +
        'Set the Supabase values, or set AUTH_PROVIDER_MODULE to use a different identity system.'
    );
    process.exit(1);
  }
}

if (
  data.ENABLE_BILLING &&
  !data.STRIPE_SECRET_KEY
) {
  console.warn(
    'ENABLE_BILLING=true but STRIPE_SECRET_KEY is missing — billing disabled until keys are added'
  );
}
}

export const env = {
...data,

isProduction:
data.NODE_ENV === 'production',

isDevelopment:
data.NODE_ENV === 'development',

isTest:
data.NODE_ENV === 'test',
};
