/**
 * Unit Test: Session Cleanup Timer
 * Verifica procesamiento de sesiones expiradas y limpieza
 */

jest.mock('../../core/services/infrastructure/appInsightsService', () =>
  require('../__mocks__/appInsightsService.mock')
);
jest.mock('../../core/services/infrastructure/errorHandler', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockSessionTimeoutService = {
  getTimeoutMinutes: jest.fn(() => 30),
  getWarningMinutes: jest.fn(() => 25),
  processExpiredSessions: jest.fn().mockResolvedValue({
    advertenciasEnviadas: 2,
    sesionesCerradas: 1,
    notificacionesEnviadas: 1,
    errores: 0,
    duracionMs: 150,
  }),
};
jest.mock('../../core/services/processing/sessionTimeoutService', () => mockSessionTimeoutService);

const mockDb = {
  cleanOldProcessedMessages: jest.fn().mockResolvedValue(undefined),
  cleanOldHistorialSesiones: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../core/services/storage/databaseService', () => mockDb);

describe('Session Cleanup Timer', () => {
  let timerFunction;
  let context;
  let myTimer;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../core/services/infrastructure/appInsightsService', () =>
      require('../__mocks__/appInsightsService.mock')
    );
    jest.mock('../../core/services/infrastructure/errorHandler', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.mock(
      '../../core/services/processing/sessionTimeoutService',
      () => mockSessionTimeoutService
    );
    jest.mock('../../core/services/storage/databaseService', () => mockDb);

    timerFunction = require('../../timer-session-cleanup');
    context = global.createMockContext();
    myTimer = { isPastDue: false };

    // Reset mocks
    mockSessionTimeoutService.processExpiredSessions.mockResolvedValue({
      advertenciasEnviadas: 2,
      sesionesCerradas: 1,
      notificacionesEnviadas: 1,
      errores: 0,
      duracionMs: 150,
    });
    mockDb.cleanOldProcessedMessages.mockResolvedValue(undefined);
    mockDb.cleanOldHistorialSesiones.mockResolvedValue(undefined);
  });

  // ===========================================================
  // PROCESAMIENTO NORMAL
  // ===========================================================
  describe('procesamiento normal', () => {
    test('debe procesar sesiones expiradas y limpiar', async () => {
      await timerFunction(context, myTimer);
      expect(mockSessionTimeoutService.processExpiredSessions).toHaveBeenCalled();
      expect(mockDb.cleanOldProcessedMessages).toHaveBeenCalled();
      expect(mockDb.cleanOldHistorialSesiones).toHaveBeenCalled();
      expect(context.res.status).toBe(200);
      expect(context.res.body.success).toBe(true);
    });

    test('debe incluir stats en respuesta', async () => {
      await timerFunction(context, myTimer);
      expect(context.res.body.stats).toEqual(
        expect.objectContaining({
          advertenciasEnviadas: 2,
          sesionesCerradas: 1,
        })
      );
    });

    test('debe incluir configuración en respuesta', async () => {
      await timerFunction(context, myTimer);
      expect(context.res.body.config).toEqual({
        warningMinutes: 25,
        timeoutMinutes: 30,
      });
    });
  });

  // ===========================================================
  // isPastDue
  // ===========================================================
  describe('isPastDue', () => {
    test('debe logear si el timer está retrasado', async () => {
      myTimer.isPastDue = true;
      await timerFunction(context, myTimer);
      expect(context.log).toHaveBeenCalledWith(expect.stringContaining('retraso'));
    });
  });

  // ===========================================================
  // ERRORES
  // ===========================================================
  describe('manejo de errores', () => {
    test('debe manejar error en processExpiredSessions', async () => {
      mockSessionTimeoutService.processExpiredSessions.mockRejectedValue(new Error('DB down'));
      await timerFunction(context, myTimer);
      expect(context.res.status).toBe(500);
      expect(context.res.body.success).toBe(false);
    });

    test('debe manejar error en cleanup sin fallar', async () => {
      mockDb.cleanOldProcessedMessages.mockRejectedValue(new Error('Cleanup failed'));
      await timerFunction(context, myTimer);
      // El timer sigue funcionando
      expect(context.res.status).toBe(200);
    });

    test('debe manejar error en limpieza de historial sin fallar', async () => {
      mockDb.cleanOldHistorialSesiones.mockRejectedValue(new Error('Historial cleanup failed'));
      await timerFunction(context, myTimer);
      expect(context.res.status).toBe(200);
    });
  });

  // ===========================================================
  // WARNINGS
  // ===========================================================
  describe('warnings por errores en stats', () => {
    test('debe logear warning si hay errores en stats', async () => {
      mockSessionTimeoutService.processExpiredSessions.mockResolvedValue({
        advertenciasEnviadas: 0,
        sesionesCerradas: 0,
        notificacionesEnviadas: 0,
        errores: 3,
        duracionMs: 50,
      });
      await timerFunction(context, myTimer);
      expect(context.log.warn).toHaveBeenCalledWith(expect.stringContaining('3 errores'));
    });
  });
});
