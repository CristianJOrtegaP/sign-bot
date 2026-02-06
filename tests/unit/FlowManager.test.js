/**
 * Unit Test: FlowManager
 * Orquestador central de flujos de conversación
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
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), ai: jest.fn() },
}));

// Mock flows
jest.mock('../../bot/flows/reporteFlow', () => ({
  iniciarFlujo: jest.fn().mockResolvedValue(undefined),
  procesarMensaje: jest.fn().mockResolvedValue(true),
  procesarBoton: jest.fn().mockResolvedValue(true),
  procesarImagen: jest.fn().mockResolvedValue(true),
  procesarUbicacion: jest.fn().mockResolvedValue(true),
  esEstadoFlexible: jest.fn(() => true),
}));
jest.mock('../../bot/flows/encuestaFlow', () => ({
  handleInvitacion: jest.fn().mockResolvedValue(undefined),
  handleRespuestaPregunta: jest.fn().mockResolvedValue(undefined),
  handleComentarioDecision: jest.fn().mockResolvedValue(undefined),
  handleComentario: jest.fn().mockResolvedValue(undefined),
  handleBotonAceptar: jest.fn().mockResolvedValue(undefined),
  handleBotonSalir: jest.fn().mockResolvedValue(undefined),
  handleBotonRating: jest.fn().mockResolvedValue(undefined),
  handleBotonSiComentario: jest.fn().mockResolvedValue(undefined),
  handleBotonNoComentario: jest.fn().mockResolvedValue(undefined),
  iniciarEncuesta: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/flows/consultaFlow', () => ({
  handleTicketInput: jest.fn().mockResolvedValue(undefined),
  iniciarFlujo: jest.fn().mockResolvedValue(undefined),
  consultarTicketDirecto: jest.fn().mockResolvedValue(undefined),
}));
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
  iniciarFlujoConDatos,
  getTipoReportePorEstado,
} = require('../../bot/controllers/flows/FlowManager');
const flexibleFlowManager = require('../../bot/flows/reporteFlow');
const consultaFlow = require('../../bot/flows/consultaFlow');
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
    test('debe retornar false para estados flexibles (delega a messageHandler)', async () => {
      const session = createSession({ Estado: 'REFRIGERADOR_ACTIVO' });

      const result = await processSessionState('+52155', 'texto', session, context);

      expect(result).toBe(false);
      expect(registry.procesarMensaje).not.toHaveBeenCalled();
    });

    test('debe usar FlowEngine para estados migrados', async () => {
      registry.tieneHandlerParaEstado.mockReturnValue(true);
      registry.procesarMensaje.mockResolvedValue(true);
      const session = createSession({ Estado: 'ENCUESTA_PREGUNTA_1' });

      const result = await processSessionState('+52155', 'texto', session, context);

      expect(result).toBe(true);
      expect(registry.procesarMensaje).toHaveBeenCalledWith('+52155', 'texto', session, context);
    });

    test('debe retornar false si no hay handler para el estado', async () => {
      const session = createSession({ Estado: 'ESTADO_DESCONOCIDO' });

      const result = await processSessionState('+52155', 'texto', session, context);

      expect(result).toBe(false);
    });

    test('debe propagar errores del FlowEngine', async () => {
      registry.tieneHandlerParaEstado.mockReturnValue(true);
      registry.procesarMensaje.mockRejectedValue(new Error('FlowEngine error'));
      const session = createSession({ Estado: 'ENCUESTA_PREGUNTA_1' });

      await expect(processSessionState('+52155', 'texto', session, context)).rejects.toThrow(
        'FlowEngine error'
      );
    });
  });

  // ===========================================================
  // PROCESS BUTTON
  // ===========================================================
  describe('processButton()', () => {
    test('debe usar FlowEngine para botones migrados', async () => {
      registry.obtenerHandlerBoton.mockReturnValue({ flujo: 'ENCUESTA', handler: 'test' });
      registry.procesarBoton.mockResolvedValue(true);
      const session = createSession({ Estado: 'ENCUESTA_PREGUNTA_1' });

      const result = await processButton('+52155', 'btn_enc', session, context);

      expect(result).toBe(true);
      expect(registry.procesarBoton).toHaveBeenCalledWith('+52155', 'btn_enc', session, context);
    });

    test('debe ejecutar cancelarFlujo para btn_cancelar', async () => {
      const session = createSession({ Estado: 'REFRIGERADOR_ACTIVO', Version: 2 });
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

    test('debe iniciar flujo flexible para btn_tipo_refrigerador', async () => {
      const session = createSession({ Estado: 'INICIO' });

      const result = await processButton('+52155', 'btn_tipo_refrigerador', session, context);

      expect(result).toBe(true);
      expect(flexibleFlowManager.iniciarFlujo).toHaveBeenCalledWith(
        '+52155',
        'REFRIGERADOR',
        {},
        context
      );
    });

    test('debe iniciar flujo flexible para btn_tipo_vehiculo', async () => {
      const session = createSession({ Estado: 'INICIO' });

      const result = await processButton('+52155', 'btn_tipo_vehiculo', session, context);

      expect(result).toBe(true);
      expect(flexibleFlowManager.iniciarFlujo).toHaveBeenCalledWith(
        '+52155',
        'VEHICULO',
        {},
        context
      );
    });

    test('debe delegar btn_confirmar_datos a flexibleFlowManager', async () => {
      const session = createSession({ Estado: 'REFRIGERADOR_ACTIVO' });

      await processButton('+52155', 'btn_confirmar_datos', session, context);

      expect(flexibleFlowManager.procesarBoton).toHaveBeenCalledWith(
        '+52155',
        'btn_confirmar_datos',
        session,
        context
      );
    });

    test('debe iniciar flujo de consulta para btn_consultar_ticket', async () => {
      const session = createSession({ Estado: 'INICIO' });

      const result = await processButton('+52155', 'btn_consultar_ticket', session, context);

      expect(result).toBe(true);
      expect(consultaFlow.iniciarFlujo).toHaveBeenCalledWith('+52155', context);
    });

    test('debe retornar false para botón no registrado ni en FlowEngine', async () => {
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
      const session = createSession({ Estado: 'REFRIGERADOR_ACTIVO', Version: 5 });
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

      // Mensaje de cancelación enviado de todas formas
      expect(whatsapp.sendText).toHaveBeenCalled();
    });

    test('debe propagar errores que no son ConcurrencyError', async () => {
      db.getSessionFresh.mockResolvedValue(createSession({ Version: 5 }));
      db.updateSession.mockRejectedValue(new Error('DB down'));

      await expect(cancelarFlujo('+52155', context)).rejects.toThrow('DB down');
    });
  });

  // ===========================================================
  // INICIAR FLUJO CON DATOS
  // ===========================================================
  describe('iniciarFlujoConDatos()', () => {
    test('debe convertir datos extraídos a formato de campos', async () => {
      const datosExtraidos = {
        codigo_sap: '1234567',
        problema: 'No enfría',
        numero_empleado: 'EMP001',
        ubicacion: 'Monterrey',
      };

      await iniciarFlujoConDatos('+52155', 'REFRIGERADOR', datosExtraidos, true, context);

      expect(flexibleFlowManager.iniciarFlujo).toHaveBeenCalledWith(
        '+52155',
        'REFRIGERADOR',
        expect.objectContaining({
          codigoSAP: expect.objectContaining({ valor: '1234567', fuente: 'ai', confianza: 80 }),
          problema: expect.objectContaining({ valor: 'No enfría', fuente: 'ai', confianza: 70 }),
          numeroEmpleado: expect.objectContaining({ valor: 'EMP001', fuente: 'ai', confianza: 80 }),
          ubicacion: expect.objectContaining({ valor: 'Monterrey', fuente: 'ai', confianza: 80 }),
        }),
        context
      );
    });

    test('debe omitir campos null en datos extraídos', async () => {
      const datosExtraidos = { problema: 'No enfría', codigo_sap: null };

      await iniciarFlujoConDatos('+52155', 'REFRIGERADOR', datosExtraidos, true, context);

      const camposEnviados = flexibleFlowManager.iniciarFlujo.mock.calls[0][2];
      expect(camposEnviados.codigoSAP).toBeUndefined();
      expect(camposEnviados.problema).toBeDefined();
    });
  });

  // ===========================================================
  // GET TIPO REPORTE POR ESTADO
  // ===========================================================
  describe('getTipoReportePorEstado()', () => {
    test('debe retornar REFRIGERADOR para REFRIGERADOR_ACTIVO', () => {
      expect(getTipoReportePorEstado('REFRIGERADOR_ACTIVO')).toBe('REFRIGERADOR');
    });

    test('debe retornar VEHICULO para VEHICULO_ACTIVO', () => {
      expect(getTipoReportePorEstado('VEHICULO_ACTIVO')).toBe('VEHICULO');
    });

    test('debe retornar null para estados no relacionados a reportes', () => {
      expect(getTipoReportePorEstado('INICIO')).toBeNull();
    });
  });
});
