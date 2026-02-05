/**
 * Tests - Flow Manager (FASE 2b)
 * Pruebas del orquestador central de flujos con arquitectura flexible
 */

// Mocks
jest.mock('../../core/services/external/whatsappService', () =>
  require('../__mocks__/whatsappService')
);
jest.mock('../../core/services/storage/databaseService', () =>
  require('../__mocks__/databaseService')
);
jest.mock('../../core/config', () => require('../__mocks__/config'));

jest.mock('../../bot/controllers/flows/flexibleFlowManager', () => ({
  iniciarFlujo: jest.fn().mockResolvedValue(undefined),
  procesarMensaje: jest.fn().mockResolvedValue(true),
  procesarBoton: jest.fn().mockResolvedValue(true),
  procesarUbicacion: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../bot/controllers/flows/encuestaFlow', () => ({
  handleInvitacion: jest.fn().mockResolvedValue(undefined),
  handleRespuestaPregunta: jest.fn().mockResolvedValue(undefined),
  handleComentarioDecision: jest.fn().mockResolvedValue(undefined),
  handleComentario: jest.fn().mockResolvedValue(undefined),
  handleBotonAceptar: jest.fn().mockResolvedValue(undefined),
  handleBotonSalir: jest.fn().mockResolvedValue(undefined),
  handleBotonRating: jest.fn().mockResolvedValue(undefined),
  handleBotonSiComentario: jest.fn().mockResolvedValue(undefined),
  handleBotonNoComentario: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../bot/controllers/flows/consultaEstadoFlow', () => ({
  iniciarFlujo: jest.fn().mockResolvedValue(undefined),
  handleTicketInput: jest.fn().mockResolvedValue(undefined),
}));

const FlowManager = require('../../bot/controllers/flows/FlowManager');
const flexibleFlowManager = require('../../bot/controllers/flows/flexibleFlowManager');
const encuestaFlow = require('../../bot/controllers/flows/encuestaFlow');
const consultaEstadoFlow = require('../../bot/controllers/flows/consultaEstadoFlow');
const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');

describe('FlowManager (FASE 2b)', () => {
  let mockContext;
  const testPhone = '+5215540829614';

  beforeEach(() => {
    jest.clearAllMocks();
    whatsapp.__reset();
    db.__reset();

    mockContext = {
      log: jest.fn(),
      log_error: jest.fn(),
    };
  });

  describe('processSessionState', () => {
    test('debe delegar estados flexibles a flexibleFlowManager', async () => {
      const session = {
        Estado: 'REFRIGERADOR_ACTIVO',
        DatosTemp: JSON.stringify({ tipoReporte: 'REFRIGERADOR' }),
      };

      const result = await FlowManager.processSessionState(
        testPhone,
        '1234567',
        session,
        mockContext
      );

      // Estados flexibles retornan false para que messageHandler los maneje
      expect(result).toBe(false);
    });

    test('debe delegar estado VEHICULO_ACTIVO a flexibleFlowManager', async () => {
      const session = {
        Estado: 'VEHICULO_ACTIVO',
        DatosTemp: JSON.stringify({ tipoReporte: 'VEHICULO' }),
      };

      const result = await FlowManager.processSessionState(
        testPhone,
        'texto',
        session,
        mockContext
      );

      expect(result).toBe(false);
    });

    test('debe procesar estado ENCUESTA_PREGUNTA_1', async () => {
      const session = {
        Estado: 'ENCUESTA_PREGUNTA_1',
        DatosTemp: JSON.stringify({ encuestaId: 1 }),
      };

      const result = await FlowManager.processSessionState(testPhone, '5', session, mockContext);

      expect(result).toBe(true);
      expect(encuestaFlow.handleRespuestaPregunta).toHaveBeenCalled();
    });

    test('debe procesar estado CONSULTA_ESPERA_TICKET', async () => {
      const session = {
        Estado: 'CONSULTA_ESPERA_TICKET',
        DatosTemp: null,
      };

      const result = await FlowManager.processSessionState(
        testPhone,
        'TKT-12345678',
        session,
        mockContext
      );

      expect(result).toBe(true);
      expect(consultaEstadoFlow.handleTicketInput).toHaveBeenCalled();
    });

    test('debe retornar false para estado no registrado', async () => {
      const session = { Estado: 'ESTADO_DESCONOCIDO' };

      const result = await FlowManager.processSessionState(
        testPhone,
        'texto',
        session,
        mockContext
      );

      expect(result).toBe(false);
    });

    test('debe retornar false para estado INICIO', async () => {
      const session = { Estado: 'INICIO' };

      const result = await FlowManager.processSessionState(
        testPhone,
        'texto',
        session,
        mockContext
      );

      expect(result).toBe(false);
    });
  });

  describe('processButton', () => {
    test('debe iniciar flujo flexible para refrigerador', async () => {
      const session = { Estado: 'INICIO' };

      const result = await FlowManager.processButton(
        testPhone,
        'btn_tipo_refrigerador',
        session,
        mockContext
      );

      expect(result).toBe(true);
      expect(flexibleFlowManager.iniciarFlujo).toHaveBeenCalledWith(
        testPhone,
        'REFRIGERADOR',
        {},
        mockContext
      );
    });

    test('debe iniciar flujo flexible para vehículo', async () => {
      const session = { Estado: 'INICIO' };

      const result = await FlowManager.processButton(
        testPhone,
        'btn_tipo_vehiculo',
        session,
        mockContext
      );

      expect(result).toBe(true);
      expect(flexibleFlowManager.iniciarFlujo).toHaveBeenCalledWith(
        testPhone,
        'VEHICULO',
        {},
        mockContext
      );
    });

    test('debe iniciar flujo de consulta', async () => {
      const session = { Estado: 'INICIO' };

      const result = await FlowManager.processButton(
        testPhone,
        'btn_consultar_ticket',
        session,
        mockContext
      );

      expect(result).toBe(true);
      expect(consultaEstadoFlow.iniciarFlujo).toHaveBeenCalled();
    });

    test('debe procesar botón de cancelar', async () => {
      const session = { Estado: 'REFRIGERADOR_ACTIVO' };

      const result = await FlowManager.processButton(
        testPhone,
        'btn_cancelar',
        session,
        mockContext
      );

      expect(result).toBe(true);
      expect(db.updateSession).toHaveBeenCalledWith(
        testPhone,
        'CANCELADO',
        null,
        null,
        'USUARIO',
        expect.any(String)
      );
      expect(whatsapp.sendText).toHaveBeenCalled();
    });

    test('debe procesar botones flexibles (confirmar/modificar)', async () => {
      const session = {
        Estado: 'REFRIGERADOR_ACTIVO',
        DatosTemp: JSON.stringify({ tipoReporte: 'REFRIGERADOR' }),
      };

      const result = await FlowManager.processButton(
        testPhone,
        'btn_confirmar_datos',
        session,
        mockContext
      );

      expect(result).toBe(true);
      expect(flexibleFlowManager.procesarBoton).toHaveBeenCalled();
    });

    test('debe procesar botón de rating de encuesta', async () => {
      const session = {
        Estado: 'ENCUESTA_PREGUNTA_1',
        DatosTemp: JSON.stringify({ encuestaId: 1 }),
      };

      const result = await FlowManager.processButton(
        testPhone,
        'btn_rating_5',
        session,
        mockContext
      );

      expect(result).toBe(true);
      expect(encuestaFlow.handleBotonRating).toHaveBeenCalledWith(
        testPhone,
        5,
        session,
        mockContext
      );
    });

    test('debe procesar botón de aceptar encuesta', async () => {
      const session = {
        Estado: 'ENCUESTA_INVITACION',
        DatosTemp: JSON.stringify({ encuestaId: 1 }),
      };

      const result = await FlowManager.processButton(
        testPhone,
        'btn_encuesta_aceptar',
        session,
        mockContext
      );

      expect(result).toBe(true);
      expect(encuestaFlow.handleBotonAceptar).toHaveBeenCalled();
    });

    test('debe retornar false para botón no registrado', async () => {
      const session = { Estado: 'INICIO' };

      const result = await FlowManager.processButton(
        testPhone,
        'btn_desconocido',
        session,
        mockContext
      );

      expect(result).toBe(false);
    });
  });

  describe('cancelarFlujo', () => {
    test('debe cancelar flujo y enviar mensaje', async () => {
      await FlowManager.cancelarFlujo(testPhone, mockContext);

      expect(db.updateSession).toHaveBeenCalledWith(
        testPhone,
        'CANCELADO',
        null,
        null,
        'USUARIO',
        'Flujo cancelado por el usuario'
      );
      expect(whatsapp.sendText).toHaveBeenCalled();
      expect(db.saveMessage).toHaveBeenCalled();
    });
  });

  describe('iniciarFlujoConDatos', () => {
    test('debe iniciar flujo flexible de refrigerador con datos extraídos', async () => {
      const datosExtraidos = {
        problema: 'No enfría',
        codigo_sap: '1234567',
      };

      await FlowManager.iniciarFlujoConDatos(
        testPhone,
        'REFRIGERADOR',
        datosExtraidos,
        true,
        mockContext
      );

      expect(flexibleFlowManager.iniciarFlujo).toHaveBeenCalledWith(
        testPhone,
        'REFRIGERADOR',
        expect.objectContaining({
          codigoSAP: expect.objectContaining({ valor: '1234567' }),
          problema: expect.objectContaining({ valor: 'No enfría' }),
        }),
        mockContext
      );
    });

    test('debe iniciar flujo flexible de vehículo con datos extraídos', async () => {
      const datosExtraidos = {
        problema: 'Motor falla',
        numero_empleado: '123456',
        ubicacion: 'Monterrey',
      };

      await FlowManager.iniciarFlujoConDatos(
        testPhone,
        'VEHICULO',
        datosExtraidos,
        false,
        mockContext
      );

      expect(flexibleFlowManager.iniciarFlujo).toHaveBeenCalledWith(
        testPhone,
        'VEHICULO',
        expect.objectContaining({
          numeroEmpleado: expect.objectContaining({ valor: '123456' }),
          problema: expect.objectContaining({ valor: 'Motor falla' }),
          ubicacion: expect.objectContaining({ valor: 'Monterrey' }),
        }),
        mockContext
      );
    });
  });

  describe('getFlow', () => {
    test('debe retornar encuestaFlow para ENCUESTA', () => {
      const flow = FlowManager.getFlow('ENCUESTA');
      expect(flow).toBe(encuestaFlow);
    });

    test('debe retornar consultaEstadoFlow para CONSULTA', () => {
      const flow = FlowManager.getFlow('CONSULTA');
      expect(flow).toBe(consultaEstadoFlow);
    });

    test('debe retornar null para tipos de reporte (manejados por flexible)', () => {
      expect(FlowManager.getFlow('REFRIGERADOR')).toBeNull();
      expect(FlowManager.getFlow('VEHICULO')).toBeNull();
    });
  });

  describe('getTipoReportePorEstado', () => {
    test('debe retornar REFRIGERADOR para REFRIGERADOR_ACTIVO', () => {
      expect(FlowManager.getTipoReportePorEstado('REFRIGERADOR_ACTIVO')).toBe('REFRIGERADOR');
    });

    test('debe retornar VEHICULO para VEHICULO_ACTIVO', () => {
      expect(FlowManager.getTipoReportePorEstado('VEHICULO_ACTIVO')).toBe('VEHICULO');
    });

    test('debe retornar ENCUESTA para estados de encuesta', () => {
      expect(FlowManager.getTipoReportePorEstado('ENCUESTA_INVITACION')).toBe('ENCUESTA');
      expect(FlowManager.getTipoReportePorEstado('ENCUESTA_PREGUNTA_1')).toBe('ENCUESTA');
    });

    test('debe retornar CONSULTA para estado de consulta', () => {
      expect(FlowManager.getTipoReportePorEstado('CONSULTA_ESPERA_TICKET')).toBe('CONSULTA');
    });

    test('debe retornar null para estados no reconocidos', () => {
      expect(FlowManager.getTipoReportePorEstado('INICIO')).toBeNull();
      expect(FlowManager.getTipoReportePorEstado('UNKNOWN')).toBeNull();
    });
  });
});
