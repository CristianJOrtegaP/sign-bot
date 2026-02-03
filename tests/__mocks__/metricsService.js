/**
 * Mock - Metrics Service
 * Simula el servicio de métricas
 */

const mockTimer = {
    end: jest.fn().mockReturnValue(100)
};

const mockMetricsService = {
    startTimer: jest.fn().mockReturnValue(mockTimer),

    recordCacheHit: jest.fn(),

    recordCacheMiss: jest.fn(),

    recordError: jest.fn(),

    recordLatency: jest.fn(),

    getMetrics: jest.fn().mockReturnValue({
        timers: {},
        counters: {},
        uptime: 0
    }),

    reset: jest.fn(),

    __mockTimer: mockTimer,

    __reset: () => {
        mockTimer.end.mockClear();
        mockMetricsService.startTimer.mockClear();
        mockMetricsService.recordCacheHit.mockClear();
        mockMetricsService.recordCacheMiss.mockClear();
        mockMetricsService.recordError.mockClear();
    }
};

module.exports = mockMetricsService;
