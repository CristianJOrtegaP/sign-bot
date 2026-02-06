/**
 * Unit Test: IntentService
 * Sistema de 3 capas: cache estático → regex → AI
 */

jest.mock('../../core/services/ai/aiService', () => require('../__mocks__/aiService.mock'));
jest.mock('../../core/services/infrastructure/metricsService', () =>
  require('../__mocks__/metricsService.mock')
);
jest.mock('../../core/services/infrastructure/errorHandler', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), ai: jest.fn() },
}));
jest.mock('../../core/config', () => ({
  isAIEnabled: true,
  ai: {
    provider: 'mock',
    confidence: { high: 0.9, medium: 0.7, low: 0.5 },
    messageLengthThreshold: 30,
  },
  redis: { enabled: false },
  intents: { OTRO: 'OTRO' },
}));
jest.mock('../../core/utils/promises', () => ({
  withTimeoutAndFallback: jest.fn(async (promise) => promise),
}));
jest.mock('../../core/services/cache/redisService', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  isUsingFallback: jest.fn(() => true),
}));

const _aiService = require('../../core/services/ai/aiService');
const _config = require('../../core/config');

describe('IntentService', () => {
  let intentService;

  beforeEach(() => {
    jest.resetModules();
    // Re-mock después de resetModules
    jest.mock('../../core/services/ai/aiService', () => require('../__mocks__/aiService.mock'));
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
    jest.mock('../../core/config', () => ({
      isAIEnabled: true,
      ai: {
        provider: 'mock',
        confidence: { high: 0.9, medium: 0.7, low: 0.5 },
        messageLengthThreshold: 30,
      },
      redis: { enabled: false },
      intents: { OTRO: 'OTRO' },
    }));
    jest.mock('../../core/utils/promises', () => ({
      withTimeoutAndFallback: jest.fn(async (promise) => promise),
    }));
    jest.mock('../../core/services/cache/redisService', () => ({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      isUsingFallback: jest.fn(() => true),
    }));
    intentService = require('../../core/services/ai/intentService');
  });

  // ===========================================================
  // CAPA 0: CACHE ESTÁTICO
  // ===========================================================
  describe('Capa 0 - Cache estático (exact match)', () => {
    test.each([
      ['hola', 'SALUDO'],
      ['hi', 'SALUDO'],
      ['buenas tardes', 'SALUDO'],
      ['si', 'CONFIRMAR'],
      ['ok', 'CONFIRMAR'],
      ['cancelar', 'CANCELAR'],
      ['salir', 'CANCELAR'],
      ['gracias', 'DESPEDIDA'],
      ['adios', 'DESPEDIDA'],
    ])('debe detectar "%s" como %s desde cache', async (input, expectedIntent) => {
      const result = await intentService.detectIntent(input);

      expect(result.intencion).toBe(expectedIntent);
      expect(result.metodo).toBe('cache');
      expect(result.confianza).toBe(0.9);
    });

    test('no debe llamar a AI para mensajes cacheados', async () => {
      const ai = require('../../core/services/ai/aiService');

      await intentService.detectIntent('hola');

      expect(ai.detectIntent).not.toHaveBeenCalled();
      expect(ai.extractAllData).not.toHaveBeenCalled();
    });
  });

  // ===========================================================
  // CAPA 1: REGEX
  // ===========================================================
  describe('Capa 1 - Regex patterns', () => {
    test.each([
      ['buenos días amigo', 'SALUDO'],
      ['qué tal', 'SALUDO'],
      ['no quiero continuar', 'CANCELAR'],
      ['olvídalo', 'CANCELAR'],
      ['hasta luego', 'DESPEDIDA'],
      ['no enfría', 'REPORTAR_FALLA'],
      ['no funciona', 'REPORTAR_FALLA'],
      ['está descompuesto', 'REPORTAR_FALLA'],
      ['refrigerador', 'TIPO_REFRIGERADOR'],
      ['vehiculo', 'TIPO_VEHICULO'],
    ])('debe detectar "%s" como %s via regex', async (input, expectedIntent) => {
      const result = await intentService.detectIntent(input);

      expect(result.intencion).toBe(expectedIntent);
      expect(result.metodo).toBe('regex');
    });

    test('debe detectar SALUDO + REPORTAR_FALLA combinado como REPORTAR_FALLA', async () => {
      const result = await intentService.detectIntent('Hola, mi refri no enfría');

      expect(result.intencion).toBe('REPORTAR_FALLA');
      expect(result.metodo).toBe('regex');
    });
  });

  // ===========================================================
  // CAPA 2: AI (mensajes largos)
  // ===========================================================
  describe('Capa 2 - AI extractAllData (mensajes largos)', () => {
    test('debe usar AI para mensajes largos sin patrón', async () => {
      const ai = require('../../core/services/ai/aiService');
      ai.extractAllData.mockResolvedValue({
        intencion: 'REPORTAR_FALLA',
        tipo_equipo: 'REFRIGERADOR',
        codigo_sap: '1234567',
        problema: 'No enfría correctamente',
        confianza: 0.9,
        datos_encontrados: ['tipo_equipo', 'problema'],
        razon: 'Test',
      });

      const longMessage = 'Quisiera saber más sobre los servicios que ofrecen para mi tienda';
      const result = await intentService.detectIntent(longMessage);

      expect(result.intencion).toBe('REPORTAR_FALLA');
      expect(result.metodo).toBe('ai_extract');
      expect(result.datos_extraidos.tipo_equipo).toBe('REFRIGERADOR');
    });
  });

  // ===========================================================
  // AI DESACTIVADA
  // ===========================================================
  describe('AI desactivada', () => {
    test('debe retornar OTRO con confianza baja si AI_ENABLED=false', async () => {
      jest.resetModules();
      jest.mock('../../core/services/ai/aiService', () => require('../__mocks__/aiService.mock'));
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
      jest.mock('../../core/config', () => ({
        isAIEnabled: false, // AI desactivada
        ai: {
          provider: 'mock',
          confidence: { high: 0.9, medium: 0.7, low: 0.5 },
          messageLengthThreshold: 30,
        },
        redis: { enabled: false },
        intents: { OTRO: 'OTRO' },
      }));
      jest.mock('../../core/utils/promises', () => ({
        withTimeoutAndFallback: jest.fn(async (promise) => promise),
      }));
      jest.mock('../../core/services/cache/redisService', () => ({
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        isUsingFallback: jest.fn(() => true),
      }));

      const service = require('../../core/services/ai/intentService');
      // Un mensaje sin patrón regex que normalmente iría a AI
      const result = await service.detectIntent('algo que no matchea ningun patron');

      expect(result.intencion).toBe('OTRO');
      expect(result.metodo).toBe('fallback');
    });
  });

  // ===========================================================
  // CACHE TTL
  // ===========================================================
  describe('Cache TTL de AI', () => {
    test('debe cachear resultados de AI y reutilizarlos', async () => {
      const ai = require('../../core/services/ai/aiService');
      ai.extractAllData.mockResolvedValue({
        intencion: 'REPORTAR_FALLA',
        confianza: 0.9,
        datos_encontrados: [],
        metodo: 'ai',
      });

      const msg = 'Un mensaje largo que necesita analisis de inteligencia artificial para detectar';

      // Primera llamada: AI
      await intentService.detectIntent(msg);
      // Segunda llamada: cache
      const result = await intentService.detectIntent(msg);

      expect(result.metodo).toBe('ai_cache');
      // extractAllData solo se llama una vez
      expect(ai.extractAllData).toHaveBeenCalledTimes(1);
    });
  });
});
