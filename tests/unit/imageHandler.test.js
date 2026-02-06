/**
 * Unit Test: Image Handler
 * Verifica validación de imágenes, rate limiting y routing inteligente
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
  saveImageOnly: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../core/services/infrastructure/correlationService', () => ({
  getCorrelationId: jest.fn(() => 'test-corr-id'),
  generateCorrelationId: jest.fn(() => 'test-corr-id'),
}));
jest.mock('../../core/services/infrastructure/rateLimiter', () => ({
  checkRateLimitDistributed: jest.fn().mockResolvedValue({ allowed: true }),
  recordRequest: jest.fn(),
}));

const {
  handleImage,
  determineImageRoute,
  IMAGE_LIMITS,
} = require('../../bot/controllers/imageHandler');
const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');
const backgroundProcessor = require('../../core/services/processing/backgroundProcessor');
const rateLimiter = require('../../core/services/infrastructure/rateLimiter');
const { ESTADO } = require('../../bot/constants/sessionStates');

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
      expect(backgroundProcessor.saveImageOnly).not.toHaveBeenCalled();
    });
  });

  // ===========================================================
  // determineImageRoute (función pura)
  // ===========================================================
  describe('determineImageRoute', () => {
    test('BLOCK_CONFIRMATION para REFRIGERADOR_CONFIRMAR_DATOS_AI', () => {
      const result = determineImageRoute(ESTADO.REFRIGERADOR_CONFIRMAR_DATOS_AI, {});
      expect(result.route).toBe('BLOCK_CONFIRMATION');
      expect(result.message).toContain('confirma o rechaza');
    });

    test('BLOCK_CONFIRMATION para VEHICULO_CONFIRMAR_DATOS_AI', () => {
      const result = determineImageRoute(ESTADO.VEHICULO_CONFIRMAR_DATOS_AI, {});
      expect(result.route).toBe('BLOCK_CONFIRMATION');
    });

    test('BLOCK_CONFIRMATION para REFRIGERADOR_CONFIRMAR_EQUIPO', () => {
      const result = determineImageRoute(ESTADO.REFRIGERADOR_CONFIRMAR_EQUIPO, {});
      expect(result.route).toBe('BLOCK_CONFIRMATION');
    });

    test('AI_VISION_INICIO para estado INICIO', () => {
      const result = determineImageRoute(ESTADO.INICIO, null);
      expect(result.route).toBe('AI_VISION_INICIO');
    });

    test('AI_VISION_INICIO cuando no hay tipoReporte', () => {
      const result = determineImageRoute('REFRIGERADOR_ACTIVO', {});
      expect(result.route).toBe('AI_VISION_INICIO');
    });

    test('OCR_SAP para refrigerador sin código SAP', () => {
      const datos = {
        tipoReporte: 'REFRIGERADOR',
        camposRequeridos: { codigoSAP: { valor: null, completo: false } },
      };
      const result = determineImageRoute(ESTADO.REFRIGERADOR_ACTIVO, datos);
      expect(result.route).toBe('OCR_SAP');
    });

    test('AI_VISION_PROBLEMA para refrigerador con SAP pero sin problema', () => {
      const datos = {
        tipoReporte: 'REFRIGERADOR',
        camposRequeridos: {
          codigoSAP: { valor: '1234567', completo: true },
          problema: { valor: null, completo: false },
        },
      };
      const result = determineImageRoute(ESTADO.REFRIGERADOR_ACTIVO, datos);
      expect(result.route).toBe('AI_VISION_PROBLEMA');
    });

    test('SAVE_ONLY para refrigerador con SAP y problema completos', () => {
      const datos = {
        tipoReporte: 'REFRIGERADOR',
        camposRequeridos: {
          codigoSAP: { valor: '1234567', completo: true },
          problema: { valor: 'No enfría', completo: true },
        },
      };
      const result = determineImageRoute(ESTADO.REFRIGERADOR_ACTIVO, datos);
      expect(result.route).toBe('SAVE_ONLY');
    });

    test('AI_VISION_PROBLEMA para vehículo sin problema', () => {
      const datos = {
        tipoReporte: 'VEHICULO',
        camposRequeridos: { problema: { valor: null, completo: false } },
      };
      const result = determineImageRoute(ESTADO.VEHICULO_ACTIVO, datos);
      expect(result.route).toBe('AI_VISION_PROBLEMA');
    });

    test('SAVE_ONLY para vehículo con problema completo', () => {
      const datos = {
        tipoReporte: 'VEHICULO',
        camposRequeridos: { problema: { valor: 'Llanta ponchada', completo: true } },
      };
      const result = determineImageRoute(ESTADO.VEHICULO_ACTIVO, datos);
      expect(result.route).toBe('SAVE_ONLY');
    });

    test('AI_VISION_INICIO como fallback para estados desconocidos', () => {
      const datos = { tipoReporte: 'REFRIGERADOR' };
      const result = determineImageRoute('ALGUN_OTRO_ESTADO', datos);
      expect(result.route).toBe('AI_VISION_INICIO');
    });
  });

  // ===========================================================
  // ROUTING INTEGRADO (handleImage)
  // ===========================================================
  describe('routing de procesamiento', () => {
    test('debe usar AI Vision para estado INICIO', async () => {
      await handleImage(from, { id: 'img-1' }, messageId, context);
      expect(backgroundProcessor.processImageWithAIVision).toHaveBeenCalled();
      expect(backgroundProcessor.processImageInBackground).not.toHaveBeenCalled();
    });

    test('debe usar OCR para REFRIGERADOR_ACTIVO sin código SAP', async () => {
      db.getSessionFresh.mockResolvedValue({
        Estado: 'REFRIGERADOR_ACTIVO',
        Version: 1,
        DatosTemp: JSON.stringify({
          tipoReporte: 'REFRIGERADOR',
          camposRequeridos: { codigoSAP: { valor: null, completo: false } },
        }),
        EquipoId: null,
      });
      await handleImage(from, { id: 'img-1' }, messageId, context);
      expect(backgroundProcessor.processImageInBackground).toHaveBeenCalled();
      expect(backgroundProcessor.processImageWithAIVision).not.toHaveBeenCalled();
    });

    test('debe usar AI Vision para REFRIGERADOR_ACTIVO con SAP pero sin problema', async () => {
      db.getSessionFresh.mockResolvedValue({
        Estado: 'REFRIGERADOR_ACTIVO',
        Version: 1,
        DatosTemp: JSON.stringify({
          tipoReporte: 'REFRIGERADOR',
          camposRequeridos: {
            codigoSAP: { valor: '1234567', completo: true },
            problema: { valor: null, completo: false },
          },
        }),
        EquipoId: null,
      });
      await handleImage(from, { id: 'img-1' }, messageId, context);
      expect(backgroundProcessor.processImageWithAIVision).toHaveBeenCalled();
      expect(backgroundProcessor.processImageInBackground).not.toHaveBeenCalled();
    });

    test('debe usar saveImageOnly para REFRIGERADOR_ACTIVO con todos los datos', async () => {
      db.getSessionFresh.mockResolvedValue({
        Estado: 'REFRIGERADOR_ACTIVO',
        Version: 1,
        DatosTemp: JSON.stringify({
          tipoReporte: 'REFRIGERADOR',
          camposRequeridos: {
            codigoSAP: { valor: '1234567', completo: true },
            problema: { valor: 'No enfría', completo: true },
          },
        }),
        EquipoId: null,
      });
      await handleImage(from, { id: 'img-1' }, messageId, context);
      expect(backgroundProcessor.saveImageOnly).toHaveBeenCalled();
      expect(backgroundProcessor.processImageInBackground).not.toHaveBeenCalled();
      expect(backgroundProcessor.processImageWithAIVision).not.toHaveBeenCalled();
    });

    test('debe usar AI Vision para VEHICULO_ACTIVO sin problema', async () => {
      db.getSessionFresh.mockResolvedValue({
        Estado: 'VEHICULO_ACTIVO',
        Version: 1,
        DatosTemp: JSON.stringify({
          tipoReporte: 'VEHICULO',
          camposRequeridos: { problema: { valor: null, completo: false } },
        }),
        EquipoId: null,
      });
      await handleImage(from, { id: 'img-1' }, messageId, context);
      expect(backgroundProcessor.processImageWithAIVision).toHaveBeenCalled();
    });

    test('debe usar saveImageOnly para VEHICULO_ACTIVO con problema', async () => {
      db.getSessionFresh.mockResolvedValue({
        Estado: 'VEHICULO_ACTIVO',
        Version: 1,
        DatosTemp: JSON.stringify({
          tipoReporte: 'VEHICULO',
          camposRequeridos: { problema: { valor: 'Llanta ponchada', completo: true } },
        }),
        EquipoId: null,
      });
      await handleImage(from, { id: 'img-1' }, messageId, context);
      expect(backgroundProcessor.saveImageOnly).toHaveBeenCalled();
    });

    test('debe bloquear imagen en estado de confirmación pendiente', async () => {
      db.getSessionFresh.mockResolvedValue({
        Estado: 'REFRIGERADOR_CONFIRMAR_DATOS_AI',
        Version: 1,
        DatosTemp: JSON.stringify({ tipoReporte: 'REFRIGERADOR' }),
        EquipoId: null,
      });
      await handleImage(from, { id: 'img-1' }, messageId, context);
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        from,
        expect.stringContaining('confirma o rechaza')
      );
      expect(backgroundProcessor.processImageInBackground).not.toHaveBeenCalled();
      expect(backgroundProcessor.processImageWithAIVision).not.toHaveBeenCalled();
      expect(backgroundProcessor.saveImageOnly).not.toHaveBeenCalled();
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
