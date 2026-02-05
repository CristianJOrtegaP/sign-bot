/**
 * Tests para Application Insights Integration
 * FASE 10/10: Observabilidad
 */

// Mock de applicationinsights
const mockClient = {
  trackMetric: jest.fn(),
  trackEvent: jest.fn(),
  trackException: jest.fn(),
  trackTrace: jest.fn(),
  trackDependency: jest.fn(),
  trackRequest: jest.fn(),
  flush: jest.fn((opts) => opts.callback && opts.callback()),
  context: {
    tags: {},
    keys: {
      cloudRole: 'ai.cloud.role',
      cloudRoleInstance: 'ai.cloud.roleInstance',
      operationId: 'ai.operation.id',
      operationName: 'ai.operation.name',
    },
  },
};

jest.mock('applicationinsights', () => ({
  setup: jest.fn().mockReturnThis(),
  setAutoCollectRequests: jest.fn().mockReturnThis(),
  setAutoCollectPerformance: jest.fn().mockReturnThis(),
  setAutoCollectExceptions: jest.fn().mockReturnThis(),
  setAutoCollectDependencies: jest.fn().mockReturnThis(),
  setAutoCollectConsole: jest.fn().mockReturnThis(),
  setAutoDependencyCorrelation: jest.fn().mockReturnThis(),
  setSendLiveMetrics: jest.fn().mockReturnThis(),
  setDistributedTracingMode: jest.fn().mockReturnThis(),
  start: jest.fn(),
  defaultClient: mockClient,
  DistributedTracingModes: { AI_AND_W3C: 2 },
}));

describe('Application Insights Service', () => {
  let appInsightsService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Reset mock client
    mockClient.trackMetric.mockClear();
    mockClient.trackEvent.mockClear();
    mockClient.trackException.mockClear();
    mockClient.trackTrace.mockClear();
    mockClient.trackDependency.mockClear();
    mockClient.trackRequest.mockClear();
    mockClient.flush.mockClear();
    mockClient.context.tags = {};

    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'InstrumentationKey=test-key-12345';
    appInsightsService = require('../../core/services/infrastructure/appInsightsService');
    appInsightsService._resetForTests();
  });

  afterEach(() => {
    delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  });

  describe('initialize()', () => {
    test('debe inicializar correctamente con connection string', () => {
      const result = appInsightsService.initialize();

      expect(result).toBe(true);
      expect(appInsightsService.isInitialized()).toBe(true);
    });

    test('debe retornar true si ya está inicializado', () => {
      appInsightsService.initialize();
      const result = appInsightsService.initialize();

      expect(result).toBe(true);
    });

    test('no debe fallar si no hay connection string', () => {
      delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
      jest.resetModules();
      const service = require('../../core/services/infrastructure/appInsightsService');
      service._resetForTests();

      const result = service.initialize();

      expect(result).toBe(false);
      expect(service.isInitialized()).toBe(false);
    });

    test('debe configurar cloud role y instance', () => {
      appInsightsService.initialize();

      expect(mockClient.context.tags['ai.cloud.role']).toBe('acfixbot');
    });
  });

  describe('trackMetric()', () => {
    test('debe trackear metricas custom', () => {
      appInsightsService.initialize();
      appInsightsService.trackMetric('webhook.duration', 150, { operation: 'processMessage' });

      expect(mockClient.trackMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'webhook.duration',
          value: 150,
          properties: expect.objectContaining({
            operation: 'processMessage',
          }),
        })
      );
    });

    test('no debe fallar si no está inicializado', () => {
      expect(() => {
        appInsightsService.trackMetric('test', 100);
      }).not.toThrow();
    });
  });

  describe('trackEvent()', () => {
    test('debe trackear eventos custom', () => {
      appInsightsService.initialize();
      appInsightsService.trackEvent(
        'MessageProcessed',
        { messageType: 'text', from: '521551234****' },
        { processingTime: 200 }
      );

      expect(mockClient.trackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'MessageProcessed',
          properties: expect.objectContaining({
            messageType: 'text',
          }),
          measurements: { processingTime: 200 },
        })
      );
    });
  });

  describe('trackException()', () => {
    test('debe trackear excepciones', () => {
      appInsightsService.initialize();
      const error = new Error('Test error');
      appInsightsService.trackException(error, { context: 'messageHandler' });

      expect(mockClient.trackException).toHaveBeenCalledWith(
        expect.objectContaining({
          exception: error,
          properties: expect.objectContaining({
            context: 'messageHandler',
          }),
        })
      );
    });
  });

  describe('trackTrace()', () => {
    test('debe trackear trazas con severidad correcta', () => {
      appInsightsService.initialize();
      appInsightsService.trackTrace('Procesando mensaje', 'Information', {
        messageId: 'wamid.123',
      });

      expect(mockClient.trackTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Procesando mensaje',
          severity: 1, // Information
          properties: expect.objectContaining({
            messageId: 'wamid.123',
          }),
        })
      );
    });

    test('debe manejar diferentes niveles de severidad', () => {
      appInsightsService.initialize();

      appInsightsService.trackTrace('Verbose msg', 'Verbose');
      expect(mockClient.trackTrace).toHaveBeenLastCalledWith(
        expect.objectContaining({ severity: 0 })
      );

      appInsightsService.trackTrace('Warning msg', 'Warning');
      expect(mockClient.trackTrace).toHaveBeenLastCalledWith(
        expect.objectContaining({ severity: 2 })
      );

      appInsightsService.trackTrace('Error msg', 'Error');
      expect(mockClient.trackTrace).toHaveBeenLastCalledWith(
        expect.objectContaining({ severity: 3 })
      );

      appInsightsService.trackTrace('Critical msg', 'Critical');
      expect(mockClient.trackTrace).toHaveBeenLastCalledWith(
        expect.objectContaining({ severity: 4 })
      );
    });
  });

  describe('trackDependency()', () => {
    test('debe trackear dependencias HTTP', () => {
      appInsightsService.initialize();
      appInsightsService.trackDependency(
        'WhatsApp API',
        'graph.facebook.com',
        250,
        true,
        200,
        'HTTP'
      );

      expect(mockClient.trackDependency).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'WhatsApp API',
          target: 'graph.facebook.com',
          duration: 250,
          success: true,
          resultCode: '200',
          dependencyTypeName: 'HTTP',
        })
      );
    });

    test('debe trackear dependencias SQL', () => {
      appInsightsService.initialize();
      appInsightsService.trackDependency(
        'getSession',
        'acfixbot-sql.database.windows.net',
        50,
        true,
        0,
        'SQL'
      );

      expect(mockClient.trackDependency).toHaveBeenCalledWith(
        expect.objectContaining({
          dependencyTypeName: 'SQL',
        })
      );
    });
  });

  describe('trackRequest()', () => {
    test('debe trackear requests custom', () => {
      appInsightsService.initialize();
      appInsightsService.trackRequest(
        'POST /api/whatsapp-webhook',
        '/api/whatsapp-webhook',
        350,
        200,
        true
      );

      expect(mockClient.trackRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'POST /api/whatsapp-webhook',
          url: '/api/whatsapp-webhook',
          duration: 350,
          resultCode: '200',
          success: true,
        })
      );
    });
  });

  describe('flush()', () => {
    test('debe hacer flush de telemetria', async () => {
      appInsightsService.initialize();
      await appInsightsService.flush();

      expect(mockClient.flush).toHaveBeenCalled();
    });

    test('no debe fallar si no está inicializado', async () => {
      await expect(appInsightsService.flush()).resolves.toBeUndefined();
    });
  });

  describe('setOperationContext()', () => {
    test('debe establecer contexto de operación', () => {
      appInsightsService.initialize();
      appInsightsService.setOperationContext('correlation-123', 'processWebhook');

      expect(mockClient.context.tags['ai.operation.id']).toBe('correlation-123');
      expect(mockClient.context.tags['ai.operation.name']).toBe('processWebhook');
    });
  });

  describe('getClient()', () => {
    test('debe retornar cliente después de inicializar', () => {
      appInsightsService.initialize();
      const client = appInsightsService.getClient();

      expect(client).toBeDefined();
      expect(client.trackMetric).toBeDefined();
    });

    test('debe retornar null si no está inicializado', () => {
      const client = appInsightsService.getClient();
      expect(client).toBeNull();
    });
  });
});

describe('Application Insights - Integration Scenarios', () => {
  let appInsightsService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockClient.context.tags = {};
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'InstrumentationKey=test-key';
    appInsightsService = require('../../core/services/infrastructure/appInsightsService');
    appInsightsService._resetForTests();
  });

  test('debe trackear flujo completo de webhook', () => {
    appInsightsService.initialize();
    const correlationId = '20250205-143022-ABC12';

    // Simular flujo de webhook
    appInsightsService.setOperationContext(correlationId, 'whatsapp-webhook');

    // Track request
    appInsightsService.trackEvent('WebhookReceived', {
      correlationId,
      messageType: 'text',
    });

    // Track DB dependency
    appInsightsService.trackDependency('getSession', 'sql-server', 45, true, 0, 'SQL');

    // Track WhatsApp dependency
    appInsightsService.trackDependency('sendMessage', 'graph.facebook.com', 180, true, 200, 'HTTP');

    // Track metrics
    appInsightsService.trackMetric('webhook.totalDuration', 350);

    expect(mockClient.trackEvent).toHaveBeenCalledTimes(1);
    expect(mockClient.trackDependency).toHaveBeenCalledTimes(2);
    expect(mockClient.trackMetric).toHaveBeenCalledTimes(1);
  });

  test('debe trackear error y excepción', () => {
    appInsightsService.initialize();

    const error = new Error('WhatsApp API timeout');
    error.code = 'ETIMEDOUT';

    appInsightsService.trackException(error, {
      operation: 'sendMessage',
      retryAttempt: 3,
    });

    appInsightsService.trackTrace('Guardando en Dead Letter Queue', 'Warning', {
      messageId: 'wamid.123',
    });

    expect(mockClient.trackException).toHaveBeenCalledTimes(1);
    expect(mockClient.trackTrace).toHaveBeenCalledTimes(1);
  });
});
