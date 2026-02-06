/**
 * Unit Test: Handler Middleware
 * Verifica rate limiting distribuido y reactivación de sesión
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
jest.mock('../../core/services/infrastructure/rateLimiter', () => ({
  checkRateLimitDistributed: jest.fn().mockResolvedValue({ allowed: true }),
  recordRequest: jest.fn(),
}));

const {
  enforceRateLimit,
  reactivateSessionIfTerminal,
} = require('../../bot/controllers/messageHandler/utils/handlerMiddleware');
const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');
const rateLimiter = require('../../core/services/infrastructure/rateLimiter');

describe('Handler Middleware', () => {
  const from = '+5215512345678';
  let context;

  beforeEach(() => {
    jest.clearAllMocks();
    context = global.createMockContext();
    db.__reset();
    rateLimiter.checkRateLimitDistributed.mockResolvedValue({ allowed: true });
    whatsapp.sendAndSaveText.mockResolvedValue(undefined);
  });

  // ===========================================================
  // ENFORCE RATE LIMIT
  // ===========================================================
  describe('enforceRateLimit', () => {
    test('debe permitir si no excede límite', async () => {
      const result = await enforceRateLimit(from, 'message');
      expect(result.allowed).toBe(true);
      expect(rateLimiter.recordRequest).toHaveBeenCalledWith(from, 'message');
    });

    test('debe bloquear y enviar mensaje si excede límite', async () => {
      rateLimiter.checkRateLimitDistributed.mockResolvedValue({
        allowed: false,
        reason: 'Demasiados mensajes, espera un momento',
      });
      const result = await enforceRateLimit(from, 'message');
      expect(result.allowed).toBe(false);
      expect(whatsapp.sendAndSaveText).toHaveBeenCalledWith(
        from,
        expect.stringContaining('Demasiados mensajes')
      );
    });
  });

  // ===========================================================
  // REACTIVATE SESSION IF TERMINAL
  // ===========================================================
  describe('reactivateSessionIfTerminal', () => {
    test('no debe hacer nada si estado es INICIO', async () => {
      const session = { Estado: 'INICIO', Version: 1 };
      await reactivateSessionIfTerminal(from, session, 'texto', context);
      expect(db.updateSession).not.toHaveBeenCalled();
    });

    test('no debe hacer nada si estado no es terminal', async () => {
      const session = { Estado: 'REFRIGERADOR_ACTIVO', Version: 1 };
      await reactivateSessionIfTerminal(from, session, 'texto', context);
      expect(db.updateSession).not.toHaveBeenCalled();
    });

    test('debe reactivar sesión en estado FINALIZADO', async () => {
      const session = { Estado: 'FINALIZADO', Version: 3 };
      db.__setSession(from, session);
      await reactivateSessionIfTerminal(from, session, 'texto', context);
      expect(db.updateSession).toHaveBeenCalledWith(
        from,
        'INICIO',
        null,
        null,
        expect.any(String),
        expect.stringContaining('Sesión reactivada'),
        null,
        3
      );
      expect(session.Estado).toBe('INICIO');
      expect(session.Version).toBe(4);
    });

    test('debe reactivar sesión en estado CANCELADO', async () => {
      const session = { Estado: 'CANCELADO', Version: 2 };
      db.__setSession(from, session);
      await reactivateSessionIfTerminal(from, session, 'botón', context);
      expect(session.Estado).toBe('INICIO');
    });

    test('debe manejar ConcurrencyError releyendo sesión fresca', async () => {
      const { ConcurrencyError } = require('../../core/errors');
      const session = { Estado: 'FINALIZADO', Version: 3 };
      db.updateSession.mockRejectedValueOnce(new ConcurrencyError(from, 3, 'updateSession'));
      db.getSessionFresh.mockResolvedValue({ Estado: 'INICIO', Version: 5 });

      await reactivateSessionIfTerminal(from, session, 'texto', context);
      // Debe releer sesión fresca y asignarla
      expect(db.getSessionFresh).toHaveBeenCalledWith(from);
      expect(session.Estado).toBe('INICIO');
      expect(session.Version).toBe(5);
    });
  });
});
