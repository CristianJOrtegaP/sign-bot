/**
 * Unit Test: WhatsApp Templates
 * Verifica buildTemplatePayload para todos los templates de firma
 */

const {
  TEMPLATE_NAMES,
  TEMPLATES,
  buildTemplatePayload,
} = require('../../bot/constants/whatsappTemplates');

describe('WhatsApp Templates', () => {
  // ===========================================================
  // TEMPLATE NAMES
  // ===========================================================
  describe('Template names', () => {
    test('debe tener los 4 templates definidos', () => {
      expect(TEMPLATE_NAMES.FIRMA_ENVIO).toBe('firma_envio');
      expect(TEMPLATE_NAMES.FIRMA_RECORDATORIO).toBe('firma_recordatorio');
      expect(TEMPLATE_NAMES.FIRMA_CONFIRMACION).toBe('firma_confirmacion');
      expect(TEMPLATE_NAMES.FIRMA_ANULACION).toBe('firma_anulacion');
    });

    test('cada template name debe tener un template definido en TEMPLATES', () => {
      Object.values(TEMPLATE_NAMES).forEach((name) => {
        expect(TEMPLATES[name]).toBeDefined();
        expect(TEMPLATES[name].name).toBe(name);
        expect(TEMPLATES[name].language).toBe('es_MX');
      });
    });
  });

  // ===========================================================
  // buildTemplatePayload - firma_envio
  // ===========================================================
  describe('buildTemplatePayload - firma_envio', () => {
    test('debe construir payload correcto con parametros body y URL', () => {
      const payload = buildTemplatePayload('firma_envio', {
        clienteNombre: 'Juan Perez',
        tipoDocumento: 'Contrato',
        documentoNombre: 'Contrato de Servicio',
        signingUrl: 'https://demo.docusign.net/signing/xxx',
      });

      expect(payload.name).toBe('firma_envio');
      expect(payload.language).toEqual({ code: 'es_MX' });
      expect(payload.components).toHaveLength(2); // body + url button

      // Body parameters
      const body = payload.components.find((c) => c.type === 'body');
      expect(body).toBeDefined();
      expect(body.parameters).toHaveLength(3);
      expect(body.parameters[0].text).toBe('Juan Perez');
      expect(body.parameters[1].text).toBe('Contrato');
      expect(body.parameters[2].text).toBe('Contrato de Servicio');

      // URL button
      const button = payload.components.find((c) => c.type === 'button');
      expect(button).toBeDefined();
      expect(button.sub_type).toBe('url');
      expect(button.index).toBe(0);
      expect(button.parameters[0].text).toBe('https://demo.docusign.net/signing/xxx');
    });
  });

  // ===========================================================
  // buildTemplatePayload - firma_recordatorio
  // ===========================================================
  describe('buildTemplatePayload - firma_recordatorio', () => {
    test('debe construir payload con 4 parametros body', () => {
      const payload = buildTemplatePayload('firma_recordatorio', {
        clienteNombre: 'Maria Lopez',
        tipoDocumento: 'Adendum',
        documentoNombre: 'Adendum Contrato XYZ',
        diasPendientes: '5',
        signingUrl: 'https://demo.docusign.net/signing/yyy',
      });

      expect(payload.name).toBe('firma_recordatorio');

      const body = payload.components.find((c) => c.type === 'body');
      expect(body.parameters).toHaveLength(4);
      expect(body.parameters[0].text).toBe('Maria Lopez');
      expect(body.parameters[1].text).toBe('Adendum');
      expect(body.parameters[2].text).toBe('Adendum Contrato XYZ');
      expect(body.parameters[3].text).toBe('5');
    });
  });

  // ===========================================================
  // buildTemplatePayload - firma_confirmacion
  // ===========================================================
  describe('buildTemplatePayload - firma_confirmacion', () => {
    test('debe construir payload solo con parametros body (sin boton)', () => {
      const payload = buildTemplatePayload('firma_confirmacion', {
        clienteNombre: 'Pedro Garcia',
        tipoDocumento: 'Pagare',
        documentoNombre: 'Pagare No. 001',
      });

      expect(payload.name).toBe('firma_confirmacion');

      const body = payload.components.find((c) => c.type === 'body');
      expect(body.parameters).toHaveLength(3);

      // Sin boton URL
      const button = payload.components.find((c) => c.type === 'button');
      expect(button).toBeUndefined();
    });
  });

  // ===========================================================
  // buildTemplatePayload - firma_anulacion
  // ===========================================================
  describe('buildTemplatePayload - firma_anulacion', () => {
    test('debe construir payload solo con parametros body (sin boton)', () => {
      const payload = buildTemplatePayload('firma_anulacion', {
        clienteNombre: 'Ana Martinez',
        tipoDocumento: 'Contrato',
        documentoNombre: 'Contrato Cancelado',
      });

      expect(payload.name).toBe('firma_anulacion');

      const body = payload.components.find((c) => c.type === 'body');
      expect(body.parameters).toHaveLength(3);
      expect(body.parameters[0].text).toBe('Ana Martinez');
    });
  });

  // ===========================================================
  // ERROR HANDLING
  // ===========================================================
  describe('Error handling', () => {
    test('debe lanzar error para template inexistente', () => {
      expect(() => {
        buildTemplatePayload('template_que_no_existe', {});
      }).toThrow("Template 'template_que_no_existe' no encontrado");
    });

    test('debe manejar parametros faltantes con string vacio', () => {
      const payload = buildTemplatePayload('firma_envio', {
        clienteNombre: 'Test',
        // tipoDocumento y documentoNombre faltan
      });

      const body = payload.components.find((c) => c.type === 'body');
      // Parametros faltantes se convierten a string vacio
      expect(body.parameters[1].text).toBe('');
      expect(body.parameters[2].text).toBe('');
    });

    test('todos los parametros deben ser tipo text', () => {
      const payload = buildTemplatePayload('firma_envio', {
        clienteNombre: 'Test',
        tipoDocumento: 'Contrato',
        documentoNombre: 'Doc',
        signingUrl: 'https://test.com',
      });

      payload.components.forEach((comp) => {
        if (comp.parameters) {
          comp.parameters.forEach((param) => {
            expect(param.type).toBe('text');
          });
        }
      });
    });
  });
});
