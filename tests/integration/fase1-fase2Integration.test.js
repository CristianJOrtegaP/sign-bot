/**
 * Tests de Integración - FASE 1 + FASE 2
 *
 * Validaciones críticas:
 * - FASE 1: Optimistic Locking previene race conditions
 * - FASE 1: Deduplicación previene procesamiento duplicado
 * - FASE 2: Enhanced metrics captura datos correctamente
 * - FASE 2: Health checks funcionan en flujo real
 */

const SesionRepository = require('../../bot/repositories/SesionRepository');
const metricsService = require('../../core/services/infrastructure/metricsService');
const { withSessionRetry } = require('../../core/utils/retry');
const { ConcurrencyError } = require('../../core/errors');

describe('Integración FASE 1 + FASE 2', () => {
  let mockPool;
  let mockRequest;
  let mockQuery;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock de SQL request/query
    mockQuery = jest.fn();
    mockRequest = {
      input: jest.fn().mockReturnThis(),
      query: mockQuery,
    };
    mockPool = {
      request: jest.fn().mockReturnValue(mockRequest),
    };

    // Mock del getPool method
    jest.spyOn(SesionRepository, 'getPool').mockResolvedValue(mockPool);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('FASE 1: Optimistic Locking en Escenario Real', () => {
    it('debe manejar actualización concurrente de sesión con retry exitoso', async () => {
      const telefono = '+521234567890';

      // Simular que el primer intento falla por concurrencia (Version cambió)
      // El segundo intento tiene éxito
      mockQuery
        .mockRejectedValueOnce(new ConcurrencyError(telefono, 0, 'updateSession'))
        .mockResolvedValueOnce({ rowsAffected: [1] });

      // Mock de getSessionWithVersion para simular versiones actualizadas
      const db = require('../../core/services/storage/databaseService');
      const getSessionMock = jest.spyOn(db, 'getSessionWithVersion');
      getSessionMock
        .mockResolvedValueOnce({ Telefono: telefono, Estado: 'INICIO', Version: 0 })
        .mockResolvedValueOnce({ Telefono: telefono, Estado: 'INICIO', Version: 1 });

      const updateOperation = async (session) => {
        return SesionRepository.updateSession(
          telefono,
          'VEHICULO_MARCA',
          null,
          'Toyota',
          session.Version
        );
      };

      // Ejecutar con retry automático
      const result = await withSessionRetry(telefono, updateOperation, {
        maxAttempts: 3,
        baseDelayMs: 10,
      });

      // Verificar que el retry funcionó y obtuvimos la versión actualizada 2 veces
      expect(getSessionMock).toHaveBeenCalledTimes(2);
      expect(result).toBeDefined();
    });

    it('debe fallar después de max intentos si siempre hay conflicto', async () => {
      const telefono = '+521234567890';

      // Simular que TODOS los intentos fallan por concurrencia
      mockQuery.mockRejectedValue(new ConcurrencyError(telefono, 0, 'updateSession'));

      const db = require('../../core/services/storage/databaseService');
      const getSessionMock = jest.spyOn(db, 'getSessionWithVersion');
      getSessionMock.mockResolvedValue({ Telefono: telefono, Estado: 'INICIO', Version: 0 });

      const updateOperation = async (session) => {
        return SesionRepository.updateSession(
          telefono,
          'VEHICULO_MARCA',
          null,
          'Toyota',
          session.Version
        );
      };

      // Debe lanzar error después de 3 intentos
      await expect(
        withSessionRetry(telefono, updateOperation, {
          maxAttempts: 3,
          baseDelayMs: 1,
        })
      ).rejects.toThrow(ConcurrencyError);

      // Verificar que se intentó 3 veces
      expect(getSessionMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('FASE 1: Deduplicación en Flujo Real', () => {
    it('debe prevenir procesamiento duplicado de mensajes WhatsApp', async () => {
      const messageId = 'wamid.HBgNNTI1NTExNzI0MTY4NxUCABIYFjNBMjM4RjhBMkY2RDg2RjM2QkZGAA==';
      const telefono = '+521234567890';

      // Primera vez: INSERT (mensaje nuevo)
      mockQuery.mockResolvedValueOnce({
        recordset: [
          {
            Action: 'INSERT',
            WhatsAppMessageId: messageId,
            FechaCreacion: new Date('2026-02-03T10:00:00Z'),
            Reintentos: 0,
          },
        ],
      });

      const result1 = await SesionRepository.registerMessageAtomic(messageId, telefono);

      expect(result1.isDuplicate).toBe(false);
      expect(result1.retryCount).toBe(0);

      // Segunda vez (webhook duplicado): UPDATE (incrementa Reintentos)
      mockQuery.mockResolvedValueOnce({
        recordset: [
          {
            Action: 'UPDATE',
            WhatsAppMessageId: messageId,
            FechaCreacion: new Date('2026-02-03T10:00:00Z'),
            Reintentos: 1,
          },
        ],
      });

      const result2 = await SesionRepository.registerMessageAtomic(messageId, telefono);

      expect(result2.isDuplicate).toBe(true);
      expect(result2.retryCount).toBe(1);

      // Tercera vez: UPDATE (incrementa más)
      mockQuery.mockResolvedValueOnce({
        recordset: [
          {
            Action: 'UPDATE',
            WhatsAppMessageId: messageId,
            FechaCreacion: new Date('2026-02-03T10:00:00Z'),
            Reintentos: 2,
          },
        ],
      });

      const result3 = await SesionRepository.registerMessageAtomic(messageId, telefono);

      expect(result3.isDuplicate).toBe(true);
      expect(result3.retryCount).toBe(2);

      // Verificar que se llamó al MERGE 3 veces
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it('debe aplicar fail-open en caso de error de BD', async () => {
      const messageId = 'wamid.test';
      const telefono = '+521234567890';

      // Simular error de BD (ej: timeout, connection lost)
      mockQuery.mockRejectedValue(new Error('Connection timeout'));

      // En fail-open, debe permitir procesar (mejor duplicar que perder mensaje)
      const result = await SesionRepository.registerMessageAtomic(messageId, telefono);

      expect(result.isDuplicate).toBe(false);
      expect(result.retryCount).toBe(0);
      expect(result.error).toBe('Connection timeout');
    });
  });

  describe('FASE 2: Metrics en Flujo Real', () => {
    it('debe capturar métricas de operación completa', () => {
      const operationName = 'integration.test';

      // Simular operación con timer
      const timer = metricsService.startTimer(operationName);

      // Simular trabajo (modificar startTime para control de test)
      timer.startTime = Date.now() - 250; // 250ms de duración

      // Finalizar con éxito
      const duration = timer.end({ success: true, messageId: 'test123' });

      expect(duration).toBeGreaterThan(200);
      expect(duration).toBeLessThan(300);

      // Verificar que las métricas se actualizaron
      const summary = metricsService.getMetricsSummary();

      // Verificar contadores básicos
      expect(summary.operations[operationName]).toBe(1);
      expect(summary.timings[operationName]).toBeDefined();
      expect(summary.timings[operationName].count).toBe(1);
    });

    it('debe trackear errores correctamente', () => {
      const operationName = 'integration.error';

      // 3 éxitos
      for (let i = 0; i < 3; i++) {
        const timer = metricsService.startTimer(operationName);
        timer.startTime = Date.now() - 100;
        timer.end({ success: true });
      }

      // 1 error
      const errorTimer = metricsService.startTimer(operationName);
      errorTimer.startTime = Date.now() - 500;
      errorTimer.end({ error: true, errorMessage: 'Test error' });

      const summary = metricsService.getMetricsSummary();

      // Verificar que se registraron 4 operaciones totales
      expect(summary.operations[operationName]).toBe(4);
    });
  });

  describe('FASE 1 + FASE 2: Flujo Completo con Métricas', () => {
    it('debe procesar actualización de sesión con deduplicación y métricas', async () => {
      const telefono = '+521234567890';
      const messageId = 'wamid.fullflow';

      // 1. FASE 1: Registrar mensaje (deduplicación)
      mockQuery.mockResolvedValueOnce({
        recordset: [
          {
            Action: 'INSERT',
            WhatsAppMessageId: messageId,
            FechaCreacion: new Date(),
            Reintentos: 0,
          },
        ],
      });

      const timer1 = metricsService.startTimer('fullflow.deduplication');
      const dedupResult = await SesionRepository.registerMessageAtomic(messageId, telefono);
      timer1.end({ success: true });

      expect(dedupResult.isDuplicate).toBe(false);

      // 2. FASE 1: Actualizar sesión con optimistic locking
      mockQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const timer2 = metricsService.startTimer('fullflow.updateSession');
      const updateResult = await SesionRepository.updateSession(
        telefono,
        'VEHICULO_MARCA',
        null,
        'Toyota',
        0 // expectedVersion
      );
      timer2.end({ success: true });

      expect(updateResult).toBe(true);

      // 3. FASE 2: Verificar que las métricas se capturaron
      const summary = metricsService.getMetricsSummary();

      // Verificar operaciones registradas
      expect(summary.operations['fullflow.deduplication']).toBe(1);
      expect(summary.operations['fullflow.updateSession']).toBe(1);

      // Verificar timings
      expect(summary.timings['fullflow.deduplication']).toBeDefined();
      expect(summary.timings['fullflow.updateSession']).toBeDefined();
    });
  });

  describe('FASE 1: Validación de Integridad de Datos', () => {
    it('debe preservar datos temporales durante actualización con optimistic locking', async () => {
      const telefono = '+521234567890';
      const datosTemp = JSON.stringify({ marca: 'Toyota', modelo: 'Corolla' });

      mockQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const result = await SesionRepository.updateSession(
        telefono,
        'VEHICULO_MARCA',
        datosTemp,
        null,
        0 // expectedVersion
      );

      expect(result).toBe(true);

      // Verificar que el UPDATE incluye Version check
      const query = mockQuery.mock.calls[0][0];
      expect(query).toContain('Version');
      expect(query).toContain('ISNULL(Version, 0) = @expectedVersion');
      expect(query).toContain('Version = ISNULL(Version, 0) + 1');
    });
  });
});
