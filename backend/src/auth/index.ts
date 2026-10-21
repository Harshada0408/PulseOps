import { AuthProvider } from './provider';

/**
 * Resolves which identity system the core authenticates against.
 *
 * Resolution is lazy and cached. It has to be lazy: the bundled Supabase provider reads
 * its configuration when its module is first loaded, and an external provider has no
 * Supabase configuration at all. Importing both eagerly would mean the core refuses to
 * start unless Supabase is configured, which is exactly the dependency the Enterprise
 * edition exists to remove.
 */
let resolved: AuthProvider | null = null;

/** Does this value satisfy the provider contract? */
function isProvider(value: unknown): value is AuthProvider {
  const candidate = value as AuthProvider | null | undefined;
  return (
    !!candidate &&
    typeof candidate.verifyToken === 'function' &&
    typeof candidate.name === 'string'
  );
}

function loadExternalProvider(moduleId: string): AuthProvider {
  let loaded: unknown;
  try {
    loaded = require(moduleId);
  } catch (error) {
    throw new Error(
      `AUTH_PROVIDER_MODULE is set to "${moduleId}" but that module could not be loaded. ` +
        `Authentication cannot start. (${error instanceof Error ? error.message : String(error)})`,
      { cause: error }
    );
  }

  // Accept the three shapes a CommonJS or transpiled module can arrive in, and check the
  // module object itself first so that a plain `module.exports = provider` is honoured
  // rather than silently rejected. A provider written as `module.exports = { authProvider }`
  // and a transpiled `export default` both land here.
  const named = (loaded as { authProvider?: unknown } | null)?.authProvider;
  const asDefault = (loaded as { default?: unknown } | null)?.default;
  const namedInDefault = (asDefault as { authProvider?: unknown } | undefined)?.authProvider;

  const provider = [loaded, named, asDefault, namedInDefault].find(isProvider);

  if (!provider) {
    throw new Error(
      `AUTH_PROVIDER_MODULE is set to "${moduleId}" but it does not export an auth provider. ` +
        `Export a default, or a named \`authProvider\`, with \`name\` and \`verifyToken\`.`
    );
  }

  return provider;
}

/** The identity system in use. Supabase unless `AUTH_PROVIDER_MODULE` says otherwise. */
export function getAuthProvider(): AuthProvider {
  if (resolved) return resolved;

  const moduleId = process.env.AUTH_PROVIDER_MODULE;
  if (moduleId && moduleId.trim() !== '') {
    resolved = loadExternalProvider(moduleId.trim());
    return resolved;
  }

  if (process.env.AUTH_MODE === 'local') {
    const { localAuthProvider } = require('./local-provider') as { localAuthProvider: AuthProvider };
    resolved = localAuthProvider;
    return resolved;
  }

  // Required here rather than at the top of the file so that a deployment using an
  // external provider never loads Supabase at all.
  const { supabaseAuthProvider } = require('./supabase-provider') as {
    supabaseAuthProvider: AuthProvider;
  };
  resolved = supabaseAuthProvider;
  return resolved;
}

/**
 * True when an operator has replaced the bundled identity system.
 *
 * The core's own `/api/v1/auth/*` routes speak Supabase's session format, so they are
 * not mounted when something else owns authentication. Failing that would leave a second,
 * half-working sign-in path on the same origin, which is worse than having none.
 */
export function isExternalAuthProvider(): boolean {
  const moduleId = process.env.AUTH_PROVIDER_MODULE;
  return Boolean(moduleId && moduleId.trim() !== '');
}

/** Test seam: forget the cached provider so a new `AUTH_PROVIDER_MODULE` takes effect. */
export function resetAuthProviderForTests(): void {
  resolved = null;
}
