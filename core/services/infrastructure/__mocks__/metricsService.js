/**
 * Mock - Metrics Service
 * Simulates the metrics service for testing
 */

const mockTimer = {
    end: jest.fn().mockReturnValue(100)
};

const metricsService = {
    startTimer: jest.fn(() => mockTimer),
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn(),
    recordError: jest.fn(),
    recordLatency: jest.fn(),
    getMetricsSummary: jest.fn().mockReturnValue({
        timestamp: new Date().toISOString(),
        operations: {},
        timings: {},
        errors: {},
        cache: { hits: 0, misses: 0, hitRate: 'N/A' }
    }),
    printMetricsSummary: jest.fn(),
    persistMetricsSummary: jest.fn().mockResolvedValue(),
    getHistoricalMetrics: jest.fn().mockResolvedValue([]),
    getHistoricalErrors: jest.fn().mockResolvedValue([]),
    isStorageEnabled: jest.fn().mockReturnValue(false),
    initializeStorage: jest.fn().mockResolvedValue(false),
    __mockTimer: mockTimer
};

module.exports = metricsService;
