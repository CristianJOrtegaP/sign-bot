/**
 * E2E Test: Resiliencia
 * Verifica que el sistema maneja fallos gracefully
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
  handleLocation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/controllers/imageHandler', () => ({
  handleImage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/controllers/audioHandler', () => ({
  handleAudio: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../core/services/infrastructure/rateLimiter', () => ({
  isDuplicateMessage: jest.fn(() => false),
}));
jest.mock('../../core/services/infrastructure/securityService', () => ({
  verifyWebhookSignature: jest.fn(() => true),
}));
jest.mock('../../core/services/infrastructure/correlationService', () => ({
  generateCorrelationId: jest.fn(() => 'e2e-resilience-corr'),
}));
jest.mock('../../core/services/infrastructure/deadLetterService', () => ({
  saveFailedMessage: jest.fn().mockResolvedValue(undefined),
}));

const webhook = require('../../api-whatsapp-webhook');
const messageHandler = require('../../bot/controllers/messageHandler');
const db = require('../../core/services/storage/databaseService');
const deadLetter = require('../../core/services/infrastructure/deadLetterService');
const payloads = require('../factories/whatsappPayloads');

describe('Resiliencia (E2E)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.__reset();
    db.registerMessageAtomic.mockResolvedValue({ isDuplicate: false, retryCount: 0 });
  });

  // ===========================================================
  // FALLO EN HANDLER
  // ===========================================================
  describe('fallo en handler de mensaje', () => {
    test('debe guardar en DLQ y responder 200 si handleText falla', async () => {
      messageHandler.handleText.mockRejectedValue(new Error('Handler crashed'));
      const body = payloads.createTextMessage('Hola');
      const context = global.createMockContext();

      await webhook(context, { method: 'POST', body, headers: {} });

      expect(context.res.status).toBe(200);
      expect(deadLetter.saveFailedMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'text' }),
        expect.any(Error)
      );
    });

    test('debe manejar error en DLQ sin crashear', async () => {
      messageHandler.handleText.mockRejectedValue(new Error('Handler crash'));
      deadLetter.saveFailedMessage.mockRejectedValue(new Error('DLQ also failed'));

      const body = payloads.createTextMessage('Hola');
      const context = global.createMockContext();

      // No debe lanzar error incluso si DLQ falla
      await expect(
        webhook(context, { method: 'POST', body, headers: {} })
      ).resolves.toBeUndefined();

      expect(context.res.status).toBe(200);
    });
  });

  // ===========================================================
  // DEDUPLICACION RESILIENTE
  // ===========================================================
  describe('deduplicación bajo fallo', () => {
    test('debe procesar mensaje cuando BD de dedup falla (mejor duplicar que perder)', async () => {
      db.registerMessageAtomic.mockRejectedValue(new Error('DB connection lost'));

      const body = payloads.createTextMessage('Necesito ayuda');
      const context = global.createMockContext();

      await webhook(context, { method: 'POST', body, headers: {} });

      // Se procesa el mensaje a pesar del fallo de dedup
      expect(messageHandler.handleText).toHaveBeenCalled();
      expect(context.res.status).toBe(200);
    });
  });

  // ===========================================================
  // PAYLOADS MALFORMADOS
  // ===========================================================
  describe('payloads malformados', () => {
    test('debe manejar body vacío sin crashear', async () => {
      const context = global.createMockContext();

      // Body vacío (sin campo object) - el webhook lo ignora con 200 OK
      await expect(
        webhook(context, { method: 'POST', body: {}, headers: {} })
      ).resolves.toBeUndefined();
      expect(context.res.status).toBe(200);
    });

    test('debe ignorar payload sin messages', async () => {
      const body = {
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ value: { statuses: [] }, field: 'messages' }] }],
      };
      const context = global.createMockContext();

      await webhook(context, { method: 'POST', body, headers: {} });

      expect(messageHandler.handleText).not.toHaveBeenCalled();
      expect(context.res.status).toBe(200);
    });

    test('debe ignorar tipo de mensaje desconocido sin error', async () => {
      const body = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '123',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: 'test' },
                  contacts: [{ profile: { name: 'Test' }, wa_id: '+52155' }],
                  messages: [
                    {
                      from: '+52155',
                      id: 'unknown-type-msg',
                      type: 'sticker',
                      timestamp: '1234567890',
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };
      const context = global.createMockContext();

      await webhook(context, { method: 'POST', body, headers: {} });

      expect(messageHandler.handleText).not.toHaveBeenCalled();
      expect(context.res.status).toBe(200);
    });
  });

  // ===========================================================
  // MULTIPLES WEBHOOKS CONCURRENTES
  // ===========================================================
  describe('múltiples webhooks concurrentes', () => {
    test('debe procesar mensajes de diferentes usuarios en paralelo', async () => {
      const req1 = {
        method: 'POST',
        body: payloads.createTextMessage('Hola', '+52155A', 'p1'),
        headers: {},
      };
      const req2 = {
        method: 'POST',
        body: payloads.createTextMessage('Hi', '+52155B', 'p2'),
        headers: {},
      };
      const ctx1 = global.createMockContext();
      const ctx2 = global.createMockContext();

      await Promise.all([webhook(ctx1, req1), webhook(ctx2, req2)]);

      expect(messageHandler.handleText).toHaveBeenCalledTimes(2);
      expect(ctx1.res.status).toBe(200);
      expect(ctx2.res.status).toBe(200);
    });
  });
});
