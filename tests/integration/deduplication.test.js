/**
 * Integration Test: Deduplicación de Mensajes
 * Verifica idempotencia del webhook (no procesar mismo msg 2 veces)
 */

jest.mock('../../core/services/infrastructure/appInsightsService', () =>
  require('../__mocks__/appInsightsService.mock')
);
jest.mock('../../core/services/external/whatsappService', () =>
  require('../__mocks__/whatsappService.mock')
);
jest.mock('../../core/services/storage/databaseService', () =>
  require('../__mocks__/databaseService.mock')
);
jest.mock('../../core/services/infrastructure/metricsService', () =>
  require('../__mocks__/metricsService.mock')
);
jest.mock('../../bot/controllers/messageHandler', () => ({
  handleText: jest.fn().mockResolvedValue(undefined),
  handleButton: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../core/services/infrastructure/rateLimiter', () => ({
  isDuplicateMessage: jest.fn(() => false),
}));
jest.mock('../../core/services/infrastructure/securityService', () => ({
  verifyWebhookSignature: jest.fn(() => true),
}));
jest.mock('../../core/services/infrastructure/correlationService', () => ({
  generateCorrelationId: jest.fn(() => 'dedup-test-corr'),
}));
jest.mock('../../core/services/infrastructure/deadLetterService', () => ({
  saveFailedMessage: jest.fn().mockResolvedValue(undefined),
}));

const webhook = require('../../api-whatsapp-webhook');
const messageHandler = require('../../bot/controllers/messageHandler');
const db = require('../../core/services/storage/databaseService');
const rateLimiter = require('../../core/services/infrastructure/rateLimiter');
const payloads = require('../factories/whatsappPayloads');

describe('Deduplicación de Mensajes (Integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.__reset();
  });

  test('debe procesar un mensaje nuevo (isDuplicate: false)', async () => {
    const body = payloads.createTextMessage('Hola', '+52155', 'msg-new-1');
    const req = { method: 'POST', body, headers: {} };
    const context = global.createMockContext();

    await webhook(context, req);

    expect(messageHandler.handleText).toHaveBeenCalledTimes(1);
    expect(context.res.status).toBe(200);
  });

  test('debe ignorar mensaje duplicado en memoria (rateLimiter)', async () => {
    rateLimiter.isDuplicateMessage.mockReturnValue(true);
    const body = payloads.createTextMessage('Hola', '+52155', 'msg-dup-mem');
    const req = { method: 'POST', body, headers: {} };
    const context = global.createMockContext();

    await webhook(context, req);

    expect(messageHandler.handleText).not.toHaveBeenCalled();
    expect(context.res.status).toBe(200);
  });

  test('debe ignorar mensaje duplicado en BD (registerMessageAtomic)', async () => {
    rateLimiter.isDuplicateMessage.mockReturnValue(false);
    db.registerMessageAtomic.mockResolvedValue({ isDuplicate: true, retryCount: 2 });

    const body = payloads.createTextMessage('Hola', '+52155', 'msg-dup-db');
    const req = { method: 'POST', body, headers: {} };
    const context = global.createMockContext();

    await webhook(context, req);

    expect(messageHandler.handleText).not.toHaveBeenCalled();
    expect(context.res.status).toBe(200);
  });

  test('botón de encuesta + error BD debe tratarse como duplicado (safe default)', async () => {
    rateLimiter.isDuplicateMessage.mockReturnValue(false);
    db.registerMessageAtomic.mockRejectedValue(new Error('DB timeout'));

    const body = payloads.createButtonResponse('btn_rating_5', '+52155', 'msg-enc-err');
    const req = { method: 'POST', body, headers: {} };
    const context = global.createMockContext();

    await webhook(context, req);

    // Botón de encuesta con error BD → isDuplicate true (evitar race condition)
    expect(messageHandler.handleButton).not.toHaveBeenCalled();
  });

  test('mensaje normal + error BD debe procesarse (mejor duplicar que perder)', async () => {
    rateLimiter.isDuplicateMessage.mockReturnValue(false);
    db.registerMessageAtomic.mockRejectedValue(new Error('DB timeout'));

    const body = payloads.createTextMessage('Hola', '+52155', 'msg-normal-err');
    const req = { method: 'POST', body, headers: {} };
    const context = global.createMockContext();

    await webhook(context, req);

    // Mensaje normal con error BD → se procesa (isDuplicate false)
    expect(messageHandler.handleText).toHaveBeenCalled();
  });

  test('debe devolver 200 OK en TODOS los casos (idempotencia)', async () => {
    const scenarios = [
      { name: 'nuevo', body: payloads.createTextMessage('A', '+52155', 'a') },
      { name: 'status', body: payloads.createStatusNotification() },
      { name: 'no-whatsapp', body: { object: 'page' } },
    ];

    for (const scenario of scenarios) {
      const ctx = global.createMockContext();
      await webhook(ctx, { method: 'POST', body: scenario.body, headers: {} });
      expect(ctx.res.status).toBe(200);
    }
  });
});
