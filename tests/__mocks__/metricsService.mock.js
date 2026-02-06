/**
 * Mock: Metrics Service
 * No-ops con spies
 */
module.exports = {
  startTimer: jest.fn(() => ({ end: jest.fn() })),
  recordError: jest.fn(),
  recordEvent: jest.fn(),
  recordCacheHit: jest.fn(),
  recordCacheMiss: jest.fn(),
  getSnapshot: jest.fn(() => ({})),
  resetMetrics: jest.fn(),
  getSummary: jest.fn(() => ({})),
};
