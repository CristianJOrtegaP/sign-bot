/**
 * Integration Test: Optimistic Locking
 * Verifica conflictos de concurrencia con Version++
 */

jest.mock('../../core/services/infrastructure/appInsightsService', () =>
  require('../__mocks__/appInsightsService.mock')
);
jest.mock('../../core/services/external/whatsappService', () =>
  require('../__mocks__/whatsappService.mock')
);
jest.mock('../../core/services/infrastructure/metricsService', () =>
  require('../__mocks__/metricsService.mock')
);
jest.mock('../../core/services/infrastructure/errorHandler', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), ai: jest.fn() },
}));

describe('Optimistic Locking (Integration)', () => {
  // ===========================================================
  // BASECONTEXT + VERSION TRACKING
  // ===========================================================
  describe('BaseContext - Version tracking', () => {
    let mockDb;

    beforeEach(() => {
      mockDb = {
        updateSession: jest.fn().mockResolvedValue(undefined),
        saveMessage: jest.fn().mockResolvedValue(undefined),
        updateLastActivity: jest.fn().mockResolvedValue(undefined),
      };
    });

    test('debe pasar Version al actualizar estado', async () => {
      jest.resetModules();
      jest.doMock('../../core/services/storage/databaseService', () => mockDb);
      jest.mock('../../core/services/external/whatsappService', () =>
        require('../__mocks__/whatsappService.mock')
      );
      jest.mock('../../core/services/infrastructure/metricsService', () =>
        require('../__mocks__/metricsService.mock')
      );
      jest.mock('../../core/services/infrastructure/errorHandler', () => ({
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      }));

      const BC = require('../../core/flowEngine/contexts/BaseContext');
      const session = { Estado: 'ESTADO_A', Version: 5, DatosTemp: null, EquipoId: null };
      const ctx = new BC('+52155', session, { log: jest.fn() });

      await ctx.cambiarEstado('ESTADO_B');

      // Version 5 pasada como último argumento
      expect(mockDb.updateSession).toHaveBeenCalledWith(
        '+52155',
        'ESTADO_B',
        null,
        null,
        'BOT',
        expect.any(String),
        null,
        5
      );
    });

    test('debe incrementar Version local tras cada update exitoso', async () => {
      jest.resetModules();
      jest.doMock('../../core/services/storage/databaseService', () => mockDb);
      jest.mock('../../core/services/external/whatsappService', () =>
        require('../__mocks__/whatsappService.mock')
      );
      jest.mock('../../core/services/infrastructure/metricsService', () =>
        require('../__mocks__/metricsService.mock')
      );
      jest.mock('../../core/services/infrastructure/errorHandler', () => ({
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      }));

      const BC = require('../../core/flowEngine/contexts/BaseContext');
      const session = { Estado: 'A', Version: 1, DatosTemp: null, EquipoId: null };
      const ctx = new BC('+52155', session, { log: jest.fn() });

      await ctx.cambiarEstado('B');
      expect(ctx._getVersion()).toBe(2);

      await ctx.cambiarEstado('C');
      expect(ctx._getVersion()).toBe(3);

      await ctx.finalizar();
      expect(ctx._getVersion()).toBe(4);
    });

    test('Version no debe incrementarse si el update falla', async () => {
      jest.resetModules();
      // Require ConcurrencyError DESPUÉS de resetModules para mantener identidad de clase
      const { ConcurrencyError } = require('../../core/errors');
      mockDb.updateSession.mockRejectedValue(new ConcurrencyError('+52155', 1, 'updateSession'));

      jest.doMock('../../core/services/storage/databaseService', () => mockDb);
      jest.mock('../../core/services/external/whatsappService', () =>
        require('../__mocks__/whatsappService.mock')
      );
      jest.mock('../../core/services/infrastructure/metricsService', () =>
        require('../__mocks__/metricsService.mock')
      );
      jest.mock('../../core/services/infrastructure/errorHandler', () => ({
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      }));

      const BC = require('../../core/flowEngine/contexts/BaseContext');
      const session = { Estado: 'A', Version: 1, DatosTemp: null, EquipoId: null };
      const ctx = new BC('+52155', session, { log: jest.fn() });

      await expect(ctx.cambiarEstado('B')).rejects.toThrow('Concurrency conflict');

      // Version NO se incrementó
      expect(ctx._getVersion()).toBe(1);
    });
  });

  // ===========================================================
  // CONCURRENCY ERROR EN MOCK DB
  // ===========================================================
  describe('ConcurrencyError con mock de DB', () => {
    test('debe detectar conflicto cuando Version no coincide', async () => {
      const db = require('../__mocks__/databaseService.mock');
      db.__reset();

      // Sesión con Version 1
      db.__setSession('+52155', { Estado: 'INICIO', Version: 1 });

      // Update con Version correcta - éxito
      await db.updateSession('+52155', 'ESTADO_A', null, null, 'BOT', '', null, 1);
      const afterFirst = db.__getStoredSession('+52155');
      expect(afterFirst.Version).toBe(2);

      // Update con Version desactualizada - conflicto (verificar por mensaje, no por clase)
      await expect(
        db.updateSession('+52155', 'ESTADO_B', null, null, 'BOT', '', null, 1)
      ).rejects.toThrow('Version mismatch');
    });
  });

  // ===========================================================
  // FLOWMANAGER + CONCURRENCY
  // ===========================================================
  describe('FlowManager.cancelarFlujo maneja ConcurrencyError', () => {
    test('debe enviar mensaje de cancelación incluso con conflicto', async () => {
      jest.resetModules();

      // Require ConcurrencyError DESPUÉS de resetModules
      const { ConcurrencyError } = require('../../core/errors');
      const mockDbCancel = {
        getSessionFresh: jest.fn(async () => ({ Estado: 'REFRI', Version: 5 })),
        updateSession: jest
          .fn()
          .mockRejectedValue(new ConcurrencyError('+52155', 5, 'updateSession')),
        saveMessage: jest.fn().mockResolvedValue(undefined),
      };

      jest.doMock('../../core/services/storage/databaseService', () => mockDbCancel);
      jest.mock('../../core/services/external/whatsappService', () =>
        require('../__mocks__/whatsappService.mock')
      );
      jest.mock('../../core/services/infrastructure/metricsService', () =>
        require('../__mocks__/metricsService.mock')
      );
      jest.mock('../../core/services/infrastructure/errorHandler', () => ({
        logger: {
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          debug: jest.fn(),
          ai: jest.fn(),
        },
      }));
      jest.mock('../../core/services/infrastructure/appInsightsService', () =>
        require('../__mocks__/appInsightsService.mock')
      );
      jest.mock('../../bot/flows/reporteFlow', () => ({
        iniciarFlujo: jest.fn(),
        procesarMensaje: jest.fn(),
        procesarBoton: jest.fn(),
      }));
      jest.mock('../../bot/flows/encuestaFlow', () => ({}));
      jest.mock('../../bot/flows/consultaFlow', () => ({}));
      jest.mock('../../bot/flows', () => ({
        registry: {
          tieneHandlerParaEstado: jest.fn(() => false),
          obtenerHandlerBoton: jest.fn(() => null),
          procesarMensaje: jest.fn(),
          procesarBoton: jest.fn(),
        },
        inicializarFlujos: jest.fn(),
      }));

      const { cancelarFlujo } = require('../../bot/controllers/flows/FlowManager');
      const mockWhatsapp = require('../../core/services/external/whatsappService');
      const context = global.createMockContext();

      // No debe lanzar error
      await cancelarFlujo('+52155', context);

      // Mensaje enviado a pesar del conflicto
      expect(mockWhatsapp.sendText).toHaveBeenCalled();
    });
  });
});
