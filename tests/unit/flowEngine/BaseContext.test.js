/**
 * Unit Test: BaseContext
 * Contexto base con inyección de dependencias para flujos
 */

jest.mock('../../../core/services/external/whatsappService', () =>
  require('../../__mocks__/whatsappService.mock')
);
jest.mock('../../../core/services/storage/databaseService', () =>
  require('../../__mocks__/databaseService.mock')
);
jest.mock('../../../core/services/infrastructure/metricsService', () =>
  require('../../__mocks__/metricsService.mock')
);
jest.mock('../../../core/services/infrastructure/errorHandler', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const BaseContext = require('../../../core/flowEngine/contexts/BaseContext');
const whatsapp = require('../../../core/services/external/whatsappService');
const db = require('../../../core/services/storage/databaseService');
const metrics = require('../../../core/services/infrastructure/metricsService');

describe('BaseContext', () => {
  let ctx;
  const from = '+5215512345678';
  const azureContext = global.createMockContext();

  beforeEach(() => {
    jest.clearAllMocks();
    const session = { Estado: 'ENCUESTA_PREGUNTA_1', Version: 3, EquipoId: null, DatosTemp: null };
    // Sincronizar el store interno del mock con la sesión del test
    db.__setSession(from, session);
    ctx = new BaseContext(from, session, azureContext, { flowName: 'TEST' });
  });

  // ===========================================================
  // METODOS DE RESPUESTA
  // ===========================================================
  describe('responder()', () => {
    test('debe enviar texto y guardarlo en BD', async () => {
      await ctx.responder('Hola usuario');

      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(from, 'Hola usuario');
    });

    test('debe registrar acción interna', async () => {
      await ctx.responder('Test');

      const acciones = ctx.getAcciones();
      expect(acciones).toHaveLength(1);
      expect(acciones[0].accion).toBe('responder');
      expect(acciones[0].detalles.longitud).toBe(4);
    });
  });

  describe('responderConBotones()', () => {
    test('debe enviar mensaje interactivo con botones', async () => {
      const botones = [
        { id: 'btn_1', title: 'Opción 1' },
        { id: 'btn_2', title: 'Opción 2' },
      ];

      await ctx.responderConBotones('Título', 'Cuerpo', botones);

      expect(whatsapp.sendAndSaveInteractive).toHaveBeenCalledWith(
        from,
        'Título',
        'Cuerpo',
        botones
      );
    });
  });

  describe('responderConLista()', () => {
    test('debe enviar mensaje con lista', async () => {
      const filas = [{ id: 'r1', title: 'Fila 1', description: 'Desc' }];

      await ctx.responderConLista('Título', 'Cuerpo', 'Ver opciones', filas);

      expect(whatsapp.sendAndSaveList).toHaveBeenCalledWith(
        from,
        'Título',
        'Cuerpo',
        'Ver opciones',
        filas
      );
    });
  });

  describe('enviarTexto()', () => {
    test('debe enviar texto SIN guardar en BD', async () => {
      await ctx.enviarTexto('Mensaje temporal');

      expect(whatsapp.sendText).toHaveBeenCalledWith(from, 'Mensaje temporal');
      expect(whatsapp.sendAndSaveText).not.toHaveBeenCalled();
    });
  });

  // ===========================================================
  // METODOS DE SESION (Optimistic Locking)
  // ===========================================================
  describe('cambiarEstado()', () => {
    test('debe actualizar estado con version para optimistic locking', async () => {
      await ctx.cambiarEstado('ENCUESTA_PREGUNTA_2', null, 'Avance de pregunta');

      expect(db.updateSession).toHaveBeenCalledWith(
        from,
        'ENCUESTA_PREGUNTA_2',
        null,
        null,
        'BOT',
        'Avance de pregunta',
        null,
        3 // Version actual
      );
    });

    test('debe incrementar Version local tras update exitoso', async () => {
      expect(ctx._getVersion()).toBe(3);

      await ctx.cambiarEstado('NUEVO', null, 'test');

      expect(ctx._getVersion()).toBe(4);
    });
  });

  describe('actualizarDatos()', () => {
    test('debe preservar estado actual y pasar EquipoId', async () => {
      ctx.session.EquipoId = 100;
      const datos = { campo: 'valor' };

      await ctx.actualizarDatos(datos, 'Datos actualizados');

      expect(db.updateSession).toHaveBeenCalledWith(
        from,
        'ENCUESTA_PREGUNTA_1', // Estado actual preservado
        datos,
        100, // EquipoId preservado
        'BOT',
        'Datos actualizados',
        null,
        3
      );
    });
  });

  describe('finalizar()', () => {
    test('debe cambiar estado a INICIO y limpiar datos', async () => {
      await ctx.finalizar('Encuesta completada');

      expect(db.updateSession).toHaveBeenCalledWith(
        from,
        'INICIO',
        null,
        null,
        'BOT',
        'Encuesta completada',
        null,
        3
      );
    });
  });

  describe('cancelar()', () => {
    test('debe cambiar estado a CANCELADO con origen USUARIO', async () => {
      await ctx.cancelar('El usuario no quiso continuar');

      expect(db.updateSession).toHaveBeenCalledWith(
        from,
        'CANCELADO',
        null,
        null,
        'USUARIO',
        'El usuario no quiso continuar',
        null,
        3
      );
    });
  });

  // ===========================================================
  // METODOS DE DATOS
  // ===========================================================
  describe('getDatos()', () => {
    test('debe parsear DatosTemp de JSON string', () => {
      ctx.session.DatosTemp = JSON.stringify({ encuestaId: 1, pregunta: 2 });

      const datos = ctx.getDatos();

      expect(datos.encuestaId).toBe(1);
      expect(datos.pregunta).toBe(2);
    });

    test('debe retornar {} si DatosTemp es null', () => {
      ctx.session.DatosTemp = null;
      expect(ctx.getDatos()).toEqual({});
    });

    test('debe retornar {} si DatosTemp es JSON malformado', () => {
      ctx.session.DatosTemp = '{invalid json';
      expect(ctx.getDatos()).toEqual({});
    });

    test('debe retornar objeto directamente si DatosTemp ya es objeto', () => {
      ctx.session.DatosTemp = { campo: 'valor' };
      expect(ctx.getDatos()).toEqual({ campo: 'valor' });
    });
  });

  describe('getEstado()', () => {
    test('debe retornar estado actual', () => {
      expect(ctx.getEstado()).toBe('ENCUESTA_PREGUNTA_1');
    });
  });

  // ===========================================================
  // VERSION TRACKING
  // ===========================================================
  describe('_getVersion() / _incrementVersion()', () => {
    test('debe retornar version actual', () => {
      expect(ctx._getVersion()).toBe(3);
    });

    test('debe retornar null si no hay session', () => {
      ctx.session = null;
      expect(ctx._getVersion()).toBeNull();
    });

    test('debe incrementar version local', () => {
      ctx._incrementVersion();
      expect(ctx._getVersion()).toBe(4);
    });

    test('no debe incrementar si Version es null', () => {
      ctx.session.Version = null;
      ctx._incrementVersion();
      expect(ctx._getVersion()).toBeNull();
    });
  });

  // ===========================================================
  // METRICAS
  // ===========================================================
  describe('métricas', () => {
    test('iniciarTimer debe llamar metricsService.startTimer', () => {
      ctx.iniciarTimer('procesar');
      expect(metrics.startTimer).toHaveBeenCalledWith('TEST_procesar');
    });

    test('terminarTimer debe llamar end() del timer', () => {
      const mockEnd = jest.fn();
      metrics.startTimer.mockReturnValue({ end: mockEnd });

      ctx.iniciarTimer('op');
      ctx.terminarTimer({ resultado: 'ok' });

      expect(mockEnd).toHaveBeenCalledWith({ flow: 'TEST', resultado: 'ok' });
    });

    test('terminarTimer sin timer activo no debe fallar', () => {
      expect(() => ctx.terminarTimer()).not.toThrow();
    });
  });

  // ===========================================================
  // ACCIONES
  // ===========================================================
  describe('getAcciones()', () => {
    test('debe retornar copia del historial de acciones', async () => {
      await ctx.responder('Msg 1');
      await ctx.responder('Msg 2');

      const acciones = ctx.getAcciones();
      expect(acciones).toHaveLength(2);
      // Verificar que es copia (no referencia)
      acciones.push({ accion: 'extra' });
      expect(ctx.getAcciones()).toHaveLength(2);
    });
  });
});
