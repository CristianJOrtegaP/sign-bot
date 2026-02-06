/**
 * Unit Test: StaticFlowRegistry
 * Registro central de flujos estáticos/secuenciales
 */

jest.mock('../../../core/services/infrastructure/errorHandler', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), ai: jest.fn() },
}));
jest.mock('../../../core/flowEngine/contexts/StaticFlowContext', () => ({
  createStaticFlowContext: jest.fn(() => ({
    iniciarTimer: jest.fn(),
    terminarTimer: jest.fn(),
    registrarError: jest.fn(),
  })),
}));

const { StaticFlowRegistry } = require('../../../core/flowEngine/StaticFlowRegistry');
const { createStaticFlowContext } = require('../../../core/flowEngine/contexts/StaticFlowContext');

describe('StaticFlowRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new StaticFlowRegistry();
  });

  // ===========================================================
  // REGISTRAR
  // ===========================================================
  describe('registrar()', () => {
    test('debe registrar un flujo nuevo correctamente', () => {
      const flujo = {
        nombre: 'TEST_FLOW',
        estados: ['ESTADO_A', 'ESTADO_B'],
        botones: {},
        procesar: jest.fn(),
      };

      registry.registrar(flujo);

      expect(registry.flujos.has('TEST_FLOW')).toBe(true);
    });

    test('debe lanzar error si falta nombre', () => {
      expect(() => registry.registrar({ estados: [] })).toThrow('El flujo debe tener un nombre');
    });

    test('debe indexar estados al flujo correcto', () => {
      registry.registrar({
        nombre: 'FLOW_A',
        estados: ['ESTADO_1', 'ESTADO_2'],
        botones: {},
      });

      expect(registry.estadoAFlujo.get('ESTADO_1')).toBe('FLOW_A');
      expect(registry.estadoAFlujo.get('ESTADO_2')).toBe('FLOW_A');
    });

    test('debe indexar botones con formato simple', () => {
      registry.registrar({
        nombre: 'FLOW_B',
        estados: [],
        botones: { btn_test: 'handleTest' },
      });

      const config = registry.botonAHandler.get('btn_test');
      expect(config).toEqual({ flujo: 'FLOW_B', handler: 'handleTest' });
    });

    test('debe indexar botones con formato extendido (params)', () => {
      registry.registrar({
        nombre: 'FLOW_C',
        estados: [],
        botones: { btn_rating: { handler: 'handleRating', params: 5 } },
      });

      const config = registry.botonAHandler.get('btn_rating');
      expect(config).toEqual({ flujo: 'FLOW_C', handler: 'handleRating', params: 5 });
    });

    test('debe soportar chaining', () => {
      const result = registry
        .registrar({ nombre: 'A', estados: [], botones: {} })
        .registrar({ nombre: 'B', estados: [], botones: {} });

      expect(result).toBe(registry);
      expect(registry.flujos.size).toBe(2);
    });
  });

  // ===========================================================
  // DESREGISTRAR
  // ===========================================================
  describe('desregistrar()', () => {
    test('debe remover flujo y limpiar índices', () => {
      registry.registrar({
        nombre: 'TO_REMOVE',
        estados: ['ESTADO_X'],
        botones: { btn_x: 'handler' },
      });

      const result = registry.desregistrar('TO_REMOVE');

      expect(result).toBe(true);
      expect(registry.flujos.has('TO_REMOVE')).toBe(false);
      expect(registry.estadoAFlujo.has('ESTADO_X')).toBe(false);
      expect(registry.botonAHandler.has('btn_x')).toBe(false);
    });

    test('debe retornar false si flujo no existe', () => {
      expect(registry.desregistrar('NO_EXISTE')).toBe(false);
    });
  });

  // ===========================================================
  // CONSULTAS
  // ===========================================================
  describe('consultas', () => {
    beforeEach(() => {
      registry.registrar({
        nombre: 'ENCUESTA',
        estados: ['ENCUESTA_P1', 'ENCUESTA_P2'],
        botones: { btn_enc: 'handleEnc' },
        procesar: jest.fn(),
      });
    });

    test('tieneHandlerParaEstado debe retornar true para estado registrado', () => {
      expect(registry.tieneHandlerParaEstado('ENCUESTA_P1')).toBe(true);
    });

    test('tieneHandlerParaEstado debe retornar false para estado no registrado', () => {
      expect(registry.tieneHandlerParaEstado('NO_EXISTE')).toBe(false);
    });

    test('obtenerPorEstado debe retornar flujo correcto', () => {
      const flujo = registry.obtenerPorEstado('ENCUESTA_P1');
      expect(flujo.nombre).toBe('ENCUESTA');
    });

    test('obtenerPorEstado debe retornar null si no existe', () => {
      expect(registry.obtenerPorEstado('NO_EXISTE')).toBeNull();
    });

    test('obtenerHandlerBoton debe retornar config del botón', () => {
      const config = registry.obtenerHandlerBoton('btn_enc');
      expect(config).toEqual({ flujo: 'ENCUESTA', handler: 'handleEnc' });
    });

    test('obtenerHandlerBoton debe retornar null si no existe', () => {
      expect(registry.obtenerHandlerBoton('btn_no')).toBeNull();
    });

    test('listarFlujos debe retornar nombres', () => {
      expect(registry.listarFlujos()).toEqual(['ENCUESTA']);
    });

    test('getStats debe retornar estadísticas', () => {
      const stats = registry.getStats();
      expect(stats.totalFlujos).toBe(1);
      expect(stats.totalEstados).toBe(2);
      expect(stats.totalBotones).toBe(1);
    });
  });

  // ===========================================================
  // PROCESAR MENSAJE
  // ===========================================================
  describe('procesarMensaje()', () => {
    test('debe ejecutar handler correspondiente al estado', async () => {
      const mockHandler = jest.fn();
      registry.registrar({
        nombre: 'FLOW',
        estados: ['ESTADO_A'],
        botones: {},
        handlers: { ESTADO_A: 'procesar' },
        procesar: mockHandler,
      });

      const session = { Estado: 'ESTADO_A' };
      const result = await registry.procesarMensaje('+52155', 'Hola', session, {});

      expect(result).toBe(true);
      expect(mockHandler).toHaveBeenCalled();
    });

    test('debe retornar false si no hay flujo para el estado', async () => {
      const result = await registry.procesarMensaje('+52155', 'Hola', { Estado: 'NO_EXISTE' }, {});
      expect(result).toBe(false);
    });

    test('debe retornar false si handler no es function', async () => {
      registry.registrar({
        nombre: 'FLOW_NO_HANDLER',
        estados: ['ESTADO_B'],
        botones: {},
        handlers: { ESTADO_B: 'noExiste' },
      });

      const result = await registry.procesarMensaje('+52155', 'Hola', { Estado: 'ESTADO_B' }, {});
      expect(result).toBe(false);
    });

    test('debe crear contexto estático con opciones correctas', async () => {
      registry.registrar({
        nombre: 'CTX_TEST',
        estados: ['CTX_ESTADO'],
        botones: {},
        procesar: jest.fn(),
      });

      await registry.procesarMensaje(
        '+52155',
        'Hola',
        { Estado: 'CTX_ESTADO' },
        { log: jest.fn() }
      );

      expect(createStaticFlowContext).toHaveBeenCalledWith(
        '+52155',
        { Estado: 'CTX_ESTADO' },
        { log: expect.any(Function) },
        { flowName: 'CTX_TEST' }
      );
    });

    test('debe propagar error del handler y registrar métricas', async () => {
      const error = new Error('Handler falló');
      registry.registrar({
        nombre: 'ERR_FLOW',
        estados: ['ERR_ESTADO'],
        botones: {},
        procesar: jest.fn().mockRejectedValue(error),
      });

      await expect(
        registry.procesarMensaje('+52155', 'Hola', { Estado: 'ERR_ESTADO' }, {})
      ).rejects.toThrow('Handler falló');
    });
  });

  // ===========================================================
  // PROCESAR BOTON
  // ===========================================================
  describe('procesarBoton()', () => {
    test('debe ejecutar handler del botón', async () => {
      const mockHandler = jest.fn();
      registry.registrar({
        nombre: 'BTN_FLOW',
        estados: [],
        botones: { btn_ok: 'handleOk' },
        handleOk: mockHandler,
      });

      const result = await registry.procesarBoton('+52155', 'btn_ok', {}, {});

      expect(result).toBe(true);
      expect(mockHandler).toHaveBeenCalled();
    });

    test('debe pasar params al handler si existen', async () => {
      const mockHandler = jest.fn();
      registry.registrar({
        nombre: 'RATING_FLOW',
        estados: [],
        botones: { btn_r5: { handler: 'handleRating', params: 5 } },
        handleRating: mockHandler,
      });

      await registry.procesarBoton('+52155', 'btn_r5', { Estado: 'TEST' }, {});

      // Con params: handler(ctx, params, session)
      expect(mockHandler).toHaveBeenCalledWith(
        expect.any(Object), // ctx
        5, // params
        { Estado: 'TEST' } // session
      );
    });

    test('debe retornar false si botón no está registrado', async () => {
      const result = await registry.procesarBoton('+52155', 'btn_no', {}, {});
      expect(result).toBe(false);
    });

    test('debe retornar false si flujo del botón no existe', async () => {
      registry.botonAHandler.set('btn_orphan', { flujo: 'NO_EXISTE', handler: 'test' });

      const result = await registry.procesarBoton('+52155', 'btn_orphan', {}, {});
      expect(result).toBe(false);
    });
  });

  // ===========================================================
  // LIMPIAR
  // ===========================================================
  describe('limpiar()', () => {
    test('debe resetear todo', () => {
      registry.registrar({ nombre: 'A', estados: ['E1'], botones: { b1: 'h1' } });
      registry.limpiar();

      expect(registry.flujos.size).toBe(0);
      expect(registry.estadoAFlujo.size).toBe(0);
      expect(registry.botonAHandler.size).toBe(0);
      expect(registry.inicializado).toBe(false);
    });
  });
});
