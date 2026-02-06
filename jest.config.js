/**
 * AC FIXBOT - Jest Configuration
 * Multi-project: unit, integration, e2e
 */
const baseConfig = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup/envSetup.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/testSetup.js'],
  modulePathIgnorePatterns: ['<rootDir>/node_modules/'],
};

module.exports = {
  projects: [
    {
      ...baseConfig,
      displayName: 'unit',
      roots: ['<rootDir>/tests/unit'],
      testMatch: ['**/*.test.js'],
      clearMocks: true,
      restoreMocks: true,
      testTimeout: 5000,
    },
    {
      ...baseConfig,
      displayName: 'integration',
      roots: ['<rootDir>/tests/integration'],
      testMatch: ['**/*.test.js'],
      clearMocks: true,
      testTimeout: 15000,
    },
    {
      ...baseConfig,
      displayName: 'e2e',
      roots: ['<rootDir>/tests/e2e'],
      testMatch: ['**/*.e2e.test.js'],
      testTimeout: 30000,
      maxWorkers: 1,
    },
  ],
  collectCoverageFrom: [
    'api-whatsapp-webhook/**/*.js',
    'bot/**/*.js',
    'core/**/*.js',
    'timer-*/**/*.js',
    '!**/node_modules/**',
    '!**/tests/**',
    '!**/coverage/**',
    '!**/__mocks__/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 65,
      lines: 75,
      statements: 75,
    },
  },
};
