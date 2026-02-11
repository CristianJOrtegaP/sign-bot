/**
 * Unit Test: SAP Document Endpoint
 * Verifica la recepcion y procesamiento de documentos desde SAP
 */

const { validateSapDocumentPayload } = require('../../bot/schemas/sapDocumentPayload');
const { createSapDocumentPayload, FAKE_PDF_BASE64 } = require('../factories/sapPayloadFactory');

describe('SAP Document Endpoint - Validacion de Payload', () => {
  // ===========================================================
  // PAYLOAD VALIDO
  // ===========================================================
  describe('Payload valido', () => {
    test('debe validar payload completo correctamente', () => {
      const payload = createSapDocumentPayload();
      const result = validateSapDocumentPayload(payload);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.sapDocumentId).toBeDefined();
      expect(result.data.clienteTelefono).toBe('5215512345678');
      expect(result.data.clienteNombre).toBe('Juan Perez');
      expect(result.data.tipoDocumento).toBe('CONTRATO');
    });

    test('debe aceptar payload con email opcional', () => {
      const payload = createSapDocumentPayload({ clienteEmail: 'test@example.com' });
      const result = validateSapDocumentPayload(payload);

      expect(result.success).toBe(true);
      expect(result.data.clienteEmail).toBe('test@example.com');
    });

    test('debe aceptar payload con datos extra opcionales', () => {
      const payload = createSapDocumentPayload({
        datosExtra: { campo1: 'valor1' },
      });
      const result = validateSapDocumentPayload(payload);

      expect(result.success).toBe(true);
      expect(result.data.datosExtra).toEqual({ campo1: 'valor1' });
    });

    test('debe aceptar payload con callback URL opcional', () => {
      const payload = createSapDocumentPayload({
        sapCallbackUrl: 'https://sap.example.com/callback',
      });
      const result = validateSapDocumentPayload(payload);

      expect(result.success).toBe(true);
    });

    test('debe aceptar todos los tipos de documento', () => {
      const tipos = ['CONTRATO', 'ADENDUM', 'PAGARE', 'OTRO'];
      for (const tipo of tipos) {
        const payload = createSapDocumentPayload({ tipoDocumento: tipo });
        const result = validateSapDocumentPayload(payload);
        expect(result.success).toBe(true);
        expect(result.data.tipoDocumento).toBe(tipo);
      }
    });

    test('debe usar OTRO como tipo por defecto', () => {
      const payload = createSapDocumentPayload();
      delete payload.tipoDocumento;
      const result = validateSapDocumentPayload(payload);

      expect(result.success).toBe(true);
      expect(result.data.tipoDocumento).toBe('OTRO');
    });
  });

  // ===========================================================
  // PAYLOAD INVALIDO
  // ===========================================================
  describe('Payload invalido', () => {
    test('debe rechazar payload sin sapDocumentId', () => {
      const payload = createSapDocumentPayload();
      delete payload.sapDocumentId;
      const result = validateSapDocumentPayload(payload);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('debe rechazar payload sin clienteTelefono', () => {
      const payload = createSapDocumentPayload();
      delete payload.clienteTelefono;
      const result = validateSapDocumentPayload(payload);

      expect(result.success).toBe(false);
    });

    test('debe rechazar clienteTelefono con formato invalido', () => {
      const payload = createSapDocumentPayload({ clienteTelefono: 'abc123' });
      const result = validateSapDocumentPayload(payload);

      expect(result.success).toBe(false);
    });

    test('debe rechazar clienteTelefono demasiado corto', () => {
      const payload = createSapDocumentPayload({ clienteTelefono: '123' });
      const result = validateSapDocumentPayload(payload);

      expect(result.success).toBe(false);
    });

    test('debe rechazar payload sin clienteNombre', () => {
      const payload = createSapDocumentPayload();
      delete payload.clienteNombre;
      const result = validateSapDocumentPayload(payload);

      expect(result.success).toBe(false);
    });

    test('debe rechazar payload sin documentoNombre', () => {
      const payload = createSapDocumentPayload();
      delete payload.documentoNombre;
      const result = validateSapDocumentPayload(payload);

      expect(result.success).toBe(false);
    });

    test('debe rechazar payload sin pdfBase64', () => {
      const payload = createSapDocumentPayload();
      delete payload.pdfBase64;
      const result = validateSapDocumentPayload(payload);

      expect(result.success).toBe(false);
    });

    test('debe rechazar pdfBase64 vacio', () => {
      const payload = createSapDocumentPayload({ pdfBase64: '' });
      const result = validateSapDocumentPayload(payload);

      expect(result.success).toBe(false);
    });

    test('debe rechazar tipo de documento invalido', () => {
      const payload = createSapDocumentPayload({ tipoDocumento: 'FACTURA' });
      const result = validateSapDocumentPayload(payload);

      expect(result.success).toBe(false);
    });

    test('debe rechazar email con formato invalido', () => {
      const payload = createSapDocumentPayload({ clienteEmail: 'not-an-email' });
      const result = validateSapDocumentPayload(payload);

      expect(result.success).toBe(false);
    });

    test('debe rechazar sapCallbackUrl con formato invalido', () => {
      const payload = createSapDocumentPayload({ sapCallbackUrl: 'not-a-url' });
      const result = validateSapDocumentPayload(payload);

      expect(result.success).toBe(false);
    });

    test('debe rechazar payload completamente vacio', () => {
      const result = validateSapDocumentPayload({});
      expect(result.success).toBe(false);
    });

    test('debe retornar mensajes de error descriptivos', () => {
      const result = validateSapDocumentPayload({});
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================
  // EDGE CASES
  // ===========================================================
  describe('Edge cases', () => {
    test('debe aceptar telefono de 10 digitos', () => {
      const payload = createSapDocumentPayload({ clienteTelefono: '5512345678' });
      const result = validateSapDocumentPayload(payload);
      expect(result.success).toBe(true);
    });

    test('debe aceptar telefono de 15 digitos', () => {
      const payload = createSapDocumentPayload({ clienteTelefono: '521551234567890' });
      const result = validateSapDocumentPayload(payload);
      expect(result.success).toBe(true);
    });

    test('pdfBase64 de la factory debe tener header de PDF', () => {
      const decoded = Buffer.from(FAKE_PDF_BASE64, 'base64').toString();
      expect(decoded.startsWith('%PDF')).toBe(true);
    });
  });
});
