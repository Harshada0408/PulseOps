/**
 * The seam between the monitoring core and whatever authenticates its users.
 *
 * ## Why this exists
 *
 * The core only ever needed one thing from an identity system: given the credential on
 * a request, tell me which user this is, or that there isn't one. That is deliberately
 * a small interface, and it is the whole reason an alternative identity system can be
 * added without forking the core.
 *
 * The bundled Supabase provider is the default and the supported community path. Setting
 * `AUTH_PROVIDER_MODULE` to a module that exports a provider replaces it wholesale, which
 * is how the self-hosted Enterprise edition runs the same monitoring core with no Supabase
 * account anywhere in the stack.
 *
 * ## What this is not
 *
 * This is not a plugin marketplace and not an attempt to anticipate every identity
 * system. It is one method, because that is the one method the core uses. Adding
 * methods speculatively would mean guessing at contracts the core does not have.
 *
 * ## Contract a provider must honour
 *
 * * `verifyToken` is called on every authenticated request and must be **stateless and
 *   side-effect free**. It must not refresh, rotate, or write anything; a middleware
 *   that mutates on a read turns every concurrent request into a write and turns a
 *   revocation into a race.
 * * Returning `null` means "not authenticated" and nothing more. A provider must not
 *   signal "expired" or "revoked" as an error — the core cannot act on the difference and
 *   would only produce a worse message.
 * * A provider that throws for a bad credential is a bug. The core maps every failure to a
 *   single 401 so that credential validity is not distinguishable by timing or message.
 * * The returned identity is written straight onto `req.user` and is used as `Monitor.userId`.
 *   A provider is responsible for the stability and uniqueness of that id.
 */
export interface AuthenticatedUser {
  /** Stable, unique, and stable across sessions. Used as the owner of the user's data. */
  id: string;
  email: string;
  name?: string | null;
  avatar?: string | null;
}

export interface AuthProvider {
  /** Machine-readable name, used in logs and diagnostics. */
  readonly name: string;

  /**
   * Resolve a bearer token to a user.
   *
   * Must return `null` for anything that is not a currently valid credential, and must
   * not throw for an invalid or expired credential.
   */
  verifyToken(token: string): Promise<AuthenticatedUser | null>;
}
