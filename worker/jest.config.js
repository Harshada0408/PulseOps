module.exports = {
  setupFiles: ['<rootDir>/jest.setup.js'],
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  testTimeout: 30000,
  moduleNameMapper: { '^@pulseops/core$': '<rootDir>/../core/src/index.ts' },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/index.ts'],
  coverageDirectory: 'coverage',
  clearMocks: true,
  restoreMocks: true,
};
