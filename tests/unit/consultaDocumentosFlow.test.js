/**
 * Unit Test: Consulta Documentos Flow
 * Verifica handlers de consulta y seleccion de documentos
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

const {
  handleConsultaIniciada,
  handleSeleccionDocumento,
  handleDetalleDocumento,
} = require('../../bot/flows/consultaDocumentosFlow');
const db = require('../../core/services/storage/databaseService');
const { createSession, createConsultaDocumentosSession } = require('../factories/sessionFactory');
const { createDocumentoEnviado, createDocumentoFirmado } = require('../factories/documentoFactory');

describe('Consulta Documentos Flow', () => {
  let mockCtx;

  beforeEach(() => {
    jest.clearAllMocks();
    db.__reset();

    mockCtx = {
      from: '+5215512345678',
      getDatos: jest.fn().mockReturnValue({ documentos: [] }),
      cambiarEstado: jest.fn().mockResolvedValue(undefined),
      responder: jest.fn().mockResolvedValue(undefined),
      finalizar: jest.fn().mockResolvedValue(undefined),
      log: jest.fn(),
      registrarError: jest.fn(),
    };
  });

  // ===========================================================
  // handleConsultaIniciada
  // ===========================================================
  describe('handleConsultaIniciada()', () => {
    test('debe mostrar lista de documentos cuando existen', async () => {
      const docs = [
        createDocumentoEnviado({
          ClienteTelefono: '+5215512345678',
          DocumentoNombre: 'Contrato A',
        }),
        createDocumentoFirmado({
          ClienteTelefono: '+5215512345678',
          DocumentoNombre: 'Contrato B',
        }),
      ];
      db.getDocumentosFirmaPorTelefono.mockResolvedValue(docs);
      const session = createSession();

      await handleConsultaIniciada(mockCtx, null, session);

      expect(mockCtx.responder).toHaveBeenCalled();
      const respuesta = mockCtx.responder.mock.calls[0][0];
      expect(respuesta).toContain('Contrato A');
      expect(respuesta).toContain('Contrato B');
    });

    test('debe cambiar a CONSULTA_DOCUMENTOS con lista en DatosTemp', async () => {
      const docs = [
        createDocumentoEnviado({ ClienteTelefono: '+5215512345678', DocumentoNombre: 'Doc 1' }),
      ];
      db.getDocumentosFirmaPorTelefono.mockResolvedValue(docs);
      const session = createSession();

      await handleConsultaIniciada(mockCtx, null, session);

      expect(mockCtx.cambiarEstado).toHaveBeenCalledWith(
        'CONSULTA_DOCUMENTOS',
        expect.objectContaining({
          documentos: expect.arrayContaining([
            expect.objectContaining({ DocumentoNombre: 'Doc 1' }),
          ]),
        })
      );
    });

    test('debe mostrar mensaje SIN_DOCUMENTOS cuando no hay documentos', async () => {
      db.getDocumentosFirmaPorTelefono.mockResolvedValue([]);
      const session = createSession();

      await handleConsultaIniciada(mockCtx, null, session);

      expect(mockCtx.responder).toHaveBeenCalledWith(
        expect.stringContaining('No tienes documentos')
      );
      expect(mockCtx.finalizar).toHaveBeenCalled();
    });

    test('debe mostrar mensaje SIN_DOCUMENTOS cuando resultado es null', async () => {
      db.getDocumentosFirmaPorTelefono.mockResolvedValue(null);
      const session = createSession();

      await handleConsultaIniciada(mockCtx, null, session);

      expect(mockCtx.responder).toHaveBeenCalledWith(
        expect.stringContaining('No tienes documentos')
      );
    });

    test('debe manejar error de BD mostrando mensaje generico', async () => {
      db.getDocumentosFirmaPorTelefono.mockRejectedValue(new Error('DB error'));
      const session = createSession();

      await handleConsultaIniciada(mockCtx, null, session);

      expect(mockCtx.registrarError).toHaveBeenCalled();
      expect(mockCtx.responder).toHaveBeenCalledWith(expect.stringContaining('error'));
      expect(mockCtx.finalizar).toHaveBeenCalled();
    });
  });

  // ===========================================================
  // handleSeleccionDocumento
  // ===========================================================
  describe('handleSeleccionDocumento()', () => {
    const docsList = [
      {
        DocumentoFirmaId: 1,
        DocumentoNombre: 'Contrato A',
        TipoDocumento: 'CONTRATO',
        EstadoDocumento: 'ENVIADO',
        FechaCreacion: new Date(),
        SigningUrl: 'https://demo.docusign.net/signing/test',
        SapDocumentId: 'SAP-001',
      },
      {
        DocumentoFirmaId: 2,
        DocumentoNombre: 'Pagare B',
        TipoDocumento: 'PAGARE',
        EstadoDocumento: 'FIRMADO',
        FechaCreacion: new Date(),
        SigningUrl: null,
        SapDocumentId: 'SAP-002',
      },
    ];

    beforeEach(() => {
      mockCtx.getDatos.mockReturnValue({ documentos: docsList });
    });

    test('debe mostrar detalle del documento seleccionado por numero', async () => {
      const session = createConsultaDocumentosSession();

      await handleSeleccionDocumento(mockCtx, '1', session);

      expect(mockCtx.responder).toHaveBeenCalled();
      const respuesta = mockCtx.responder.mock.calls[0][0];
      expect(respuesta).toContain('Contrato A');
    });

    test('debe cambiar a CONSULTA_DETALLE con indice del documento', async () => {
      const session = createConsultaDocumentosSession();

      await handleSeleccionDocumento(mockCtx, '2', session);

      expect(mockCtx.cambiarEstado).toHaveBeenCalledWith(
        'CONSULTA_DETALLE',
        expect.objectContaining({
          documentoSeleccionado: 1,
        })
      );
    });

    test('debe rechazar numero fuera de rango', async () => {
      const session = createConsultaDocumentosSession();

      await handleSeleccionDocumento(mockCtx, '5', session);

      expect(mockCtx.responder).toHaveBeenCalledWith(expect.stringContaining('No encontre'));
    });

    test('debe rechazar numero 0', async () => {
      const session = createConsultaDocumentosSession();

      await handleSeleccionDocumento(mockCtx, '0', session);

      expect(mockCtx.responder).toHaveBeenCalledWith(expect.stringContaining('No encontre'));
    });

    test('debe rechazar texto no numerico', async () => {
      const session = createConsultaDocumentosSession();

      await handleSeleccionDocumento(mockCtx, 'abc', session);

      expect(mockCtx.responder).toHaveBeenCalledWith(expect.stringContaining('No encontre'));
    });

    test('debe volver a listar documentos con "volver"', async () => {
      db.getDocumentosFirmaPorTelefono.mockResolvedValue([
        createDocumentoEnviado({ ClienteTelefono: '+5215512345678' }),
      ]);
      const session = createConsultaDocumentosSession();

      await handleSeleccionDocumento(mockCtx, 'volver', session);

      // Re-lista documentos (llama handleConsultaIniciada internamente)
      expect(db.getDocumentosFirmaPorTelefono).toHaveBeenCalled();
    });

    test('debe manejar lista de documentos vacia', async () => {
      mockCtx.getDatos.mockReturnValue({ documentos: [] });
      const session = createConsultaDocumentosSession();

      await handleSeleccionDocumento(mockCtx, '1', session);

      expect(mockCtx.responder).toHaveBeenCalledWith(
        expect.stringContaining('No tienes documentos')
      );
    });
  });

  // ===========================================================
  // handleDetalleDocumento
  // ===========================================================
  describe('handleDetalleDocumento()', () => {
    const docsList = [
      {
        DocumentoFirmaId: 1,
        DocumentoNombre: 'Contrato A',
        TipoDocumento: 'CONTRATO',
        EstadoDocumento: 'ENVIADO',
        FechaCreacion: new Date(),
        SigningUrl: 'https://demo.docusign.net/signing/test',
        SapDocumentId: 'SAP-001',
      },
    ];

    beforeEach(() => {
      mockCtx.getDatos.mockReturnValue({
        documentos: docsList,
        documentoSeleccionado: 0,
      });
    });

    test('debe volver a lista con "volver"', async () => {
      db.getDocumentosFirmaPorTelefono.mockResolvedValue([
        createDocumentoEnviado({ ClienteTelefono: '+5215512345678' }),
      ]);
      const session = createConsultaDocumentosSession();

      await handleDetalleDocumento(mockCtx, 'volver', session);

      expect(db.getDocumentosFirmaPorTelefono).toHaveBeenCalled();
    });

    test('debe aceptar "atras" como variante de volver', async () => {
      db.getDocumentosFirmaPorTelefono.mockResolvedValue([
        createDocumentoEnviado({ ClienteTelefono: '+5215512345678' }),
      ]);
      const session = createConsultaDocumentosSession();

      await handleDetalleDocumento(mockCtx, 'atras', session);

      expect(db.getDocumentosFirmaPorTelefono).toHaveBeenCalled();
    });

    test('debe navegar a otro documento por numero', async () => {
      mockCtx.getDatos.mockReturnValue({
        documentos: [
          docsList[0],
          {
            DocumentoFirmaId: 2,
            DocumentoNombre: 'Pagare B',
            TipoDocumento: 'PAGARE',
            EstadoDocumento: 'FIRMADO',
            FechaCreacion: new Date(),
            SapDocumentId: 'SAP-002',
          },
        ],
        documentoSeleccionado: 0,
      });
      const session = createConsultaDocumentosSession();

      await handleDetalleDocumento(mockCtx, '2', session);

      // Delega a handleSeleccionDocumento
      expect(mockCtx.responder).toHaveBeenCalled();
    });

    test('debe dar indicaciones para texto no reconocido', async () => {
      const session = createConsultaDocumentosSession();

      await handleDetalleDocumento(mockCtx, 'algo random', session);

      expect(mockCtx.responder).toHaveBeenCalledWith(expect.stringContaining('numero'));
    });
  });
});
