/**
 * Unit Test: DocuSign Webhook Endpoint
 * Verifica procesamiento de eventos de DocuSign Connect
 */

const {
  validateDocusignWebhookPayload,
  extractDocusignEventData,
} = require('../../bot/schemas/docusignWebhookPayload');
const {
  createDocuSignWebhookPayload,
  createCompletedPayload,
  createDeclinedPayload,
  createVoidedPayload,
} = require('../factories/docusignPayloadFactory');

describe('DocuSign Webhook Endpoint', () => {
  // ===========================================================
  // VALIDACION DE PAYLOAD
  // ===========================================================
  describe('Validacion de payload', () => {
    test('debe validar payload de envelope-completed', () => {
      const payload = createCompletedPayload('env-test-001');
      const result = validateDocusignWebhookPayload(payload);

      expect(result.success).toBe(true);
      expect(result.data.event).toBe('envelope-completed');
      expect(result.data.data.envelopeId).toBe('env-test-001');
    });

    test('debe validar payload de envelope-declined', () => {
      const payload = createDeclinedPayload('env-test-002', 'No acepto');
      const result = validateDocusignWebhookPayload(payload);

      expect(result.success).toBe(true);
      expect(result.data.event).toBe('envelope-declined');
    });

    test('debe validar payload de envelope-voided', () => {
      const payload = createVoidedPayload('env-test-003');
      const result = validateDocusignWebhookPayload(payload);

      expect(result.success).toBe(true);
      expect(result.data.event).toBe('envelope-voided');
    });

    test('debe validar payload de envelope-sent', () => {
      const payload = createDocuSignWebhookPayload('env-test-004', 'envelope-sent');
      const result = validateDocusignWebhookPayload(payload);

      expect(result.success).toBe(true);
      expect(result.data.event).toBe('envelope-sent');
    });

    test('debe validar payload de recipient-delivered', () => {
      const payload = createDocuSignWebhookPayload('env-test-005', 'recipient-delivered');
      const result = validateDocusignWebhookPayload(payload);

      expect(result.success).toBe(true);
    });
  });

  // ===========================================================
  // PAYLOAD INVALIDO
  // ===========================================================
  describe('Payload invalido', () => {
    test('debe rechazar payload sin event', () => {
      const result = validateDocusignWebhookPayload({
        data: { accountId: 'test', envelopeId: 'test' },
      });
      expect(result.success).toBe(false);
    });

    test('debe rechazar payload sin data', () => {
      const result = validateDocusignWebhookPayload({
        event: 'envelope-completed',
      });
      expect(result.success).toBe(false);
    });

    test('debe rechazar payload sin envelopeId en data', () => {
      const result = validateDocusignWebhookPayload({
        event: 'envelope-completed',
        data: { accountId: 'test' },
      });
      expect(result.success).toBe(false);
    });

    test('debe rechazar payload sin accountId en data', () => {
      const result = validateDocusignWebhookPayload({
        event: 'envelope-completed',
        data: { envelopeId: 'test' },
      });
      expect(result.success).toBe(false);
    });

    test('debe rechazar payload completamente vacio', () => {
      const result = validateDocusignWebhookPayload({});
      expect(result.success).toBe(false);
    });

    test('debe rechazar payload null', () => {
      // validateDocusignWebhookPayload usa try/catch
      const result = validateDocusignWebhookPayload(null);
      expect(result.success).toBe(false);
    });
  });

  // ===========================================================
  // extractDocusignEventData
  // ===========================================================
  describe('extractDocusignEventData()', () => {
    test('debe extraer datos de envelope-completed', () => {
      const payload = createCompletedPayload('env-123');
      const data = extractDocusignEventData(payload);

      expect(data.event).toBe('envelope-completed');
      expect(data.envelopeId).toBe('env-123');
      expect(data.accountId).toBe('test-account-id');
      expect(data.status).toBe('completed');
    });

    test('debe extraer voidedReason de envelope-declined', () => {
      const payload = createDeclinedPayload('env-456', 'No estoy de acuerdo');
      const data = extractDocusignEventData(payload);

      expect(data.event).toBe('envelope-declined');
      expect(data.voidedReason).toBe('No estoy de acuerdo');
    });

    test('debe extraer voidedReason de envelope-voided', () => {
      const payload = createVoidedPayload('env-789');
      const data = extractDocusignEventData(payload);

      expect(data.event).toBe('envelope-voided');
      expect(data.status).toBe('voided');
      expect(data.voidedReason).toBeDefined();
    });

    test('debe retornar null para payload invalido', () => {
      const data = extractDocusignEventData(undefined);
      expect(data).toBeNull();
    });

    test('debe manejar payload sin envelopeSummary', () => {
      const payload = {
        event: 'envelope-sent',
        data: {
          accountId: 'test',
          envelopeId: 'env-000',
        },
      };
      const data = extractDocusignEventData(payload);

      expect(data.event).toBe('envelope-sent');
      expect(data.envelopeId).toBe('env-000');
      expect(data.status).toBeUndefined();
    });
  });

  // ===========================================================
  // EDGE CASES - Duplicate Events
  // ===========================================================
  describe('Edge cases', () => {
    test('payload con retryCount > 0 indica reenvio', () => {
      const payload = createCompletedPayload('env-dup');
      payload.retryCount = 3;

      const result = validateDocusignWebhookPayload(payload);
      expect(result.success).toBe(true);
      expect(result.data.retryCount).toBe(3);
    });

    test('multiples payloads con mismo envelopeId', () => {
      const payload1 = createDocuSignWebhookPayload('same-env', 'envelope-sent');
      const payload2 = createCompletedPayload('same-env');

      const data1 = extractDocusignEventData(payload1);
      const data2 = extractDocusignEventData(payload2);

      expect(data1.envelopeId).toBe(data2.envelopeId);
      expect(data1.event).not.toBe(data2.event);
    });
  });
});
