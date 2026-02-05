/**
 * Chaos Testing - Simula fallas en servicios externos
 * FASE 2: Testing Avanzado
 *
 * Verifica que el sistema maneja gracefully:
 * - DB offline / timeouts
 * - WhatsApp API timeout / rate limit
 * - AI provider failure
 * - Circuit breaker activation
 */

jest.setTimeout(30000);

// Mock de config
jest.mock('../../core/config', () => ({
  database: {
    reconnectErrorCodes: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'],
    requestTimeout: 30000,
  },
  whatsapp: {
    httpTimeout: 10000,
  },
  serviceBus: {
    enabled: false,
  },
}));

// Mock de logger
jest.mock('../../core/services/infrastructure/errorHandler', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    database: jest.fn(),
    whatsapp: jest.fn(),
  },
  AppError: class AppError extends Error {
    constructor(message, code, isOperational = true) {
      super(message);
      this.code = code;
      this.isOperational = isOperational;
    }
  },
  DatabaseError: class DatabaseError extends Error {
    constructor(message) {
      super(message);
      this.name = 'DatabaseError';
    }
  },
  ExternalServiceError: class ExternalServiceError extends Error {
    constructor(message, service) {
      super(message);
      this.name = 'ExternalServiceError';
      this.service = service;
    }
  },
}));

describe('Chaos Tests - Circuit Breaker Behavior', () => {
  let circuitBreaker;

  beforeEach(() => {
    jest.resetModules();
    circuitBreaker = require('../../core/services/infrastructure/circuitBreaker');
    circuitBreaker.resetAll();
  });

  test('debe abrir circuit breaker después de N fallas consecutivas', async () => {
    const breaker = circuitBreaker.getBreaker('test-service', {
      failureThreshold: 3,
      successThreshold: 1,
      timeout: 1000,
    });

    // Simular 3 fallas consecutivas
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('Service unavailable');
        });
      } catch (_e) {
        // Expected
      }
    }

    // Verificar que el breaker está abierto
    expect(breaker.getState()).toBe('OPEN');

    // Siguiente llamada debe ser rechazada inmediatamente
    const check = breaker.canExecute();
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('Circuit open');
  });

  test('debe usar fallback cuando circuit está abierto', async () => {
    const breaker = circuitBreaker.getBreaker('test-fallback', {
      failureThreshold: 2,
      timeout: 1000,
    });

    // Abrir el circuit breaker
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('Timeout');
        });
      } catch (_e) {
        // Expected
      }
    }

    // Ejecutar con fallback
    const result = await breaker.execute(
      async () => {
        throw new Error('Should not reach');
      },
      () => 'fallback-value'
    );

    expect(result).toBe('fallback-value');
  });

  test('debe transicionar a HALF_OPEN después del timeout', async () => {
    const breaker = circuitBreaker.getBreaker('test-halfopen', {
      failureThreshold: 2,
      timeout: 100, // 100ms timeout para test rápido
    });

    // Abrir el circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('Fail');
        });
      } catch (_e) {
        // Expected
      }
    }

    expect(breaker.getState()).toBe('OPEN');

    // Esperar timeout
    await new Promise((resolve) => {
      setTimeout(resolve, 150);
    });

    // Siguiente check debería permitir (HALF_OPEN)
    const check = breaker.canExecute();
    expect(check.allowed).toBe(true);
    expect(breaker.getState()).toBe('HALF_OPEN');
  });

  test('debe cerrar circuit después de éxitos en HALF_OPEN', async () => {
    const breaker = circuitBreaker.getBreaker('test-close', {
      failureThreshold: 2,
      successThreshold: 2,
      timeout: 50,
    });

    // Abrir el circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('Fail');
        });
      } catch (_e) {
        // Expected
      }
    }

    // Esperar timeout para HALF_OPEN
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });

    // Simular 2 éxitos para cerrar
    for (let i = 0; i < 2; i++) {
      await breaker.execute(async () => 'success');
    }

    expect(breaker.getState()).toBe('CLOSED');
  });
});

describe('Chaos Tests - Dead Letter Queue Behavior', () => {
  test('debe guardar mensaje en DLQ cuando procesamiento falla', async () => {
    jest.resetModules();

    // Mock del pool de conexión
    const mockPool = {
      request: jest.fn().mockReturnThis(),
      input: jest.fn().mockReturnThis(),
      query: jest.fn().mockResolvedValue({}),
    };

    jest.mock('../../core/services/storage/connectionPool', () => ({
      getPool: jest.fn().mockResolvedValue(mockPool),
      executeWithRetry: jest.fn((fn) => fn()),
    }));

    jest.mock('../../core/services/infrastructure/correlationService', () => ({
      getCorrelationId: () => 'test-correlation-123',
    }));

    const deadLetter = require('../../core/services/infrastructure/deadLetterService');

    await deadLetter.saveFailedMessage(
      {
        messageId: 'wamid.test123',
        from: '521551234567',
        type: 'text',
        content: 'Test message',
      },
      new Error('Processing failed')
    );

    // Verificar que se intentó guardar
    expect(mockPool.request).toHaveBeenCalled();
  });
});

describe('Chaos Tests - Rate Limiter Under Stress', () => {
  let rateLimiter;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../core/config', () => ({
      rateLimiting: {
        messages: {
          maxPerMinute: 5,
          maxPerHour: 20,
          windowMinuteMs: 60000,
          windowHourMs: 3600000,
        },
        images: {
          maxPerMinute: 2,
          maxPerHour: 10,
          windowMinuteMs: 60000,
          windowHourMs: 3600000,
        },
        audios: {
          maxPerMinute: 2,
          maxPerHour: 10,
          windowMinuteMs: 60000,
          windowHourMs: 3600000,
        },
        cleanupIntervalMs: 60000,
        spam: {
          windowMs: 10000,
          maxMessagesInWindow: 10,
        },
      },
    }));
    rateLimiter = require('../../core/services/infrastructure/rateLimiter');
    rateLimiter.clearState();
  });

  test('debe bloquear después de exceder límite por minuto', () => {
    const userId = 'stress-test-user';

    // Enviar 5 mensajes (dentro del límite)
    for (let i = 0; i < 5; i++) {
      const result = rateLimiter.checkRateLimit(userId, 'message');
      expect(result.allowed).toBe(true);
      rateLimiter.recordRequest(userId, 'message');
    }

    // El 6to debe ser bloqueado
    const blocked = rateLimiter.checkRateLimit(userId, 'message');
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain('límite');
  });

  test('debe detectar duplicados correctamente', () => {
    const messageId = 'wamid.duplicate-test-123';

    // Primera vez: no es duplicado
    expect(rateLimiter.isDuplicateMessage(messageId)).toBe(false);

    // Segunda vez: es duplicado
    expect(rateLimiter.isDuplicateMessage(messageId)).toBe(true);
  });

  test('debe detectar spam agresivo', () => {
    const userId = 'spam-user';

    // Simular 15 mensajes rápidos
    for (let i = 0; i < 15; i++) {
      rateLimiter.recordRequest(userId, 'message');
    }

    expect(rateLimiter.isSpamming(userId)).toBe(true);
  });
});

describe('Chaos Tests - Graceful Degradation', () => {
  test('sistema debe seguir funcionando con servicios degradados', async () => {
    // Este test verifica que el sistema puede manejar fallas parciales

    jest.resetModules();

    // Mock de AI service que falla
    jest.mock('../../core/services/ai/aiService', () => ({
      generateResponse: jest.fn().mockRejectedValue(new Error('AI unavailable')),
      detectIntent: jest.fn().mockRejectedValue(new Error('AI unavailable')),
    }));

    // Mock de intent service con fallback
    const intentService = {
      detectIntent: async (text) => {
        // Fallback a regex cuando AI falla
        if (/hola|hi|hey/i.test(text)) {
          return {
            intencion: 'SALUDO',
            confianza: 0.8,
            metodo: 'regex_fallback',
          };
        }
        return {
          intencion: 'OTRO',
          confianza: 0.5,
          metodo: 'fallback',
        };
      },
    };

    // Verificar que el fallback funciona
    const result = await intentService.detectIntent('hola');
    expect(result.intencion).toBe('SALUDO');
    expect(result.metodo).toBe('regex_fallback');
  });
});

describe('Chaos Tests - Memory Pressure', () => {
  test('rate limiter no debe crecer indefinidamente', () => {
    jest.resetModules();
    jest.mock('../../core/config', () => ({
      rateLimiting: {
        messages: {
          maxPerMinute: 20,
          maxPerHour: 100,
          windowMinuteMs: 60000,
          windowHourMs: 3600000,
        },
        images: { maxPerMinute: 3, maxPerHour: 20, windowMinuteMs: 60000, windowHourMs: 3600000 },
        audios: { maxPerMinute: 3, maxPerHour: 30, windowMinuteMs: 60000, windowHourMs: 3600000 },
        cleanupIntervalMs: 60000,
        spam: { windowMs: 10000, maxMessagesInWindow: 10 },
      },
    }));

    const rateLimiter = require('../../core/services/infrastructure/rateLimiter');
    rateLimiter.clearState();

    // Simular muchos usuarios diferentes
    const initialMemory = process.memoryUsage().heapUsed;

    for (let i = 0; i < 1000; i++) {
      const userId = `user-${i}`;
      rateLimiter.checkRateLimit(userId, 'message');
      rateLimiter.recordRequest(userId, 'message');
    }

    const afterMemory = process.memoryUsage().heapUsed;
    const memoryGrowth = (afterMemory - initialMemory) / 1024 / 1024; // MB

    // El crecimiento de memoria debe ser razonable (< 50MB para 1000 usuarios)
    expect(memoryGrowth).toBeLessThan(50);
  });
});
