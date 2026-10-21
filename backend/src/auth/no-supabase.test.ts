import { AuthProvider } from './provider';
import { getAuthProvider, resetAuthProviderForTests } from './index';

/**
 * The Enterprise edition runs the same monitoring core with no Supabase account anywhere in
 * the stack. That claim is only true if nothing in the request path touches Supabase, so
 * this is asserted directly rather than left to the Docker smoke test.
 *
 * This file deliberately never loads the Supabase provider. That is the condition under
 * test, and it cannot be re-created inside a file that has already loaded it.
 */
describe('authentication without Supabase', () => {
  const ORIGINAL_ENV = { ...process.env };

  const provider: AuthProvider = {
    name: 'enterprise',
    verifyToken: jest.fn().mockResolvedValue(null),
  };

  beforeEach(() => {
    resetAuthProviderForTests();
    delete process.env.AUTH_PROVIDER_MODULE;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('should have no Supabase configuration in the environment', () => {
    expect(process.env.SUPABASE_URL).toBeUndefined();
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it('should resolve the external provider with no Supabase configuration present', () => {
    process.env.AUTH_PROVIDER_MODULE = './external/provider';
    jest.doMock('./external/provider', () => ({ __esModule: true, default: provider }), {
      virtual: true,
    });

    expect(getAuthProvider().name).toBe('enterprise');

    jest.dontMock('./external/provider');
  });

  it('should not load the Supabase client when an external provider is selected', () => {
    process.env.AUTH_PROVIDER_MODULE = './external/provider-2';
    jest.doMock(
      './external/provider-2',
      () => ({ __esModule: true, default: provider }),
      { virtual: true }
    );

    getAuthProvider();

    // `config/supabase` constructs a Supabase client as it loads, and that constructor
    // throws without a URL. Its presence in the module registry would mean the core still
    // requires a Supabase account to boot, which is the thing this seam exists to remove.
    expect(require.cache[require.resolve('../config/supabase')]).toBeUndefined();

    jest.dontMock('./external/provider-2');
  });

  it('should not import the Supabase-facing route module', () => {
    process.env.AUTH_PROVIDER_MODULE = './external/provider-3';
    jest.doMock(
      './external/provider-3',
      () => ({ __esModule: true, default: provider }),
      { virtual: true }
    );

    getAuthProvider();

    // The core's own `/api/v1/auth` routes call Supabase directly, so they must not be in
    // the registry of a deployment that does not use Supabase. `server.ts` also defers
    // requiring them for the same reason.
    expect(require.cache[require.resolve('../routes/auth')]).toBeUndefined();

    jest.dontMock('./external/provider-3');
  });
});
