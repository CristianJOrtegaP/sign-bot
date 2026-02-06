/**
 * Mock: Application Insights Service
 * No-ops - evita telemetria real en tests
 */
module.exports = {
  initialize: jest.fn(),
  trackEvent: jest.fn(),
  trackException: jest.fn(),
  trackMetric: jest.fn(),
  trackDependency: jest.fn(),
  trackTrace: jest.fn(),
  flush: jest.fn(),
  defaultClient: {
    trackEvent: jest.fn(),
    trackException: jest.fn(),
    trackMetric: jest.fn(),
    trackDependency: jest.fn(),
    trackTrace: jest.fn(),
    flush: jest.fn(),
    context: { tags: {} },
  },
};
