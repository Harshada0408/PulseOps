/**
 * Environment validation for the identity system selection.
 *
 * Runs in a child process because `config/env` validates on import and calls
 * `process.exit(1)` on failure — the behaviour under test cannot be observed in-process.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as ts from 'typescript';

const SOURCE_ENV = path.resolve(__dirname, 'env.ts');

/** The copied module still needs zod and dotenv, so it is pointed at the repo's modules. */
const NODE_PATH = [
  path.resolve(__dirname, '../../node_modules'),
  path.resolve(__dirname, '../../../node_modules'),
].join(path.delimiter);
/** Everything `config/env` requires regardless of which identity system is selected. */
const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  PORT: '3001',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(70),
  FRONTEND_URL: 'http://localhost:3000',
  FROM_EMAIL: 'a@b.co',
};

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Transpile `env.ts` into a throwaway directory and load it in a child process.
 *
 * Three things force this shape.
 *
 * `config/env` validates on import and calls `process.exit(1)` on failure, so it cannot be
 * observed in-process — that would kill the Jest worker rather than fail an assertion.
 *
 * It also calls `dotenv.config()` against a path resolved from its own directory, so
 * loading it in place would pick up the developer's real `.env` and turn every negative
 * test into a positive one. The transpiled copy is given its own `pkg/dist/config` layout
 * so that same relative lookup lands in a tree that provably has no `.env`.
 *
 * And it transpiles the source rather than copying `dist/`, so the suite does not depend
 * on a build having run first. Depending on a build artifact made this suite pass or fail
 * depending on what happened to be in the working tree.
 */
function loadEnv(vars: Record<string, string | undefined>): RunResult {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apimon-env-'));
  const configDir = path.join(tmpRoot, 'pkg', 'dist', 'config');
  fs.mkdirSync(configDir, { recursive: true });

  const transpiled = ts.transpileModule(fs.readFileSync(SOURCE_ENV, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: 'env.ts',
  });
  fs.writeFileSync(path.join(configDir, 'env.js'), transpiled.outputText);

  const env: Record<string, string> = { ...BASE_ENV };
  // The copied tree must not find a `.env` at any level it looks in.
  env.HOME = tmpRoot;
  env.NODE_PATH = NODE_PATH;
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  try {
    const stdout = execFileSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(path.join(configDir, 'env.js'))});console.log('LOADED_OK')`],
      {
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: tmpRoot,
      }
    );
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

describe('identity system environment configuration', () => {
  describe('Supabase is the default', () => {
    it('should load when the three Supabase values are present', () => {
      const result = loadEnv({
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_ANON_KEY: 'anon',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
      });
      expect(result.stdout).toContain('LOADED_OK');
    });

    it('should refuse to start without Supabase values, and say which are missing', () => {
      const result = loadEnv({});
      expect(result.stdout).not.toContain('LOADED_OK');
      expect(result.stderr).toContain('Missing required environment variable(s)');
      expect(result.stderr).toContain('SUPABASE_URL');
      expect(result.stderr).toContain('SUPABASE_SERVICE_ROLE_KEY');
    });

    it('should point at AUTH_PROVIDER_MODULE as the alternative to configuring Supabase', () => {
      const result = loadEnv({});
      expect(result.stderr).toContain('AUTH_PROVIDER_MODULE');
    });

    it('should reject a SUPABASE_URL that is not a URL', () => {
      const result = loadEnv({
        SUPABASE_URL: 'not-a-url',
        SUPABASE_ANON_KEY: 'anon',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
      });
      expect(result.stdout).not.toContain('LOADED_OK');
    });
  });

  describe('an external provider removes the Supabase requirement', () => {
    it('should load with no Supabase configuration at all', () => {
      const result = loadEnv({ AUTH_PROVIDER_MODULE: '/tmp/some-provider.js' });
      expect(result.stdout).toContain('LOADED_OK');
    });

    it('should load when the Supabase values are absent and the provider is set', () => {
      const result = loadEnv({
        AUTH_PROVIDER_MODULE: '/tmp/some-provider.js',
        SUPABASE_URL: undefined,
        SUPABASE_ANON_KEY: undefined,
        SUPABASE_SERVICE_ROLE_KEY: undefined,
      });
      expect(result.stdout).toContain('LOADED_OK');
    });
  });

  /**
   * The regression: Compose passes `AUTH_PROVIDER_MODULE=` for an unset variable, and
   * `.env.example` documents the variable as an empty string. `.optional()` rejects `""`,
   * so the default Supabase deployment failed to start with "must contain at least 1
   * character(s)" on a stock checkout of the documented configuration.
   */
  describe('blank values mean unset', () => {
    it('should treat an empty AUTH_PROVIDER_MODULE as not configured', () => {
      const result = loadEnv({
        AUTH_PROVIDER_MODULE: '',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_ANON_KEY: 'anon',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
      });
      expect(result.stdout).toContain('LOADED_OK');
    });

    it('should treat a whitespace-only AUTH_PROVIDER_MODULE as not configured', () => {
      const result = loadEnv({
        AUTH_PROVIDER_MODULE: '   ',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_ANON_KEY: 'anon',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
      });
      expect(result.stdout).toContain('LOADED_OK');
    });

    it('should trim a real AUTH_PROVIDER_MODULE value', () => {
      const result = loadEnv({
        AUTH_PROVIDER_MODULE: '  /tmp/some-provider.js  ',
      });
      expect(result.stdout).toContain('LOADED_OK');
      expect(result.stdout).not.toContain('LOADED_OK"  ');
    });

    it('should still refuse to start with a blank provider module and no Supabase', () => {
      const result = loadEnv({ AUTH_PROVIDER_MODULE: '' });
      expect(result.stdout).not.toContain('LOADED_OK');
      expect(result.stderr).toContain('SUPABASE_URL');
    });
  });
});
