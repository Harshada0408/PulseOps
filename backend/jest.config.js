module.exports = {
  setupFiles: ['<rootDir>/jest.setup.js'],
preset: 'ts-jest',
testEnvironment: 'node',

roots: ['<rootDir>/src'],

testMatch: [
'**/*.test.ts',
'**/*.spec.ts',
],

moduleNameMapper: {
// Tests run against core's TypeScript source, so they never see a stale build.
'^@pulseops/core$': '<rootDir>/../core/src/index.ts',
'^@/(.*)$': '<rootDir>/src/$1',
'^@config/(.*)$': '<rootDir>/src/config/$1',
'^@middleware/(.*)$': '<rootDir>/src/middleware/$1',
'^@routes/(.*)$': '<rootDir>/src/routes/$1',
'^@services/(.*)$': '<rootDir>/src/services/$1',
'^@utils/(.*)$': '<rootDir>/src/utils/$1',
'^@types/(.*)$': '<rootDir>/src/types/$1',
},

collectCoverageFrom: [
'src/**/*.ts',
'!src/**/*.d.ts',
'!src/server.ts',
],

coverageDirectory: 'coverage',

coverageReporters: [
'text',
'lcov',
'html',
],

clearMocks: true,
restoreMocks: true,
};
