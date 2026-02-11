/**
 * Unit Test: Firma Flow
 * Verifica handlers de rechazo de documentos
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
jest.mock('../../core/services/external/teamsService', () => ({
  notifyDocumentRejected: jest.fn().mockResolvedValue(undefined),
}));

const { handleRechazoIniciado, handleMotivoRechazo } = require('../../bot/flows/firmaFlow');
const db = require('../../core/services/storage/databaseService');
const teamsService = require('../../core/services/external/teamsService');
const {
  createSession,
  createEsperandoConfirmacionSession,
} = require('../factories/sessionFactory');

describe('Firma Flow', () => {
  let mockCtx;

  beforeEach(() => {
    jest.clearAllMocks();
    db.__reset();

    // Mock del contexto de flujo (StaticFlowContext)
    mockCtx = {
      from: '+5215512345678',
      getDatos: jest.fn().mockReturnValue({
        documentoFirmaId: 42,
        documentoNombre: 'Contrato Test',
      }),
      cambiarEstado: jest.fn().mockResolvedValue(undefined),
      responder: jest.fn().mockResolvedValue(undefined),
      finalizar: jest.fn().mockResolvedValue(undefined),
      log: jest.fn(),
      registrarError: jest.fn(),
    };
  });

  // ===========================================================
  // handleRechazoIniciado
  // ===========================================================
  describe('handleRechazoIniciado()', () => {
    test('debe solicitar motivo de rechazo', async () => {
      const session = createSession();
      await handleRechazoIniciado(mockCtx, session);

      expect(mockCtx.responder).toHaveBeenCalledWith(expect.stringContaining('motivo'));
    });

    test('debe cambiar sesion a ESPERANDO_CONFIRMACION', async () => {
      const session = createSession();
      await handleRechazoIniciado(mockCtx, session);

      expect(mockCtx.cambiarEstado).toHaveBeenCalledWith(
        'ESPERANDO_CONFIRMACION',
        expect.objectContaining({
          documentoFirmaId: 42,
          accion: 'RECHAZO',
        })
      );
    });

    test('debe preservar documentoNombre en DatosTemp', async () => {
      const session = createSession();
      await handleRechazoIniciado(mockCtx, session);

      const datosGuardados = mockCtx.cambiarEstado.mock.calls[0][1];
      expect(datosGuardados.documentoNombre).toBe('Contrato Test');
    });

    test('debe manejar datos sin documentoFirmaId', async () => {
      mockCtx.getDatos.mockReturnValue({});
      const session = createSession();
      await handleRechazoIniciado(mockCtx, session);

      expect(mockCtx.cambiarEstado).toHaveBeenCalledWith(
        'ESPERANDO_CONFIRMACION',
        expect.objectContaining({
          documentoFirmaId: null,
          accion: 'RECHAZO',
        })
      );
    });
  });

  // ===========================================================
  // handleMotivoRechazo
  // ===========================================================
  describe('handleMotivoRechazo()', () => {
    test('debe registrar rechazo con motivo', async () => {
      const session = createEsperandoConfirmacionSession();

      await handleMotivoRechazo(mockCtx, 'No estoy de acuerdo con los terminos', session);

      expect(db.updateDocumentoFirmaEstado).toHaveBeenCalledWith(
        42,
        'RECHAZADO',
        'No estoy de acuerdo con los terminos'
      );
    });

    test('debe enviar confirmacion de rechazo al usuario', async () => {
      const session = createEsperandoConfirmacionSession();

      await handleMotivoRechazo(mockCtx, 'Motivo de prueba', session);

      expect(mockCtx.responder).toHaveBeenCalledWith(expect.stringContaining('Contrato Test'));
    });

    test('debe notificar a Teams del rechazo', async () => {
      const session = createEsperandoConfirmacionSession();

      await handleMotivoRechazo(mockCtx, 'Motivo de prueba', session);

      expect(teamsService.notifyDocumentRejected).toHaveBeenCalledWith(
        '+5215512345678',
        'Contrato Test',
        'Motivo de prueba'
      );
    });

    test('debe finalizar la sesion despues del rechazo', async () => {
      const session = createEsperandoConfirmacionSession();

      await handleMotivoRechazo(mockCtx, 'Motivo', session);

      expect(mockCtx.finalizar).toHaveBeenCalledWith(expect.stringMatching(/rechazo/i));
    });

    test('debe continuar el flujo si falla la actualizacion de documento', async () => {
      db.updateDocumentoFirmaEstado.mockRejectedValue(new Error('DB error'));
      const session = createEsperandoConfirmacionSession();

      await handleMotivoRechazo(mockCtx, 'Motivo', session);

      // Registra error pero continua
      expect(mockCtx.registrarError).toHaveBeenCalled();
      // Aun asi envia confirmacion al usuario
      expect(mockCtx.responder).toHaveBeenCalled();
      expect(mockCtx.finalizar).toHaveBeenCalled();
    });

    test('no debe llamar updateDocumentoFirmaEstado si no hay documentoFirmaId', async () => {
      mockCtx.getDatos.mockReturnValue({
        documentoFirmaId: null,
        documentoNombre: 'Sin ID',
      });
      const session = createEsperandoConfirmacionSession();

      await handleMotivoRechazo(mockCtx, 'Motivo', session);

      expect(db.updateDocumentoFirmaEstado).not.toHaveBeenCalled();
      // Aun asi se responde al usuario
      expect(mockCtx.responder).toHaveBeenCalled();
    });
  });
});
