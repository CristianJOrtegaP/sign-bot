/**
 * Unit Test: Webhook Principal (api-whatsapp-webhook/index.js)
 * Verifica routing, deduplicacion, firma y Dead Letter Queue - Sign Bot
 */

// Mocks de dependencias
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
  checkRateLimit: jest.fn(() => ({ allowed: true })),
  recordRequest: jest.fn(),
}));
jest.mock('../../core/services/infrastructure/securityService', () => ({
  verifyWebhookSignature: jest.fn(() => true),
}));
jest.mock('../../core/services/infrastructure/correlationService', () => ({
  generateCorrelationId: jest.fn(() => 'test-corr-id'),
}));
jest.mock('../../core/services/infrastructure/deadLetterService', () => ({
  saveFailedMessage: jest.fn().mockResolvedValue(undefined),
}));

const webhook = require('../../api-whatsapp-webhook');
const messageHandler = require('../../bot/controllers/messageHandler');
const rateLimiter = require('../../core/services/infrastructure/rateLimiter');
const security = require('../../core/services/infrastructure/securityService');
const db = require('../../core/services/storage/databaseService');
const deadLetter = require('../../core/services/infrastructure/deadLetterService');
const payloads = require('../factories/whatsappPayloads');

describe('Webhook Principal', () => {
  let context;

  beforeEach(() => {
    context = global.createMockContext();
    jest.clearAllMocks();
    rateLimiter.isDuplicateMessage.mockReturnValue(false);
    security.verifyWebhookSignature.mockReturnValue(true);
    db.registerMessageAtomic.mockResolvedValue({ isDuplicate: false, retryCount: 0 });
    db.updateUserName.mockResolvedValue(undefined);
    deadLetter.saveFailedMessage.mockResolvedValue(undefined);
    messageHandler.handleText.mockResolvedValue(undefined);
    messageHandler.handleButton.mockResolvedValue(undefined);
  });

  // ===========================================================
  // VERIFICACION GET
  // ===========================================================
  describe('GET - Verificacion del webhook', () => {
    test('debe verificar webhook con token correcto y retornar challenge', async () => {
      const req = payloads.createVerificationRequest('test-verify-token', '9876543');

      await webhook(context, req);

      expect(context.res.status).toBe(200);
      expect(context.res.body).toBe(9876543);
    });

    test('debe rechazar webhook con token incorrecto', async () => {
      const req = payloads.createVerificationRequest('wrong-token', '9876543');

      await webhook(context, req);

      expect(context.res.status).toBe(403);
      expect(context.res.body).toBe('Forbidden');
    });

    test('debe rechazar si falta hub.mode', async () => {
      const req = {
        method: 'GET',
        query: { 'hub.verify_token': 'test-verify-token', 'hub.challenge': '123' },
        headers: {},
      };

      await webhook(context, req);

      expect(context.res.status).toBe(403);
    });
  });

  // ===========================================================
  // POST - ROUTING POR TIPO DE MENSAJE
  // ===========================================================
  describe('POST - Routing por tipo de mensaje', () => {
    test('debe rutear mensaje de texto a messageHandler.handleText', async () => {
      const body = payloads.createTextMessage('mis documentos');
      const req = { method: 'POST', body, headers: {} };

      await webhook(context, req);

      expect(messageHandler.handleText).toHaveBeenCalledWith(
        '+5215512345678',
        'mis documentos',
        expect.any(String),
        expect.any(Object),
        null,
        expect.any(Object) // TimeoutBudget
      );
      expect(context.res.status).toBe(200);
    });

    test('debe rutear boton interactivo a messageHandler.handleButton', async () => {
      const body = payloads.createButtonResponse('btn_ver_documentos');
      const req = { method: 'POST', body, headers: {} };

      await webhook(context, req);

      expect(messageHandler.handleButton).toHaveBeenCalledWith(
        '+5215512345678',
        'btn_ver_documentos',
        expect.any(String),
        expect.any(Object)
      );
    });

    test('debe rutear boton de rechazo correctamente', async () => {
      const body = payloads.createButtonResponse('btn_rechazar');
      const req = { method: 'POST', body, headers: {} };

      await webhook(context, req);

      expect(messageHandler.handleButton).toHaveBeenCalledWith(
        '+5215512345678',
        'btn_rechazar',
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  // ===========================================================
  // DEDUPLICACION
  // ===========================================================
  describe('POST - Deduplicacion de mensajes', () => {
    test('debe ignorar mensaje duplicado en memoria', async () => {
      rateLimiter.isDuplicateMessage.mockReturnValue(true);
      const body = payloads.createTextMessage('Hola', '+5215512345678', 'dup-msg-1');
      const req = { method: 'POST', body, headers: {} };

      await webhook(context, req);

      expect(messageHandler.handleText).not.toHaveBeenCalled();
      expect(context.res.status).toBe(200);
    });

    test('debe ignorar mensaje duplicado en BD', async () => {
      db.registerMessageAtomic.mockResolvedValue({ isDuplicate: true, retryCount: 1 });
      const body = payloads.createTextMessage('Hola', '+5215512345678', 'dup-msg-2');
      const req = { method: 'POST', body, headers: {} };

      await webhook(context, req);

      expect(messageHandler.handleText).not.toHaveBeenCalled();
      expect(context.res.status).toBe(200);
    });

    test('debe procesar mensaje nuevo', async () => {
      const body = payloads.createTextMessage('Hola');
      const req = { method: 'POST', body, headers: {} };

      await webhook(context, req);

      expect(messageHandler.handleText).toHaveBeenCalled();
    });
  });

  // ===========================================================
  // DEAD LETTER QUEUE
  // ===========================================================
  describe('POST - Dead Letter Queue', () => {
    test('debe guardar en DLQ si el handler falla y responder 200', async () => {
      messageHandler.handleText.mockRejectedValue(new Error('Handler crashed'));
      const body = payloads.createTextMessage('Hola');
      const req = { method: 'POST', body, headers: {} };

      await webhook(context, req);

      expect(deadLetter.saveFailedMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'text' }),
        expect.any(Error)
      );
      // Siempre responde 200 para evitar reintentos de Meta
      expect(context.res.status).toBe(200);
    });
  });

  // ===========================================================
  // EDGE CASES
  // ===========================================================
  describe('POST - Edge cases', () => {
    test('debe ignorar eventos que no son de WhatsApp', async () => {
      const req = { method: 'POST', body: { object: 'page' }, headers: {} };

      await webhook(context, req);

      expect(messageHandler.handleText).not.toHaveBeenCalled();
      expect(context.res.status).toBe(200);
    });

    test('debe ignorar notificaciones de estado (sin mensajes)', async () => {
      const body = payloads.createStatusNotification('msg-1', 'delivered');
      const req = { method: 'POST', body, headers: {} };

      await webhook(context, req);

      expect(messageHandler.handleText).not.toHaveBeenCalled();
      expect(context.res.status).toBe(200);
    });

    test('debe actualizar nombre de usuario si esta en el payload', async () => {
      const body = payloads.createTextMessage('Hola');
      const req = { method: 'POST', body, headers: {} };

      await webhook(context, req);

      expect(db.updateUserName).toHaveBeenCalledWith('+5215512345678', 'Test User');
    });

    test('debe ignorar callback de template status', async () => {
      const body = payloads.createTemplateStatusCallback('wamid.tmpl_1', 'delivered');
      const req = { method: 'POST', body, headers: {} };

      await webhook(context, req);

      expect(messageHandler.handleText).not.toHaveBeenCalled();
      expect(context.res.status).toBe(200);
    });
  });

  // ===========================================================
  // VALIDACION DE FIRMA
  // ===========================================================
  describe('POST - Validacion de firma', () => {
    test('debe rechazar firma invalida en ambiente de produccion', async () => {
      const originalEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
      const originalSkip = process.env.SKIP_SIGNATURE_VALIDATION;
      process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
      delete process.env.SKIP_SIGNATURE_VALIDATION;
      security.verifyWebhookSignature.mockReturnValue(false);

      const body = payloads.createTextMessage('Hola');
      const req = { method: 'POST', body, headers: { 'x-hub-signature-256': 'sha256=invalid' } };

      // Re-require para captar env changes
      jest.resetModules();
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
        verifyWebhookSignature: jest.fn(() => false),
      }));
      jest.mock('../../core/services/infrastructure/correlationService', () => ({
        generateCorrelationId: jest.fn(() => 'test-corr-id'),
      }));
      jest.mock('../../core/services/infrastructure/deadLetterService', () => ({
        saveFailedMessage: jest.fn().mockResolvedValue(undefined),
      }));

      const webhookFresh = require('../../api-whatsapp-webhook');
      await webhookFresh(context, req);

      expect(context.res.status).toBe(401);

      // Restaurar
      process.env.AZURE_FUNCTIONS_ENVIRONMENT = originalEnv;
      process.env.SKIP_SIGNATURE_VALIDATION = originalSkip || 'true';
    });
  });
});
