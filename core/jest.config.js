module.exports = {
  setupFiles: ['<rootDir>/jest.setup.js'],
  preset: 'ts-jest',
  testEnvironment: 'node',

  roots: ['<rootDir>/src'],

  testMatch: ['**/*.test.ts', '**/*.spec.ts'],

  // The security suite binds real loopback sockets to exercise the redirect and
  // connect-time paths end to end, so it needs more than the 5s default.
  testTimeout: 30000,

  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
  ],

  coverageDirectory: 'coverage',

  coverageReporters: ['text', 'lcov', 'html'],

  clearMocks: true,
  restoreMocks: true,
};
