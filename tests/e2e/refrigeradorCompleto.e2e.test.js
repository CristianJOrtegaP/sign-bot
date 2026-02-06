/**
 * E2E Test: Flujo Completo de Reporte de Refrigerador
 * Simula la interacción completa desde webhook hasta ticket creado
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
jest.mock('../../bot/controllers/messageHandler', () => {
  return {
    handleText: jest.fn().mockResolvedValue(undefined),
    handleButton: jest.fn().mockResolvedValue(undefined),
    handleLocation: jest.fn().mockResolvedValue(undefined),
  };
});
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
  generateCorrelationId: jest.fn(() => 'e2e-refri-corr'),
}));
jest.mock('../../core/services/infrastructure/deadLetterService', () => ({
  saveFailedMessage: jest.fn().mockResolvedValue(undefined),
}));

const webhook = require('../../api-whatsapp-webhook');
const messageHandler = require('../../bot/controllers/messageHandler');
const db = require('../../core/services/storage/databaseService');
const whatsapp = require('../../core/services/external/whatsappService');
const payloads = require('../factories/whatsappPayloads');

describe('Flujo Completo Refrigerador (E2E)', () => {
  const testPhone = '+5215540829614';

  beforeEach(() => {
    jest.clearAllMocks();
    db.__reset();
    whatsapp.__reset();
    db.registerMessageAtomic.mockResolvedValue({ isDuplicate: false, retryCount: 0 });
  });

  // ===========================================================
  // FLUJO 6 PASOS
  // ===========================================================
  describe('flujo completo de 6 pasos', () => {
    test('debe rutear cada paso al handler correcto', async () => {
      // PASO 1: Saludo
      const req1 = {
        method: 'POST',
        body: payloads.createTextMessage('Hola', testPhone),
        headers: {},
      };
      const ctx1 = global.createMockContext();
      await webhook(ctx1, req1);

      expect(ctx1.res.status).toBe(200);
      expect(messageHandler.handleText).toHaveBeenCalledWith(
        testPhone,
        'Hola',
        expect.any(String),
        expect.any(Object),
        null,
        expect.any(Object) // TimeoutBudget
      );

      // PASO 2: Seleccionar tipo refrigerador
      const req2 = {
        method: 'POST',
        body: payloads.createButtonResponse('btn_tipo_refrigerador', testPhone),
        headers: {},
      };
      const ctx2 = global.createMockContext();
      await webhook(ctx2, req2);

      expect(ctx2.res.status).toBe(200);
      expect(messageHandler.handleButton).toHaveBeenCalledWith(
        testPhone,
        'btn_tipo_refrigerador',
        expect.any(String),
        expect.any(Object)
      );

      // PASO 3: Código SAP
      const req3 = {
        method: 'POST',
        body: payloads.createTextMessage('1234567', testPhone),
        headers: {},
      };
      const ctx3 = global.createMockContext();
      await webhook(ctx3, req3);

      expect(messageHandler.handleText).toHaveBeenCalledWith(
        testPhone,
        '1234567',
        expect.any(String),
        expect.any(Object),
        null,
        expect.any(Object) // TimeoutBudget
      );

      // PASO 4: Confirmar equipo
      const req4 = {
        method: 'POST',
        body: payloads.createButtonResponse('btn_confirmar_equipo', testPhone),
        headers: {},
      };
      const ctx4 = global.createMockContext();
      await webhook(ctx4, req4);

      expect(messageHandler.handleButton).toHaveBeenCalledWith(
        testPhone,
        'btn_confirmar_equipo',
        expect.any(String),
        expect.any(Object)
      );

      // PASO 5: Descripción del problema
      const req5 = {
        method: 'POST',
        body: payloads.createTextMessage('No enfría correctamente', testPhone),
        headers: {},
      };
      const ctx5 = global.createMockContext();
      await webhook(ctx5, req5);

      expect(messageHandler.handleText).toHaveBeenCalledWith(
        testPhone,
        'No enfría correctamente',
        expect.any(String),
        expect.any(Object),
        null,
        expect.any(Object) // TimeoutBudget
      );

      // PASO 6: Confirmar datos finales
      const req6 = {
        method: 'POST',
        body: payloads.createButtonResponse('btn_confirmar_datos', testPhone),
        headers: {},
      };
      const ctx6 = global.createMockContext();
      await webhook(ctx6, req6);

      expect(messageHandler.handleButton).toHaveBeenCalledWith(
        testPhone,
        'btn_confirmar_datos',
        expect.any(String),
        expect.any(Object)
      );
    });

    test('debe registrar cada mensaje como no-duplicado', async () => {
      const messages = [
        payloads.createTextMessage('Hola', testPhone),
        payloads.createButtonResponse('btn_tipo_refrigerador', testPhone),
        payloads.createTextMessage('1234567', testPhone),
        payloads.createButtonResponse('btn_confirmar_equipo', testPhone),
        payloads.createTextMessage('No enfría', testPhone),
        payloads.createButtonResponse('btn_confirmar_datos', testPhone),
      ];

      for (const body of messages) {
        const ctx = global.createMockContext();
        await webhook(ctx, { method: 'POST', body, headers: {} });
        expect(ctx.res.status).toBe(200);
      }

      // Cada mensaje fue registrado atómicamente
      expect(db.registerMessageAtomic).toHaveBeenCalledTimes(6);
    });
  });

  // ===========================================================
  // CANCELACION A MITAD DE FLUJO
  // ===========================================================
  describe('cancelación a mitad de flujo', () => {
    test('debe permitir cancelar en cualquier punto', async () => {
      // Paso 1: Saludo
      await webhook(global.createMockContext(), {
        method: 'POST',
        body: payloads.createTextMessage('Hola', testPhone),
        headers: {},
      });

      // Paso 2: Iniciar reporte
      await webhook(global.createMockContext(), {
        method: 'POST',
        body: payloads.createButtonResponse('btn_tipo_refrigerador', testPhone),
        headers: {},
      });

      // Paso 3: Cancelar
      const ctxCancel = global.createMockContext();
      await webhook(ctxCancel, {
        method: 'POST',
        body: payloads.createButtonResponse('btn_cancelar', testPhone),
        headers: {},
      });

      expect(ctxCancel.res.status).toBe(200);
      expect(messageHandler.handleButton).toHaveBeenCalledWith(
        testPhone,
        'btn_cancelar',
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  // ===========================================================
  // IMAGEN EN FLUJO
  // ===========================================================
  describe('imagen dentro del flujo', () => {
    test('debe rutear imagen al imageHandler durante el flujo', async () => {
      const imageHandler = require('../../bot/controllers/imageHandler');

      // Enviar imagen
      const reqImg = {
        method: 'POST',
        body: payloads.createImageMessage('media-sap-code', testPhone),
        headers: {},
      };
      const ctxImg = global.createMockContext();
      await webhook(ctxImg, reqImg);

      expect(imageHandler.handleImage).toHaveBeenCalledWith(
        testPhone,
        expect.objectContaining({ id: 'media-sap-code' }),
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  // ===========================================================
  // UBICACION EN FLUJO VEHICULO
  // ===========================================================
  describe('ubicación en flujo de vehículo', () => {
    test('debe rutear ubicación al handler correcto', async () => {
      const reqLoc = {
        method: 'POST',
        body: payloads.createLocationMessage(25.6866, -100.3161, testPhone),
        headers: {},
      };
      const ctxLoc = global.createMockContext();
      await webhook(ctxLoc, reqLoc);

      expect(messageHandler.handleLocation).toHaveBeenCalledWith(
        testPhone,
        expect.objectContaining({ latitude: 25.6866, longitude: -100.3161 }),
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  // ===========================================================
  // PERFIL DE USUARIO
  // ===========================================================
  describe('actualización de perfil', () => {
    test('debe extraer y actualizar nombre del perfil de WhatsApp', async () => {
      const body = payloads.createTextMessage('Hola', testPhone);
      await webhook(global.createMockContext(), { method: 'POST', body, headers: {} });

      expect(db.updateUserName).toHaveBeenCalledWith(testPhone, 'Test User');
    });
  });
});
