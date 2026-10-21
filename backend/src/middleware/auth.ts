import { Response, NextFunction } from 'express';
import { getAuthProvider } from '../auth';
import { prisma } from '../config/database';
import { AuthRequest } from '../types';
import { AppError } from './error';

/**
 * Require a valid credential and attach its user to the request.
 *
 * Which identity system is asked is decided by `AUTH_PROVIDER_MODULE` (see
 * `src/auth/provider.ts`); everything below this line is provider-independent. The
 * database lookup stays here on purpose: the core owns the record that decides whether an
 * account is usable, so an alternative identity system cannot accidentally authenticate a
 * user this installation has disabled.
 *
 * Every failure produces the same 401. Distinguishing "no token", "bad token" and "expired
 * token" in the response would let a caller learn which tokens exist, and the account
 * check below deliberately reports differently because that is a real, actionable
 * condition for the user rather than a probe of someone else's credential.
 */
export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    // One message for every failed credential, which is what `auth/provider.ts` promises:
    // "the core maps every failure to a single 401 so that credential validity is not
    // distinguishable by timing or message". Two distinct messages, one for a missing header
    // and one for an unusable token, let a caller tell "sent nothing" from "sent something
    // that did not work" — a free oracle for deciding whether a token is close to valid, and
    // a needless difference between what this file documents and what it does.
    const unauthenticated = () => new AppError('Authentication required', 401);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw unauthenticated();
    }

    const token = authHeader.split(' ')[1];

    const identity = await getAuthProvider().verifyToken(token);

    if (!identity) {
      throw unauthenticated();
    }

    const dbUser = await prisma.user.findUnique({
      where: {
        id: identity.id,
      },
      include: {
        subscription: true,
      },
    });

    if (!dbUser) {
      throw new AppError('User account not found', 404);
    }

    const isAccountActive =
      (dbUser as { isActive?: boolean; active?: boolean; is_active?: boolean })
        .isActive ??
      (dbUser as { isActive?: boolean; active?: boolean; is_active?: boolean })
        .active ??
      (dbUser as { isActive?: boolean; active?: boolean; is_active?: boolean })
        .is_active ??
      true;

    if (!isAccountActive) {
      throw new AppError('Account disabled', 403);
    }

    req.user = {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name || undefined,
      avatar: dbUser.avatar || undefined,
    };

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Attach a user if a valid credential is present, and continue either way.
 *
 * Used by endpoints that are public but render differently when signed in. A credential
 * that fails to verify is treated as absent rather than as an error: this is not the
 * endpoint where a caller is being authenticated, and turning a stale token in local
 * storage into a hard failure here would break public pages for no security benefit.
 */
export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];

    const identity = await getAuthProvider().verifyToken(token);

    if (identity) {
      req.user = {
        id: identity.id,
        email: identity.email,
      };
    }

    next();
  } catch {
    next();
  }
};
