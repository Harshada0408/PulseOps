import { supabaseAdmin } from '../config/supabase';
import { AuthenticatedUser, AuthProvider } from './provider';

/**
 * The default identity system: Supabase Auth.
 *
 * Every call goes through the service-role client, which is why `SUPABASE_URL` and
 * `SUPABASE_SERVICE_ROLE_KEY` are the two values this provider needs. The service-role
 * key bypasses row-level security, so it is used for verification only and never
 * forwarded to a browser.
 */
export const supabaseAuthProvider: AuthProvider = {
  name: 'supabase',

  async verifyToken(token: string): Promise<AuthenticatedUser | null> {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);

    if (error || !user || !user.email) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      name: (user.user_metadata?.name as string | undefined) ?? null,
      avatar: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    };
  },
};
