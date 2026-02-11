/**
 * E2E Test: Flujo Completo de Documento de Firma
 * Simula el ciclo de vida completo de un documento desde SAP hasta firma/rechazo
 *
 * Flujo:
 * 1. SAP envia documento -> API crea envelope, envia template
 * 2. DocuSign webhook: envelope-sent -> actualiza a ENVIADO
 * 3. DocuSign webhook: recipient-viewed -> actualiza a VISTO
 * 4. Usuario escribe "mis documentos" -> bot retorna lista
 * 5. Usuario selecciona documento 1 -> bot muestra detalle
 * 6. Usuario presiona "Rechazar" -> bot pide motivo
 * 7. Usuario envia motivo -> bot confirma rechazo, notifica Teams
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
jest.mock('../../core/services/external/docusignService', () =>
  require('../__mocks__/docusignService.mock')
);
jest.mock('../../core/services/external/teamsService', () => ({
  notifyDocumentRejected: jest.fn().mockResolvedValue(undefined),
  notifyNewDocument: jest.fn().mockResolvedValue(undefined),
  sendMessage: jest.fn().mockResolvedValue(undefined),
}));
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
  generateCorrelationId: jest.fn(() => 'e2e-firma-corr'),
}));
jest.mock('../../core/services/infrastructure/deadLetterService', () => ({
  saveFailedMessage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../core/services/infrastructure/errorHandler', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const webhook = require('../../api-whatsapp-webhook');
const messageHandler = require('../../bot/controllers/messageHandler');
const db = require('../../core/services/storage/databaseService');
const whatsapp = require('../../core/services/external/whatsappService');
const docusign = require('../../core/services/external/docusignService');
const payloads = require('../factories/whatsappPayloads');
const { createSapDocumentPayload } = require('../factories/sapPayloadFactory');
const {
  createDocuSignWebhookPayload,
  createCompletedPayload,
} = require('../factories/docusignPayloadFactory');
const { validateSapDocumentPayload } = require('../../bot/schemas/sapDocumentPayload');
const {
  validateDocusignWebhookPayload,
  extractDocusignEventData,
} = require('../../bot/schemas/docusignWebhookPayload');

describe('Flujo Completo Documento Firma (E2E)', () => {
  const testPhone = '+5215540829614';
  const testEnvelopeId = 'env-e2e-test-001';

  beforeEach(() => {
    jest.clearAllMocks();
    db.__reset();
    whatsapp.__reset();
    docusign.__reset();
    db.registerMessageAtomic.mockResolvedValue({ isDuplicate: false, retryCount: 0 });
  });

  // ===========================================================
  // PASO 1: SAP envia documento
  // ===========================================================
  describe('Paso 1: SAP envia documento via API', () => {
    test('debe validar payload de SAP correctamente', () => {
      const payload = createSapDocumentPayload({
        clienteTelefono: '5215540829614',
        clienteNombre: 'Carlos Test',
        documentoNombre: 'Contrato E2E',
      });

      const result = validateSapDocumentPayload(payload);
      expect(result.success).toBe(true);
      expect(result.data.clienteNombre).toBe('Carlos Test');
    });

    test('debe crear documento en base de datos', async () => {
      const docData = {
        SapDocumentId: 'SAP-E2E-001',
        ClienteTelefono: testPhone,
        ClienteNombre: 'Carlos Test',
        TipoDocumento: 'CONTRATO',
        DocumentoNombre: 'Contrato E2E',
        EstadoDocumento: 'PENDIENTE_ENVIO',
      };

      const result = await db.crearDocumento(docData);
      expect(result.DocumentoId).toBeDefined();

      const stored = db.__getStoredDocumento(result.DocumentoId);
      expect(stored.ClienteNombre).toBe('Carlos Test');
      expect(stored.EstadoDocumento).toBe('PENDIENTE_ENVIO');
    });

    test('docuSignService.createEnvelope debe retornar envelope y URL', async () => {
      docusign.__setCreateEnvelopeResponse({
        envelopeId: testEnvelopeId,
        signingUrl: 'https://demo.docusign.net/signing/e2e-test',
      });

      const result = await docusign.createEnvelope();
      expect(result.envelopeId).toBe(testEnvelopeId);
      expect(result.signingUrl).toContain('docusign.net');
    });

    test('whatsappService.sendTemplate debe enviar notificacion al cliente', async () => {
      await whatsapp.sendTemplate(testPhone, 'firma_envio', {
        clienteNombre: 'Carlos Test',
        tipoDocumento: 'Contrato',
        documentoNombre: 'Contrato E2E',
        signingUrl: 'https://demo.docusign.net/signing/e2e-test',
      });

      expect(whatsapp.sendTemplate).toHaveBeenCalledWith(
        testPhone,
        'firma_envio',
        expect.objectContaining({ clienteNombre: 'Carlos Test' })
      );

      const messages = whatsapp.__getMessagesTo(testPhone);
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('template');
    });
  });

  // ===========================================================
  // PASO 2: DocuSign webhook - envelope-sent
  // ===========================================================
  describe('Paso 2: DocuSign webhook - envelope-sent', () => {
    test('debe validar payload de DocuSign Connect', () => {
      const payload = createDocuSignWebhookPayload(testEnvelopeId, 'envelope-sent');
      const result = validateDocusignWebhookPayload(payload);

      expect(result.success).toBe(true);
      expect(result.data.event).toBe('envelope-sent');
    });

    test('debe extraer datos del evento correctamente', () => {
      const payload = createDocuSignWebhookPayload(testEnvelopeId, 'envelope-sent');
      const data = extractDocusignEventData(payload);

      expect(data.envelopeId).toBe(testEnvelopeId);
      expect(data.event).toBe('envelope-sent');
    });

    test('debe actualizar estado del documento a ENVIADO', async () => {
      // Pre-crear documento
      db.__setDocumento(1, {
        SapDocumentId: 'SAP-E2E-001',
        EnvelopeId: testEnvelopeId,
        EstadoDocumento: 'PENDIENTE_ENVIO',
        ClienteTelefono: testPhone,
      });

      await db.actualizarEstadoDocumento(1, 'ENVIADO');
      const doc = db.__getStoredDocumento(1);
      expect(doc.EstadoDocumento).toBe('ENVIADO');
    });
  });

  // ===========================================================
  // PASO 3: DocuSign webhook - recipient-viewed
  // ===========================================================
  describe('Paso 3: DocuSign webhook - recipient-viewed', () => {
    test('debe actualizar estado del documento a VISTO', async () => {
      db.__setDocumento(1, {
        EnvelopeId: testEnvelopeId,
        EstadoDocumento: 'ENVIADO',
        ClienteTelefono: testPhone,
      });

      await db.actualizarEstadoDocumento(1, 'VISTO');
      const doc = db.__getStoredDocumento(1);
      expect(doc.EstadoDocumento).toBe('VISTO');
    });
  });

  // ===========================================================
  // PASO 4: Usuario consulta documentos
  // ===========================================================
  describe('Paso 4: Usuario envia "mis documentos"', () => {
    test('debe rutear mensaje de texto al handler correcto', async () => {
      const req = {
        method: 'POST',
        body: payloads.createTextMessage('mis documentos', testPhone),
        headers: {},
      };
      const ctx = global.createMockContext();
      await webhook(ctx, req);

      expect(ctx.res.status).toBe(200);
      expect(messageHandler.handleText).toHaveBeenCalledWith(
        testPhone,
        'mis documentos',
        expect.any(String),
        expect.any(Object),
        null,
        expect.any(Object)
      );
    });
  });

  // ===========================================================
  // PASO 5: Usuario selecciona documento
  // ===========================================================
  describe('Paso 5: Usuario selecciona documento "1"', () => {
    test('debe rutear seleccion de documento al handler', async () => {
      const req = {
        method: 'POST',
        body: payloads.createTextMessage('1', testPhone),
        headers: {},
      };
      const ctx = global.createMockContext();
      await webhook(ctx, req);

      expect(ctx.res.status).toBe(200);
      expect(messageHandler.handleText).toHaveBeenCalledWith(
        testPhone,
        '1',
        expect.any(String),
        expect.any(Object),
        null,
        expect.any(Object)
      );
    });
  });

  // ===========================================================
  // PASO 6: Usuario presiona "Rechazar"
  // ===========================================================
  describe('Paso 6: Usuario presiona boton "Rechazar"', () => {
    test('debe rutear boton de rechazo al handler', async () => {
      const req = {
        method: 'POST',
        body: payloads.createButtonResponse('btn_rechazar', testPhone),
        headers: {},
      };
      const ctx = global.createMockContext();
      await webhook(ctx, req);

      expect(ctx.res.status).toBe(200);
      expect(messageHandler.handleButton).toHaveBeenCalledWith(
        testPhone,
        'btn_rechazar',
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  // ===========================================================
  // PASO 7: Usuario envia motivo de rechazo
  // ===========================================================
  describe('Paso 7: Usuario envia motivo de rechazo', () => {
    test('debe rutear motivo de rechazo al handler de texto', async () => {
      const req = {
        method: 'POST',
        body: payloads.createTextMessage('No estoy de acuerdo con la clausula 5', testPhone),
        headers: {},
      };
      const ctx = global.createMockContext();
      await webhook(ctx, req);

      expect(ctx.res.status).toBe(200);
      expect(messageHandler.handleText).toHaveBeenCalledWith(
        testPhone,
        'No estoy de acuerdo con la clausula 5',
        expect.any(String),
        expect.any(Object),
        null,
        expect.any(Object)
      );
    });

    test('debe poder registrar rechazo en base de datos', async () => {
      db.__setDocumento(1, {
        EnvelopeId: testEnvelopeId,
        EstadoDocumento: 'VISTO',
        ClienteTelefono: testPhone,
        DocumentoNombre: 'Contrato E2E',
      });

      await db.actualizarEstadoDocumento(1, 'RECHAZADO', 'No estoy de acuerdo');
      const doc = db.__getStoredDocumento(1);
      expect(doc.EstadoDocumento).toBe('RECHAZADO');
      expect(doc.MotivoRechazo).toBe('No estoy de acuerdo');
    });
  });

  // ===========================================================
  // FLUJO COMPLETO: cada paso registra mensaje como no-duplicado
  // ===========================================================
  describe('Flujo completo - deduplicacion', () => {
    test('debe registrar cada mensaje como no-duplicado', async () => {
      const messages = [
        payloads.createTextMessage('mis documentos', testPhone),
        payloads.createTextMessage('1', testPhone),
        payloads.createButtonResponse('btn_rechazar', testPhone),
        payloads.createTextMessage('No estoy de acuerdo', testPhone),
      ];

      for (const body of messages) {
        const ctx = global.createMockContext();
        await webhook(ctx, { method: 'POST', body, headers: {} });
        expect(ctx.res.status).toBe(200);
      }

      // Cada mensaje fue registrado atomicamente
      expect(db.registerMessageAtomic).toHaveBeenCalledTimes(4);
    });
  });

  // ===========================================================
  // FLUJO ALTERNATIVO: Documento firmado exitosamente
  // ===========================================================
  describe('Flujo alternativo: firma exitosa via DocuSign', () => {
    test('debe validar payload de envelope-completed', () => {
      const payload = createCompletedPayload(testEnvelopeId);
      const result = validateDocusignWebhookPayload(payload);

      expect(result.success).toBe(true);
      expect(result.data.event).toBe('envelope-completed');
    });

    test('debe poder actualizar documento a FIRMADO', async () => {
      db.__setDocumento(1, {
        EnvelopeId: testEnvelopeId,
        EstadoDocumento: 'VISTO',
        ClienteTelefono: testPhone,
      });

      await db.actualizarEstadoDocumento(1, 'FIRMADO');
      const doc = db.__getStoredDocumento(1);
      expect(doc.EstadoDocumento).toBe('FIRMADO');
    });

    test('debe poder descargar documento firmado', async () => {
      const buffer = await docusign.downloadSignedDocument(testEnvelopeId);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================
  // PERFIL DE USUARIO
  // ===========================================================
  describe('Actualizacion de perfil', () => {
    test('debe extraer y actualizar nombre del perfil de WhatsApp', async () => {
      const body = payloads.createTextMessage('Hola', testPhone);
      await webhook(global.createMockContext(), { method: 'POST', body, headers: {} });

      expect(db.updateUserName).toHaveBeenCalledWith(testPhone, 'Test User');
    });
  });

  // ===========================================================
  // EDGE CASES
  // ===========================================================
  describe('Edge cases', () => {
    test('DocuSign webhook con envelope desconocido no debe fallar', () => {
      const payload = createCompletedPayload('env-desconocido-xyz');
      const data = extractDocusignEventData(payload);

      expect(data.envelopeId).toBe('env-desconocido-xyz');
      // El sistema deberia procesar sin error (return 200)
    });

    test('debe poder anular documento via correctEnvelope', async () => {
      const result = await docusign.correctEnvelope(testEnvelopeId, Buffer.from('nuevo-pdf'));
      expect(result.envelopeId).toBe(testEnvelopeId);
      expect(result.signingUrl).toContain('corrected');
    });

    test('debe poder anular envelope completo', async () => {
      const result = await docusign.voidEnvelope(testEnvelopeId, 'Cancelado por SAP');
      expect(result.success).toBe(true);
    });
  });
});
