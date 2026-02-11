/**
 * Unit Test: FlowManager
 * Orquestador central de flujos de conversacion - Sign Bot
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

// Mock flows
jest.mock('../../bot/flows', () => ({
  registry: {
    tieneHandlerParaEstado: jest.fn(() => false),
    procesarMensaje: jest.fn().mockResolvedValue(false),
    procesarBoton: jest.fn().mockResolvedValue(false),
    obtenerHandlerBoton: jest.fn(() => null),
  },
  inicializarFlujos: jest.fn(),
}));

const {
  processSessionState,
  processButton,
  cancelarFlujo,
} = require('../../bot/controllers/flows/FlowManager');
const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');
const { registry } = require('../../bot/flows');
const { ConcurrencyError } = require('../../core/errors');
const { createSession } = require('../factories/sessionFactory');

describe('FlowManager', () => {
  let context;

  beforeEach(() => {
    context = global.createMockContext();
    jest.clearAllMocks();
    registry.tieneHandlerParaEstado.mockReturnValue(false);
    registry.obtenerHandlerBoton.mockReturnValue(null);
  });

  // ===========================================================
  // PROCESS SESSION STATE
  // ===========================================================
  describe('processSessionState()', () => {
    test('debe usar FlowEngine para estados registrados (CONSULTA_DOCUMENTOS)', async () => {
      registry.tieneHandlerParaEstado.mockReturnValue(true);
      registry.procesarMensaje.mockResolvedValue(true);
      const session = createSession({ Estado: 'CONSULTA_DOCUMENTOS' });

      const result = await processSessionState('+52155', '1', session, context);

      expect(result).toBe(true);
      expect(registry.procesarMensaje).toHaveBeenCalledWith('+52155', '1', session, context);
    });

    test('debe usar FlowEngine para ESPERANDO_CONFIRMACION', async () => {
      registry.tieneHandlerParaEstado.mockReturnValue(true);
      registry.procesarMensaje.mockResolvedValue(true);
      const session = createSession({ Estado: 'ESPERANDO_CONFIRMACION' });

      const result = await processSessionState('+52155', 'motivo', session, context);

      expect(result).toBe(true);
      expect(registry.procesarMensaje).toHaveBeenCalledWith('+52155', 'motivo', session, context);
    });

    test('debe retornar false para AGENTE_ACTIVO (no procesar)', async () => {
      const session = createSession({ Estado: 'AGENTE_ACTIVO' });

      const result = await processSessionState('+52155', 'texto', session, context);

      expect(result).toBe(false);
      expect(registry.procesarMensaje).not.toHaveBeenCalled();
    });

    test('debe retornar false si no hay handler para el estado', async () => {
      const session = createSession({ Estado: 'ESTADO_DESCONOCIDO' });

      const result = await processSessionState('+52155', 'texto', session, context);

      expect(result).toBe(false);
    });

    test('debe propagar errores del FlowEngine', async () => {
      registry.tieneHandlerParaEstado.mockReturnValue(true);
      registry.procesarMensaje.mockRejectedValue(new Error('FlowEngine error'));
      const session = createSession({ Estado: 'CONSULTA_DOCUMENTOS' });

      await expect(processSessionState('+52155', 'texto', session, context)).rejects.toThrow(
        'FlowEngine error'
      );
    });
  });

  // ===========================================================
  // PROCESS BUTTON
  // ===========================================================
  describe('processButton()', () => {
    test('debe usar FlowEngine para botones registrados (btn_rechazar)', async () => {
      registry.obtenerHandlerBoton.mockReturnValue({
        flujo: 'FIRMA',
        handler: 'handleRechazoIniciado',
      });
      registry.procesarBoton.mockResolvedValue(true);
      const session = createSession({ Estado: 'INICIO' });

      const result = await processButton('+52155', 'btn_rechazar', session, context);

      expect(result).toBe(true);
      expect(registry.procesarBoton).toHaveBeenCalledWith(
        '+52155',
        'btn_rechazar',
        session,
        context
      );
    });

    test('debe usar FlowEngine para btn_ver_documentos', async () => {
      registry.obtenerHandlerBoton.mockReturnValue({
        flujo: 'CONSULTA_DOCUMENTOS',
        handler: 'handleConsultaIniciada',
      });
      registry.procesarBoton.mockResolvedValue(true);
      const session = createSession({ Estado: 'INICIO' });

      const result = await processButton('+52155', 'btn_ver_documentos', session, context);

      expect(result).toBe(true);
      expect(registry.procesarBoton).toHaveBeenCalledWith(
        '+52155',
        'btn_ver_documentos',
        session,
        context
      );
    });

    test('debe ejecutar cancelarFlujo para btn_cancelar', async () => {
      const session = createSession({ Estado: 'CONSULTA_DOCUMENTOS', Version: 2 });
      db.getSessionFresh.mockResolvedValue(session);

      const result = await processButton('+52155', 'btn_cancelar', session, context);

      expect(result).toBe(true);
      expect(db.updateSession).toHaveBeenCalledWith(
        '+52155',
        'CANCELADO',
        null,
        null,
        'USUARIO',
        expect.any(String),
        null,
        2
      );
      expect(whatsapp.sendText).toHaveBeenCalled();
    });

    test('debe retornar false para boton no registrado ni en FlowEngine', async () => {
      const session = createSession({ Estado: 'INICIO' });

      const result = await processButton('+52155', 'btn_inexistente', session, context);

      expect(result).toBe(false);
    });
  });

  // ===========================================================
  // CANCELAR FLUJO
  // ===========================================================
  describe('cancelarFlujo()', () => {
    test('debe cambiar estado a CANCELADO y enviar mensaje', async () => {
      const session = createSession({ Estado: 'CONSULTA_DOCUMENTOS', Version: 5 });
      db.getSessionFresh.mockResolvedValue(session);

      await cancelarFlujo('+52155', context);

      expect(db.updateSession).toHaveBeenCalledWith(
        '+52155',
        'CANCELADO',
        null,
        null,
        'USUARIO',
        expect.stringContaining('cancelado'),
        null,
        5
      );
      expect(whatsapp.sendText).toHaveBeenCalled();
      expect(db.saveMessage).toHaveBeenCalled();
    });

    test('debe manejar ConcurrencyError sin lanzar', async () => {
      const session = createSession({ Version: 5 });
      db.getSessionFresh.mockResolvedValue(session);
      db.updateSession.mockRejectedValue(new ConcurrencyError('Version conflict'));

      // No debe lanzar
      await expect(cancelarFlujo('+52155', context)).resolves.toBeUndefined();

      // Mensaje de cancelacion enviado de todas formas
      expect(whatsapp.sendText).toHaveBeenCalled();
    });

    test('debe propagar errores que no son ConcurrencyError', async () => {
      db.getSessionFresh.mockResolvedValue(createSession({ Version: 5 }));
      db.updateSession.mockRejectedValue(new Error('DB down'));

      await expect(cancelarFlujo('+52155', context)).rejects.toThrow('DB down');
    });
  });
});
