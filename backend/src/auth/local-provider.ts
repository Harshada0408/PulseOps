import { AuthenticatedUser, AuthProvider } from './provider';
import { verifyToken } from '../utils/jwt';

/**
 * Built-in identity provider for AUTH_MODE=local: HS256 access tokens signed with JWT_SECRET.
 * Stateless and side-effect free, as the AuthProvider contract requires. The auth middleware
 * still loads the user row, so a disabled account cannot authenticate.
 */
export const localAuthProvider: AuthProvider = {
  name: 'local',
  async verifyToken(token: string): Promise<AuthenticatedUser | null> {
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    const claims = verifyToken(token, secret, 'access');
    return claims ? { id: claims.sub, email: claims.email } : null;
  },
};
