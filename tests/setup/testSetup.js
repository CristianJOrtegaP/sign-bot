/**
 * Sign Bot - Test Setup
 * Se ejecuta DESPUES del framework de Jest (setupFilesAfterEnv)
 */

// Suprimir console output excepto errores
const originalConsole = { ...console };
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: originalConsole.error,
};

// Helper global: Azure Functions context mock
global.createMockContext = () => {
  const logFn = jest.fn();
  logFn.warn = jest.fn();
  logFn.error = jest.fn();
  logFn.verbose = jest.fn();
  return {
    log: logFn,
    bindings: {},
    res: {},
    correlationId: 'test-correlation-id',
  };
};

// Helper global: async delay
global.delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Cleanup
afterEach(() => {
  jest.clearAllTimers();
});
