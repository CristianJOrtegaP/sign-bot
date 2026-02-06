/**
 * Unit Test: Image Handler
 * Verifica validación de imágenes, rate limiting y routing OCR/AI Vision
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
jest.mock('../../core/services/infrastructure/errorHandler', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../core/services/processing/backgroundProcessor', () => ({
  processImageInBackground: jest.fn().mockResolvedValue(undefined),
  processImageWithAIVision: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../core/services/infrastructure/correlationService', () => ({
  getCorrelationId: jest.fn(() => 'test-corr-id'),
  generateCorrelationId: jest.fn(() => 'test-corr-id'),
}));
jest.mock('../../core/services/infrastructure/rateLimiter', () => ({
  checkRateLimitDistributed: jest.fn().mockResolvedValue({ allowed: true }),
  recordRequest: jest.fn(),
}));

const { handleImage, IMAGE_LIMITS } = require('../../bot/controllers/imageHandler');
const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');
const backgroundProcessor = require('../../core/services/processing/backgroundProcessor');
const rateLimiter = require('../../core/services/infrastructure/rateLimiter');

describe('ImageHandler', () => {
  let context;
  const from = '+5215512345678';
  const messageId = 'img-msg-1';

  beforeEach(() => {
    jest.clearAllMocks();
    context = global.createMockContext();
    db.__reset();
    db.__setSession(from, { Estado: 'INICIO', Version: 1, DatosTemp: null, EquipoId: null });
    db.getSessionFresh.mockResolvedValue({
      Estado: 'INICIO',
      Version: 1,
      DatosTemp: null,
      EquipoId: null,
    });
    rateLimiter.checkRateLimitDistributed.mockResolvedValue({ allowed: true });
    whatsapp.sendAndSaveText.mockResolvedValue(undefined);
    whatsapp.sendTypingIndicator.mockResolvedValue(undefined);
  });

  // ===========================================================
  // VALIDACION DE DATOS
  // ===========================================================
  describe('validación de datos de imagen', () => {
    test('debe rechazar imagen sin id', async () => {
      await handleImage(from, {}, messageId, context);
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        from,
        expect.stringContaining('No pude procesar la imagen')
      );
    });

    test('debe rechazar imagen con solo mime_type (sin id)', async () => {
      await handleImage(from, { mime_type: 'image/jpeg' }, messageId, context);
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        from,
        expect.stringContaining('No pude procesar la imagen')
      );
    });

    test('debe rechazar tipo MIME no permitido', async () => {
      await handleImage(from, { id: 'img-1', mime_type: 'image/bmp' }, messageId, context);
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        from,
        expect.stringContaining('Formato de imagen no soportado')
      );
    });

    test('debe rechazar imagen demasiado grande', async () => {
      await handleImage(
        from,
        { id: 'img-1', file_size: IMAGE_LIMITS.MAX_SIZE_BYTES + 1 },
        messageId,
        context
      );
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        from,
        expect.stringContaining('demasiado grande')
      );
    });

    test('debe rechazar imagen demasiado pequeña', async () => {
      await handleImage(from, { id: 'img-1', file_size: 100 }, messageId, context);
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        from,
        expect.stringContaining('muy pequeña')
      );
    });
  });

  // ===========================================================
  // RATE LIMITING
  // ===========================================================
  describe('rate limiting', () => {
    test('debe respetar rate limit de imágenes', async () => {
      rateLimiter.checkRateLimitDistributed.mockResolvedValue({
        allowed: false,
        reason: 'Too many',
      });
      await handleImage(from, { id: 'img-1' }, messageId, context);
      expect(backgroundProcessor.processImageInBackground).not.toHaveBeenCalled();
      expect(backgroundProcessor.processImageWithAIVision).not.toHaveBeenCalled();
    });
  });

  // ===========================================================
  // ROUTING OCR vs AI VISION
  // ===========================================================
  describe('routing de procesamiento', () => {
    test('debe usar AI Vision para estado INICIO', async () => {
      await handleImage(from, { id: 'img-1' }, messageId, context);
      expect(backgroundProcessor.processImageWithAIVision).toHaveBeenCalled();
      expect(backgroundProcessor.processImageInBackground).not.toHaveBeenCalled();
    });

    test('debe usar OCR para REFRIGERADOR_ACTIVO', async () => {
      db.getSessionFresh.mockResolvedValue({
        Estado: 'REFRIGERADOR_ACTIVO',
        Version: 1,
        DatosTemp: JSON.stringify({ tipoReporte: 'REFRIGERADOR' }),
        EquipoId: null,
      });
      await handleImage(from, { id: 'img-1' }, messageId, context);
      expect(backgroundProcessor.processImageInBackground).toHaveBeenCalled();
      expect(backgroundProcessor.processImageWithAIVision).not.toHaveBeenCalled();
    });

    test('debe usar AI Vision para VEHICULO_ACTIVO', async () => {
      db.getSessionFresh.mockResolvedValue({
        Estado: 'VEHICULO_ACTIVO',
        Version: 1,
        DatosTemp: JSON.stringify({ tipoReporte: 'VEHICULO' }),
        EquipoId: null,
      });
      await handleImage(from, { id: 'img-1' }, messageId, context);
      expect(backgroundProcessor.processImageWithAIVision).toHaveBeenCalled();
    });
  });

  // ===========================================================
  // CAPTION
  // ===========================================================
  describe('caption de imagen', () => {
    test('debe guardar caption como mensaje si está presente', async () => {
      await handleImage(from, { id: 'img-1', caption: 'Mi refrigerador' }, messageId, context);
      expect(db.saveMessage).toHaveBeenCalledWith(from, 'U', 'Mi refrigerador', 'TEXTO');
    });

    test('no debe guardar caption vacío', async () => {
      await handleImage(from, { id: 'img-1', caption: '' }, messageId, context);
      // saveMessage se llama para placeholder, no para caption
      // Solo debe haber llamadas de placeholder, no de caption
      expect(db.saveMessage).not.toHaveBeenCalledWith(from, 'U', '', 'TEXTO');
    });
  });

  // ===========================================================
  // TYPING INDICATOR
  // ===========================================================
  describe('typing indicator', () => {
    test('debe enviar typing indicator', async () => {
      await handleImage(from, { id: 'img-1' }, messageId, context);
      expect(whatsapp.sendTypingIndicator).toHaveBeenCalledWith(from, messageId);
    });
  });
});
