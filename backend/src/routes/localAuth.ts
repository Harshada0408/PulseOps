import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { sqlDb } from '../config/sql';
import { asyncHandler, AppError } from '../middleware/error';
import { hashPassword, verifyPassword } from '../utils/password';
import { signToken, verifyToken } from '../utils/jwt';

/**
 * Local email/password auth (AUTH_MODE=local). Response shapes intentionally match the original
 * Supabase-backed routes so the frontend works with either mode.
 */
const router = Router();
const ACCESS_TTL = 60 * 60; // 1 hour
const REFRESH_TTL = 30 * 24 * 60 * 60; // 30 days

const signupSchema = z.object({
  email: z.string().email('Invalid email address').max(254).transform((e) => e.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password is too long'),
  name: z.string().min(1, 'Name is required').max(100).optional(),
});
const signinSchema = z.object({
  email: z.string().email().max(254).transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(128),
});

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 64) throw new AppError('Server is not configured for authentication', 500);
  return s;
};

const session = (id: string, email: string) => {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: signToken({ sub: id, email, typ: 'access' }, secret(), ACCESS_TTL, now),
    refresh_token: signToken({ sub: id, email, typ: 'refresh' }, secret(), REFRESH_TTL, now),
    expires_at: now + ACCESS_TTL,
  };
};

router.post('/signup', asyncHandler(async (req, res) => {
  if (process.env.ENABLE_SIGNUPS === 'false') throw new AppError('Sign-ups are disabled', 403);
  const { email, password, name } = signupSchema.parse(req.body);
  const hash = await hashPassword(password);
  const id = randomUUID();
  const inserted = await sqlDb.query<{ id: string }>(
    `INSERT INTO users (id, email, username, name, password_hash, updated_at)
     VALUES ($1, $2, $3, $4, $5, (now() AT TIME ZONE 'UTC'))
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [id, email, `${email.split('@')[0]}-${id.slice(0, 6)}`.toLowerCase(), name ?? email.split('@')[0], hash]
  );
  if (inserted.length === 0) throw new AppError('An account with this email already exists', 409);
  res.status(201).json({
    message: 'Account created successfully.',
    user: { id, email, name: name ?? email.split('@')[0] },
    session: session(id, email),
  });
}));

router.post('/signin', asyncHandler(async (req, res) => {
  const { email, password } = signinSchema.parse(req.body);
  const rows = await sqlDb.query<{ id: string; email: string; name: string | null; password_hash: string | null; is_active: boolean }>(
    `SELECT id, email, name, password_hash, "isActive" AS is_active FROM users WHERE email = $1`, [email]);
  const user = rows[0];
  const ok = await verifyPassword(password, user?.password_hash ?? null);
  // One message for unknown user, wrong password and local-mode-less accounts.
  if (!user || !ok) throw new AppError('Invalid email or password', 401);
  if (!user.is_active) throw new AppError('Account disabled', 403);
  await sqlDb.query(`UPDATE users SET last_login_at = (now() AT TIME ZONE 'UTC') WHERE id = $1`, [user.id]);
  res.json({ session: session(user.id, user.email), user: { id: user.id, email: user.email, name: user.name } });
}));

router.post('/signout', (_req, res) => {
  // Stateless tokens: the client discards them. (Revocation list is listed as a limitation.)
  res.json({ message: 'Signed out successfully' });
});

router.get('/me', asyncHandler(async (req, res) => {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  const claims = token ? verifyToken(token, secret(), 'access') : null;
  if (!claims) throw new AppError('Authentication required', 401);
  const rows = await sqlDb.query<{ id: string; email: string; name: string | null; avatar: string | null; created_at: Date; is_active: boolean; monitors: number }>(
    `SELECT u.id, u.email, u.name, u.avatar, u.created_at, u."isActive" AS is_active,
            (SELECT count(*)::int FROM monitors m WHERE m.user_id = u.id AND NOT m.is_simulated) AS monitors
       FROM users u WHERE u.id = $1`, [claims.sub]);
  const u = rows[0];
  if (!u || !u.is_active) throw new AppError('Authentication required', 401);
  res.json({ user: { id: u.id, email: u.email, name: u.name, avatar: u.avatar, createdAt: u.created_at, monitorCount: u.monitors } });
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const refresh = z.object({ refresh_token: z.string().min(10) }).parse(req.body).refresh_token;
  const claims = verifyToken(refresh, secret(), 'refresh');
  if (!claims) throw new AppError('Authentication required', 401);
  const rows = await sqlDb.query<{ id: string; email: string; is_active: boolean }>(
    `SELECT id, email, "isActive" AS is_active FROM users WHERE id = $1`, [claims.sub]);
  if (!rows[0] || !rows[0].is_active) throw new AppError('Authentication required', 401);
  res.json({ session: session(rows[0].id, rows[0].email) });
}));

export default router;
