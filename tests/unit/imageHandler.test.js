/**
 * Tests - Image Handler (FASE 2b)
 * Pruebas del controlador de imágenes
 */

// Mocks
jest.mock('../../core/services/external/whatsappService', () =>
  require('../__mocks__/whatsappService')
);
jest.mock('../../core/services/storage/databaseService', () =>
  require('../__mocks__/databaseService')
);
jest.mock('../../core/config', () => require('../__mocks__/config'));

jest.mock('../../core/services/infrastructure/rateLimiter', () => ({
  checkRateLimit: jest.fn().mockReturnValue({ allowed: true }),
  recordRequest: jest.fn(),
}));

jest.mock('../../core/services/processing/backgroundProcessor', () => ({
  processImageInBackground: jest.fn().mockResolvedValue({ success: true }),
  processImageWithAIVision: jest.fn().mockResolvedValue({ success: true }),
}));

const imageHandler = require('../../bot/controllers/imageHandler');
const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');
const rateLimiter = require('../../core/services/infrastructure/rateLimiter');
const backgroundProcessor = require('../../core/services/processing/backgroundProcessor');

describe('ImageHandler (FASE 2b)', () => {
  let mockContext;
  const testPhone = '+5215540829614';

  beforeEach(() => {
    jest.clearAllMocks();
    whatsapp.__reset();
    db.__reset();

    mockContext = {
      log: jest.fn(),
      log_error: jest.fn(),
      log_warn: jest.fn(),
    };
    mockContext.log.error = jest.fn();
    mockContext.log.warn = jest.fn();
  });

  describe('handleImage', () => {
    test('debe usar OCR cuando está en estado REFRIGERADOR_ACTIVO', async () => {
      db.__setSession(testPhone, {
        Estado: 'REFRIGERADOR_ACTIVO',
        DatosTemp: JSON.stringify({ tipoReporte: 'REFRIGERADOR' }),
      });

      await imageHandler.handleImage(testPhone, { id: 'img_123' }, 'msg_123', mockContext);

      expect(rateLimiter.recordRequest).toHaveBeenCalledWith(testPhone, 'image');
      expect(whatsapp.sendTypingIndicator).toHaveBeenCalledWith(testPhone, 'msg_123');
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        testPhone,
        expect.stringContaining('código de barras')
      );
      expect(backgroundProcessor.processImageInBackground).toHaveBeenCalledWith(
        testPhone,
        'img_123',
        mockContext
      );
      expect(backgroundProcessor.processImageWithAIVision).not.toHaveBeenCalled();
    });

    test('debe usar AI Vision cuando está en estado VEHICULO_ACTIVO', async () => {
      db.__setSession(testPhone, {
        Estado: 'VEHICULO_ACTIVO',
        DatosTemp: JSON.stringify({ tipoReporte: 'VEHICULO' }),
      });

      await imageHandler.handleImage(
        testPhone,
        { id: 'img_456', caption: 'Mi vehículo dañado' },
        'msg_456',
        mockContext
      );

      expect(rateLimiter.recordRequest).toHaveBeenCalledWith(testPhone, 'image');
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        testPhone,
        expect.stringContaining('inteligencia artificial')
      );
      expect(backgroundProcessor.processImageWithAIVision).toHaveBeenCalledWith(
        testPhone,
        'img_456',
        'Mi vehículo dañado',
        mockContext
      );
      expect(backgroundProcessor.processImageInBackground).not.toHaveBeenCalled();
    });

    test('debe usar AI Vision cuando no está en estado flexible (INICIO)', async () => {
      db.__setSession(testPhone, { Estado: 'INICIO' });

      await imageHandler.handleImage(testPhone, { id: 'img_789' }, 'msg_789', mockContext);

      // En estado INICIO, usa AI Vision por defecto
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        testPhone,
        expect.stringContaining('inteligencia artificial')
      );
      expect(backgroundProcessor.processImageWithAIVision).toHaveBeenCalled();
    });

    test('debe rechazar imagen si excede rate limit', async () => {
      rateLimiter.checkRateLimit.mockReturnValueOnce({
        allowed: false,
        reason: 'Límite de imágenes excedido',
      });

      await imageHandler.handleImage(testPhone, { id: 'img_123' }, 'msg_123', mockContext);

      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        testPhone,
        expect.stringContaining('Límite')
      );
      expect(backgroundProcessor.processImageInBackground).not.toHaveBeenCalled();
      expect(backgroundProcessor.processImageWithAIVision).not.toHaveBeenCalled();
    });

    test('debe manejar errores del procesamiento OCR sin bloquear', async () => {
      db.__setSession(testPhone, {
        Estado: 'REFRIGERADOR_ACTIVO',
        DatosTemp: JSON.stringify({ tipoReporte: 'REFRIGERADOR' }),
      });
      backgroundProcessor.processImageInBackground.mockRejectedValueOnce(new Error('OCR error'));

      // No debería lanzar error (fire-and-forget)
      await expect(
        imageHandler.handleImage(testPhone, { id: 'img_123' }, 'msg_123', mockContext)
      ).resolves.not.toThrow();

      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        testPhone,
        expect.stringContaining('código de barras')
      );
    });

    test('debe manejar errores del procesamiento AI Vision sin bloquear', async () => {
      db.__setSession(testPhone, {
        Estado: 'VEHICULO_ACTIVO',
        DatosTemp: JSON.stringify({ tipoReporte: 'VEHICULO' }),
      });
      backgroundProcessor.processImageWithAIVision.mockRejectedValueOnce(
        new Error('AI Vision error')
      );

      // No debería lanzar error (fire-and-forget)
      await expect(
        imageHandler.handleImage(testPhone, { id: 'img_123' }, 'msg_123', mockContext)
      ).resolves.not.toThrow();

      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        testPhone,
        expect.stringContaining('inteligencia artificial')
      );
    });

    test('debe rechazar imagen con tipo MIME no permitido', async () => {
      db.__setSession(testPhone, { Estado: 'REFRIGERADOR_ACTIVO' });

      await imageHandler.handleImage(
        testPhone,
        { id: 'img_123', mime_type: 'application/pdf' },
        'msg_123',
        mockContext
      );

      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        testPhone,
        expect.stringContaining('Formato de imagen no soportado')
      );
      expect(backgroundProcessor.processImageInBackground).not.toHaveBeenCalled();
    });

    test('debe rechazar imagen muy grande', async () => {
      db.__setSession(testPhone, { Estado: 'REFRIGERADOR_ACTIVO' });

      await imageHandler.handleImage(
        testPhone,
        { id: 'img_123', file_size: 20 * 1024 * 1024 }, // 20MB
        'msg_123',
        mockContext
      );

      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        testPhone,
        expect.stringContaining('demasiado grande')
      );
      expect(backgroundProcessor.processImageInBackground).not.toHaveBeenCalled();
    });

    test('debe rechazar imagen muy pequeña', async () => {
      db.__setSession(testPhone, { Estado: 'REFRIGERADOR_ACTIVO' });

      await imageHandler.handleImage(
        testPhone,
        { id: 'img_123', file_size: 100 }, // 100 bytes
        'msg_123',
        mockContext
      );

      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        testPhone,
        expect.stringContaining('muy pequeña')
      );
      expect(backgroundProcessor.processImageInBackground).not.toHaveBeenCalled();
    });

    test('debe rechazar imagen sin ID válido', async () => {
      db.__setSession(testPhone, { Estado: 'REFRIGERADOR_ACTIVO' });

      await imageHandler.handleImage(testPhone, { id: null }, 'msg_123', mockContext);

      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        testPhone,
        expect.stringContaining('No pude procesar la imagen')
      );
    });
  });
});
