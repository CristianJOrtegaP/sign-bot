/**
 * Unit Test: DLQ Processor + deadLetterService.markAsSkipped
 * Verifica skip de media expirada y contador skipped en batch
 */

jest.mock('../../core/services/infrastructure/appInsightsService', () =>
  require('../__mocks__/appInsightsService.mock')
);
jest.mock('../../core/services/infrastructure/errorHandler', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../core/services/storage/connectionPool', () =>
  require('../__mocks__/connectionPool.mock')
);
jest.mock('../../core/services/infrastructure/correlationService', () => ({
  getCorrelationId: jest.fn(() => 'test-corr-id'),
}));

// Mock message handlers used by DLQ processor for reprocessing
const mockHandleText = jest.fn().mockResolvedValue(undefined);
const mockHandleButton = jest.fn().mockResolvedValue(undefined);
const mockHandleUnsupportedType = jest.fn().mockResolvedValue(undefined);
jest.mock('../../bot/controllers/messageHandler', () => ({
  handleText: mockHandleText,
  handleButton: mockHandleButton,
  handleUnsupportedType: mockHandleUnsupportedType,
}));

jest.mock('../../core/services/infrastructure/alertingService', () => ({
  sendManualAlert: jest.fn().mockResolvedValue(true),
}));

const deadLetterService = require('../../core/services/infrastructure/deadLetterService');
const connectionPool = require('../../core/services/storage/connectionPool');

describe('deadLetterService.markAsSkipped', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should update Estado to SKIPPED with reason', async () => {
    const result = await deadLetterService.markAsSkipped(42, 'Media ID expirado');
    expect(result).toBe(true);
    expect(connectionPool.executeWithRetry).toHaveBeenCalledTimes(1);
  });

  test('should return false on database error', async () => {
    connectionPool.executeWithRetry.mockRejectedValueOnce(new Error('DB error'));
    const result = await deadLetterService.markAsSkipped(42, 'reason');
    expect(result).toBe(false);
  });

  test('should truncate long reasons to 1000 chars', async () => {
    const longReason = 'x'.repeat(2000);
    const result = await deadLetterService.markAsSkipped(1, longReason);
    expect(result).toBe(true);
  });

  test('should handle null reason gracefully', async () => {
    const result = await deadLetterService.markAsSkipped(1, null);
    expect(result).toBe(true);
  });
});

describe('DLQ Processor - expired image skip', () => {
  let dlqProcessor;
  let context;

  beforeEach(() => {
    jest.clearAllMocks();
    context = createMockContext();
    context.log.info = jest.fn();

    // Mock deadLetterService methods used by DLQ processor
    jest.spyOn(deadLetterService, 'getStats').mockResolvedValue({ total: 1, byStatus: {} });
    jest.spyOn(deadLetterService, 'getMessagesForRetry').mockResolvedValue([]);
    jest.spyOn(deadLetterService, 'markAsSkipped').mockResolvedValue(true);
    jest.spyOn(deadLetterService, 'markAsProcessed').mockResolvedValue(true);
    jest.spyOn(deadLetterService, 'recordRetryFailure').mockResolvedValue(true);
    jest.spyOn(deadLetterService, 'cleanOldMessages').mockResolvedValue(0);

    dlqProcessor = require('../../timer-dlq-processor/index');
  });

  test('should skip image messages older than 24h', async () => {
    const oldDate = new Date(Date.now() - 30 * 60 * 60 * 1000); // 30h ago
    deadLetterService.getMessagesForRetry.mockResolvedValue([
      {
        DeadLetterId: 1,
        WhatsAppMessageId: 'msg-1',
        Telefono: '5551234567',
        TipoMensaje: 'image',
        Contenido: '{"id":"img123"}',
        RetryCount: 0,
        MaxRetries: 3,
        FechaCreacion: oldDate.toISOString(),
      },
    ]);

    await dlqProcessor(context, {});

    expect(deadLetterService.markAsSkipped).toHaveBeenCalledWith(
      1,
      expect.stringContaining('Media ID expirado')
    );
    // Image was skipped, so no handler should have been called
    expect(mockHandleText).not.toHaveBeenCalled();
  });

  test('should NOT skip image messages younger than 24h', async () => {
    const recentDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago

    deadLetterService.getMessagesForRetry.mockResolvedValue([
      {
        DeadLetterId: 2,
        WhatsAppMessageId: 'msg-2',
        Telefono: '5551234567',
        TipoMensaje: 'image',
        Contenido: JSON.stringify({ id: 'img456' }),
        RetryCount: 0,
        MaxRetries: 3,
        FechaCreacion: recentDate.toISOString(),
      },
    ]);

    await dlqProcessor(context, {});

    expect(deadLetterService.markAsSkipped).not.toHaveBeenCalled();
    expect(deadLetterService.markAsProcessed).toHaveBeenCalledWith(2);
  });

  test('should NOT skip text messages regardless of age', async () => {
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h ago
    mockHandleText.mockResolvedValue(undefined);

    deadLetterService.getMessagesForRetry.mockResolvedValue([
      {
        DeadLetterId: 3,
        WhatsAppMessageId: 'msg-3',
        Telefono: '5551234567',
        TipoMensaje: 'text',
        Contenido: 'Hola necesito ayuda',
        RetryCount: 0,
        MaxRetries: 3,
        FechaCreacion: oldDate.toISOString(),
      },
    ]);

    await dlqProcessor(context, {});

    expect(deadLetterService.markAsSkipped).not.toHaveBeenCalled();
  });

  test('should count skipped messages in results log', async () => {
    const oldDate = new Date(Date.now() - 30 * 60 * 60 * 1000);
    deadLetterService.getMessagesForRetry.mockResolvedValue([
      {
        DeadLetterId: 10,
        WhatsAppMessageId: 'msg-10',
        Telefono: '5551234567',
        TipoMensaje: 'image',
        Contenido: '{"id":"img10"}',
        RetryCount: 0,
        MaxRetries: 3,
        FechaCreacion: oldDate.toISOString(),
      },
      {
        DeadLetterId: 11,
        WhatsAppMessageId: 'msg-11',
        Telefono: '5551234568',
        TipoMensaje: 'image',
        Contenido: '{"id":"img11"}',
        RetryCount: 0,
        MaxRetries: 3,
        FechaCreacion: oldDate.toISOString(),
      },
    ]);

    await dlqProcessor(context, {});

    const summaryCall = context.log.info.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('Procesamiento completado')
    );
    expect(summaryCall).toBeDefined();
    expect(summaryCall[1]).toMatchObject({ skipped: 2, processed: 0, failed: 0 });
  });
});
