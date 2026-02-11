/**
 * Unit Test: Health Check - Redis, Service Bus, Background Processor, DocuSign checks
 * Verifica los checks agregados al endpoint /api/health - Sign Bot
 */

// Mock all external dependencies before requiring
jest.mock('../../core/services/infrastructure/appInsightsService', () =>
  require('../__mocks__/appInsightsService.mock')
);
jest.mock('../../core/services/storage/connectionPool', () => {
  const mock = require('../__mocks__/connectionPool.mock');
  // Make DB check return healthy
  mock.__mockPool.size = 10;
  mock.__mockPool.available = 8;
  mock.__mockPool.pending = 0;
  mock.__mockPool.borrowed = 2;
  // Return expected tables
  const origGetPool = mock.getPool;
  mock.getPool = jest.fn(async () => {
    const pool = await origGetPool();
    pool.request = jest.fn(() => ({
      input: jest.fn().mockReturnThis(),
      query: jest.fn().mockResolvedValue({
        recordset: [
          { TABLE_NAME: 'SesionesChat' },
          { TABLE_NAME: 'MensajesProcessados' },
          { TABLE_NAME: 'DeadLetterMessages' },
          { TABLE_NAME: 'DocumentosFirma' },
        ],
      }),
    }));
    return pool;
  });
  return mock;
});
jest.mock('../../core/services/infrastructure/metricsService', () =>
  require('../__mocks__/metricsService.mock')
);
jest.mock('../../core/services/infrastructure/securityService', () => ({
  getClientIp: jest.fn(() => '127.0.0.1'),
  checkIpRateLimit: jest.fn(() => ({ allowed: true })),
}));
jest.mock('../../core/middleware/securityHeaders', () => ({
  applySecurityHeaders: jest.fn((headers) => headers),
}));
jest.mock('../../core/services/infrastructure/circuitBreaker', () => ({
  getBreaker: jest.fn(() => ({ canExecute: () => ({ allowed: true }) })),
  SERVICES: {
    WHATSAPP: 'whatsapp',
    DOCUSIGN: 'docusign',
    DATABASE: 'database',
    BLOB_STORAGE: 'blob-storage',
  },
}));
jest.mock('../../core/services/infrastructure/deadLetterService', () => ({
  getStats: jest.fn().mockResolvedValue({ total: 0, byStatus: {} }),
}));
jest.mock('../../core/services/infrastructure/errorHandler', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Mock axios for active health checks (WhatsApp) - make them healthy
jest.mock('axios', () => ({
  get: jest.fn().mockResolvedValue({
    status: 200,
    data: { display_phone_number: '+1234', verified_name: 'Test', quality_rating: 'GREEN' },
  }),
  post: jest.fn().mockResolvedValue({ status: 200, data: { model: 'test' } }),
}));

// Mock Redis, Service Bus, and Background Processor
const mockRedisService = {
  getStats: jest.fn(() => ({ hits: 10, misses: 2 })),
  isUsingFallback: jest.fn(() => false),
};
jest.mock('../../core/services/cache/redisService', () => mockRedisService);

const mockServiceBusService = {
  getStats: jest.fn(() => ({ sent: 5, received: 3 })),
  isUsingFallback: jest.fn(() => false),
};
jest.mock('../../core/services/messaging/serviceBusService', () => mockServiceBusService);

const mockBackgroundProcessor = {
  getProcessingStats: jest.fn(() => ({ active: 2, waiting: 0, max: 10 })),
};
jest.mock('../../core/services/processing/backgroundProcessor', () => mockBackgroundProcessor);

const healthHandler = require('../../api-health/index');
const config = require('../../core/config');

// Store originals
const originalRedis = config.redis;
const originalSBEnabled = config.isServiceBusEnabled;

describe('Health Check - Redis (Check 11)', () => {
  let context;

  beforeEach(() => {
    jest.clearAllMocks();
    context = createMockContext();
    config.redis = { enabled: true };
    config.isServiceBusEnabled = false;
    mockRedisService.isUsingFallback.mockReturnValue(false);
    mockServiceBusService.isUsingFallback.mockReturnValue(false);
    mockBackgroundProcessor.getProcessingStats.mockReturnValue({ active: 2, waiting: 0, max: 10 });
  });

  afterAll(() => {
    config.redis = originalRedis;
    config.isServiceBusEnabled = originalSBEnabled;
  });

  test('should report Redis as healthy when connected', async () => {
    await healthHandler(context, { method: 'GET' });

    const body = context.res.body;
    expect(body.checks.redis.status).toBe('healthy');
    expect(body.checks.redis.message).toBe('Redis connected');
  });

  test('should report Redis as degraded when using fallback', async () => {
    mockRedisService.isUsingFallback.mockReturnValue(true);

    await healthHandler(context, { method: 'GET' });

    const body = context.res.body;
    expect(body.checks.redis.status).toBe('degraded');
    expect(body.checks.redis.message).toContain('fallback');
  });

  test('should report Redis as skipped when disabled', async () => {
    config.redis = { enabled: false };

    await healthHandler(context, { method: 'GET' });

    const body = context.res.body;
    expect(body.checks.redis.status).toBe('skipped');
  });
});

describe('Health Check - Service Bus (Check 12)', () => {
  let context;

  beforeEach(() => {
    jest.clearAllMocks();
    context = createMockContext();
    config.redis = { enabled: true };
    mockRedisService.isUsingFallback.mockReturnValue(false);
    mockBackgroundProcessor.getProcessingStats.mockReturnValue({ active: 2, waiting: 0, max: 10 });
  });

  afterAll(() => {
    config.redis = originalRedis;
    config.isServiceBusEnabled = originalSBEnabled;
  });

  test('should report Service Bus as healthy when connected', async () => {
    config.isServiceBusEnabled = true;
    mockServiceBusService.isUsingFallback.mockReturnValue(false);

    await healthHandler(context, { method: 'GET' });

    const body = context.res.body;
    expect(body.checks.serviceBus.status).toBe('healthy');
  });

  test('should report Service Bus as degraded when using fallback', async () => {
    config.isServiceBusEnabled = true;
    mockServiceBusService.isUsingFallback.mockReturnValue(true);

    await healthHandler(context, { method: 'GET' });

    const body = context.res.body;
    expect(body.checks.serviceBus.status).toBe('degraded');
  });

  test('should report Service Bus as skipped when disabled', async () => {
    config.isServiceBusEnabled = false;

    await healthHandler(context, { method: 'GET' });

    const body = context.res.body;
    expect(body.checks.serviceBus.status).toBe('skipped');
  });
});

describe('Health Check - Background Processor (Check 13)', () => {
  let context;

  beforeEach(() => {
    jest.clearAllMocks();
    context = createMockContext();
    config.redis = { enabled: true };
    config.isServiceBusEnabled = false;
    mockRedisService.isUsingFallback.mockReturnValue(false);
  });

  afterAll(() => {
    config.redis = originalRedis;
    config.isServiceBusEnabled = originalSBEnabled;
  });

  test('should report healthy when utilization is low', async () => {
    mockBackgroundProcessor.getProcessingStats.mockReturnValue({ active: 2, waiting: 0, max: 10 });

    await healthHandler(context, { method: 'GET' });

    const body = context.res.body;
    expect(body.checks.backgroundProcessor.status).toBe('healthy');
  });

  test('should report warning when utilization >= 90%', async () => {
    mockBackgroundProcessor.getProcessingStats.mockReturnValue({ active: 9, waiting: 3, max: 10 });

    await healthHandler(context, { method: 'GET' });

    const body = context.res.body;
    expect(body.checks.backgroundProcessor.status).toBe('warning');
    expect(body.checks.backgroundProcessor.message).toBe('Near capacity');
  });

  test('should handle max=0 gracefully', async () => {
    mockBackgroundProcessor.getProcessingStats.mockReturnValue({ active: 0, waiting: 0, max: 0 });

    await healthHandler(context, { method: 'GET' });

    const body = context.res.body;
    expect(body.checks.backgroundProcessor.status).toBe('healthy');
  });
});

describe('Health Check - Degraded status propagation', () => {
  let context;

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-setup mocks after clearAllMocks
    const axios = require('axios');
    axios.get.mockResolvedValue({
      status: 200,
      data: { display_phone_number: '+1234', verified_name: 'Test', quality_rating: 'GREEN' },
    });
    axios.post.mockResolvedValue({ status: 200, data: { model: 'test' } });
    const pool = require('../../core/services/storage/connectionPool');
    pool.getPool.mockImplementation(async () => {
      const mockPool = pool.__mockPool;
      mockPool.request = jest.fn(() => ({
        input: jest.fn().mockReturnThis(),
        query: jest.fn().mockResolvedValue({
          recordset: [
            { TABLE_NAME: 'SesionesChat' },
            { TABLE_NAME: 'MensajesProcessados' },
            { TABLE_NAME: 'DeadLetterMessages' },
            { TABLE_NAME: 'DocumentosFirma' },
          ],
        }),
      }));
      return mockPool;
    });
    const dlq = require('../../core/services/infrastructure/deadLetterService');
    dlq.getStats.mockResolvedValue({ total: 0, byStatus: {} });
    process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || 'test-token';
    context = createMockContext();
    config.redis = { enabled: true };
    config.isServiceBusEnabled = false;
    mockRedisService.isUsingFallback.mockReturnValue(false);
    mockServiceBusService.isUsingFallback.mockReturnValue(false);
    mockBackgroundProcessor.getProcessingStats.mockReturnValue({ active: 2, waiting: 0, max: 10 });
  });

  afterAll(() => {
    config.redis = originalRedis;
    config.isServiceBusEnabled = originalSBEnabled;
  });

  test('should set global status to degraded when Redis is degraded', async () => {
    mockRedisService.isUsingFallback.mockReturnValue(true);

    await healthHandler(context, { method: 'GET' });

    expect(context.res.body.status).toBe('degraded');
  });

  test('should set global status to degraded when Service Bus is degraded', async () => {
    config.isServiceBusEnabled = true;
    mockServiceBusService.isUsingFallback.mockReturnValue(true);

    await healthHandler(context, { method: 'GET' });

    expect(context.res.body.status).toBe('degraded');
  });

  test('should set global status to degraded when background processor at capacity', async () => {
    mockBackgroundProcessor.getProcessingStats.mockReturnValue({ active: 10, waiting: 5, max: 10 });

    await healthHandler(context, { method: 'GET' });

    expect(context.res.body.status).toBe('degraded');
  });
});
