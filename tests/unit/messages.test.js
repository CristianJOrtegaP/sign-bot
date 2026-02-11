/**
 * Unit Test: Messages
 * Verifica templates de mensajes para firma y consulta de documentos
 */

const { FIRMA, CONSULTA_DOCS, GENERAL, ERRORES } = require('../../bot/constants/messages');
const {
  createDocumentoEnviado,
  createDocumentoFirmado,
  createDocumentoRechazado,
} = require('../factories/documentoFactory');

describe('Messages - Templates de Firma', () => {
  // ===========================================================
  // FIRMA.NUEVO_DOCUMENTO
  // ===========================================================
  describe('FIRMA.NUEVO_DOCUMENTO', () => {
    test('debe generar mensaje con nombre, tipo y documento', () => {
      const msg = FIRMA.NUEVO_DOCUMENTO('Juan Perez', 'Contrato', 'Contrato de Servicio 2025');
      expect(msg).toContain('Juan Perez');
      expect(msg).toContain('Contrato');
      expect(msg).toContain('Contrato de Servicio 2025');
    });
  });

  // ===========================================================
  // FIRMA.RECORDATORIO
  // ===========================================================
  describe('FIRMA.RECORDATORIO', () => {
    test('debe generar mensaje con dias pendientes', () => {
      const msg = FIRMA.RECORDATORIO('Maria Lopez', 'Adendum', 'Adendum XYZ', 5);
      expect(msg).toContain('Maria Lopez');
      expect(msg).toContain('Adendum');
      expect(msg).toContain('Adendum XYZ');
      expect(msg).toContain('5 dias');
    });
  });

  // ===========================================================
  // FIRMA.FIRMA_EXITOSA
  // ===========================================================
  describe('FIRMA.FIRMA_EXITOSA', () => {
    test('debe generar mensaje de confirmacion de firma', () => {
      const msg = FIRMA.FIRMA_EXITOSA('Pedro Garcia', 'Pagare', 'Pagare 001');
      expect(msg).toContain('Pedro Garcia');
      expect(msg).toContain('firmado exitosamente');
      expect(msg).toContain('Pagare 001');
    });
  });

  // ===========================================================
  // FIRMA.DOCUMENTO_ANULADO
  // ===========================================================
  describe('FIRMA.DOCUMENTO_ANULADO', () => {
    test('debe generar mensaje de anulacion', () => {
      const msg = FIRMA.DOCUMENTO_ANULADO('Ana Martinez', 'Contrato', 'Contrato Anulado');
      expect(msg).toContain('Ana Martinez');
      expect(msg).toContain('anulado');
      expect(msg).toContain('Contrato Anulado');
    });
  });

  // ===========================================================
  // FIRMA.RECHAZO_REGISTRADO
  // ===========================================================
  describe('FIRMA.RECHAZO_REGISTRADO', () => {
    test('debe generar mensaje de confirmacion de rechazo', () => {
      const msg = FIRMA.RECHAZO_REGISTRADO('Mi Contrato');
      expect(msg).toContain('Mi Contrato');
      expect(msg).toContain('rechazo');
    });
  });

  // ===========================================================
  // FIRMA.DOCUMENTO_CORREGIDO
  // ===========================================================
  describe('FIRMA.DOCUMENTO_CORREGIDO', () => {
    test('debe generar mensaje de documento actualizado', () => {
      const msg = FIRMA.DOCUMENTO_CORREGIDO('Luis Hernandez', 'Contrato', 'Contrato V2');
      expect(msg).toContain('Luis Hernandez');
      expect(msg).toContain('actualizado');
      expect(msg).toContain('Contrato V2');
    });
  });

  // ===========================================================
  // FIRMA - Mensajes estaticos
  // ===========================================================
  describe('FIRMA - Mensajes estaticos', () => {
    test('SOLICITAR_MOTIVO_RECHAZO debe ser un string', () => {
      expect(typeof FIRMA.SOLICITAR_MOTIVO_RECHAZO).toBe('string');
      expect(FIRMA.SOLICITAR_MOTIVO_RECHAZO).toContain('motivo');
    });

    test('DOCUMENTO_RECIBIDO_API debe ser un string', () => {
      expect(typeof FIRMA.DOCUMENTO_RECIBIDO_API).toBe('string');
    });

    test('ERROR_PROCESANDO debe ser un string', () => {
      expect(typeof FIRMA.ERROR_PROCESANDO).toBe('string');
    });
  });
});

describe('Messages - Consulta de Documentos', () => {
  // ===========================================================
  // CONSULTA_DOCS.listaDocumentos
  // ===========================================================
  describe('CONSULTA_DOCS.listaDocumentos', () => {
    test('debe generar lista numerada de documentos', () => {
      const docs = [
        createDocumentoEnviado({ DocumentoNombre: 'Contrato A' }),
        createDocumentoFirmado({ DocumentoNombre: 'Contrato B' }),
      ];

      const msg = CONSULTA_DOCS.listaDocumentos(docs);
      expect(msg).toContain('1.');
      expect(msg).toContain('2.');
      expect(msg).toContain('Contrato A');
      expect(msg).toContain('Contrato B');
      expect(msg).toContain('numero');
    });

    test('debe mostrar tipo de documento', () => {
      const docs = [createDocumentoEnviado({ TipoDocumento: 'PAGARE' })];
      const msg = CONSULTA_DOCS.listaDocumentos(docs);
      expect(msg).toContain('PAGARE');
    });

    test('debe usar SapDocumentId como fallback si no hay nombre', () => {
      const docs = [
        createDocumentoEnviado({ DocumentoNombre: null, SapDocumentId: 'SAP-FALLBACK' }),
      ];
      const msg = CONSULTA_DOCS.listaDocumentos(docs);
      expect(msg).toContain('SAP-FALLBACK');
    });
  });

  // ===========================================================
  // CONSULTA_DOCS.detalleDocumento
  // ===========================================================
  describe('CONSULTA_DOCS.detalleDocumento', () => {
    test('debe mostrar detalle completo del documento', () => {
      const doc = createDocumentoEnviado({ DocumentoNombre: 'Contrato Test' });
      const msg = CONSULTA_DOCS.detalleDocumento(doc);
      expect(msg).toContain('Contrato Test');
      expect(msg).toContain('Tipo');
      expect(msg).toContain('Estado');
      expect(msg).toContain('Fecha');
    });

    test('debe mostrar motivo de rechazo si existe', () => {
      const doc = createDocumentoRechazado({ MotivoRechazo: 'No estoy de acuerdo' });
      const msg = CONSULTA_DOCS.detalleDocumento(doc);
      expect(msg).toContain('No estoy de acuerdo');
      expect(msg).toContain('rechazo');
    });

    test('debe mostrar indicacion de firma si tiene SigningUrl y no esta firmado', () => {
      const doc = createDocumentoEnviado({
        SigningUrl: 'https://demo.docusign.net/signing/test',
      });
      const msg = CONSULTA_DOCS.detalleDocumento(doc);
      expect(msg).toContain('firma');
    });

    test('no debe mostrar indicacion de firma si esta FIRMADO', () => {
      const doc = createDocumentoFirmado({
        SigningUrl: 'https://demo.docusign.net/signing/test',
      });
      const msg = CONSULTA_DOCS.detalleDocumento(doc);
      expect(msg).not.toContain('enlace que te enviamos anteriormente');
    });
  });

  // ===========================================================
  // CONSULTA_DOCS - Mensajes estaticos
  // ===========================================================
  describe('CONSULTA_DOCS - Mensajes estaticos', () => {
    test('SIN_DOCUMENTOS debe informar que no hay documentos', () => {
      expect(CONSULTA_DOCS.SIN_DOCUMENTOS).toContain('No tienes documentos');
    });

    test('DOCUMENTO_NO_ENCONTRADO debe pedir verificar numero', () => {
      expect(CONSULTA_DOCS.DOCUMENTO_NO_ENCONTRADO).toContain('numero');
    });
  });
});

describe('Messages - Generales y Errores', () => {
  test('GENERAL.WELCOME debe contener Sign Bot', () => {
    expect(GENERAL.WELCOME).toContain('Sign Bot');
  });

  test('ERRORES.GENERICO debe ser un string', () => {
    expect(typeof ERRORES.GENERICO).toBe('string');
  });

  test('ERRORES.NO_ENTIENDO debe sugerir mis documentos', () => {
    expect(ERRORES.NO_ENTIENDO).toContain('mis documentos');
  });
});
