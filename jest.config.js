/**
 * Jest Configuration for AC FixBot
 */
module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.test.js'],
    collectCoverageFrom: [
        'controllers/**/*.js',
        'services/**/*.js',
        'repositories/**/*.js',
        'utils/**/*.js',
        'config/**/*.js',
        'api-whatsapp-webhook/**/*.js',
        'api-ticket-resolve/**/*.js',
        'api-admin-cache/**/*.js',
        'api-health/**/*.js',
        'middleware/**/*.js',
        'session-cleanup-timer/**/*.js',
        'survey-sender-timer/**/*.js',
        'constants/**/*.js',
        '!**/node_modules/**',
        '!**/providers/**',
        '!**/*.test.js',
        '!**/tests/**'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    coverageThreshold: {
        global: {
            branches: 55,
            functions: 60,
            lines: 65,
            statements: 65
        }
    },
    setupFiles: ['<rootDir>/tests/setupMocks.js'],
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
    modulePathIgnorePatterns: ['<rootDir>/node_modules/'],
    testTimeout: 10000,
    verbose: true,
    clearMocks: true
};
