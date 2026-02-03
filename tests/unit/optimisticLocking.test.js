/**
 * Tests para Optimistic Locking
 * Valida ConcurrencyError, retry logic y withSessionRetry
 */

const { ConcurrencyError } = require('../../core/errors');

// Mock de databaseService ANTES de importar retry
jest.mock('../../core/services/storage/databaseService', () => ({
    getSessionWithVersion: jest.fn()
}));

const { withRetry, withSessionRetry } = require('../../core/utils/retry');
const db = require('../../core/services/storage/databaseService');

describe('Optimistic Locking', () => {
    describe('ConcurrencyError', () => {
        it('debe crear un error con los campos correctos', () => {
            const error = new ConcurrencyError('+521234567890', 5, 'updateSession');

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(ConcurrencyError);
            expect(error.name).toBe('ConcurrencyError');
            expect(error.telefono).toBe('+521234567890');
            expect(error.expectedVersion).toBe(5);
            expect(error.operation).toBe('updateSession');
            expect(error.retryable).toBe(true);
            expect(error.statusCode).toBe(409);
            expect(error.message).toContain('Concurrency conflict');
            expect(error.message).toContain('+521234567890');
            expect(error.message).toContain('5');
        });

        it('debe marcar el error como operacional y retryable', () => {
            const error = new ConcurrencyError('+521234567890', 3);

            expect(error.isOperational).toBe(true);
            expect(error.retryable).toBe(true);
        });

        it('debe usar operacion "unknown" por defecto', () => {
            const error = new ConcurrencyError('+521234567890', 2);

            expect(error.operation).toBe('unknown');
        });
    });

    describe('withRetry', () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('debe ejecutar operacion exitosa sin retry', async () => {
            const operation = jest.fn().mockResolvedValue('success');

            const result = await withRetry(operation, { maxAttempts: 3 });

            expect(result).toBe('success');
            expect(operation).toHaveBeenCalledTimes(1);
        });

        it('debe reintentar cuando se lanza ConcurrencyError', async () => {
            const operation = jest.fn()
                .mockRejectedValueOnce(new ConcurrencyError('+521234567890', 0))
                .mockResolvedValueOnce('success');

            const result = await withRetry(operation, { maxAttempts: 3, baseDelayMs: 1 });

            expect(result).toBe('success');
            expect(operation).toHaveBeenCalledTimes(2);
        });

        it('debe reintentar hasta maxAttempts y luego fallar', async () => {
            const operation = jest.fn()
                .mockRejectedValue(new ConcurrencyError('+521234567890', 0));

            await expect(withRetry(operation, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow(ConcurrencyError);

            expect(operation).toHaveBeenCalledTimes(3);
        });

        it('debe aplicar exponential backoff con delays minimos', async () => {
            const operation = jest.fn()
                .mockRejectedValueOnce(new ConcurrencyError('+521234567890', 0))
                .mockRejectedValueOnce(new ConcurrencyError('+521234567890', 1))
                .mockResolvedValueOnce('success');

            const result = await withRetry(operation, {
                maxAttempts: 3,
                baseDelayMs: 1,
                maxDelayMs: 10
            });

            expect(result).toBe('success');
            expect(operation).toHaveBeenCalledTimes(3);
        });

        it('NO debe reintentar errores que no son ConcurrencyError', async () => {
            const operation = jest.fn()
                .mockRejectedValue(new Error('Generic error'));

            await expect(withRetry(operation, { maxAttempts: 3 })).rejects.toThrow('Generic error');

            expect(operation).toHaveBeenCalledTimes(1); // Solo 1 intento, no retry
        });

        it('debe permitir custom shouldRetry function', async () => {
            const operation = jest.fn()
                .mockRejectedValueOnce(new Error('RETRY_ME'))
                .mockResolvedValueOnce('success');

            const shouldRetry = (error) => error.message === 'RETRY_ME';

            const result = await withRetry(operation, {
                maxAttempts: 3,
                shouldRetry,
                baseDelayMs: 1
            });

            expect(result).toBe('success');
            expect(operation).toHaveBeenCalledTimes(2);
        });

        it('debe invocar callback onRetry con informacion correcta', async () => {
            const onRetry = jest.fn();
            const operation = jest.fn()
                .mockRejectedValueOnce(new ConcurrencyError('+521234567890', 0))
                .mockResolvedValueOnce('success');

            await withRetry(operation, {
                maxAttempts: 3,
                onRetry
            });

            expect(onRetry).toHaveBeenCalledTimes(1);
            expect(onRetry).toHaveBeenCalledWith(
                0, // attempt (0-indexed)
                expect.any(Number), // delayMs
                expect.any(ConcurrencyError)
            );
        });
    });

    describe('withSessionRetry', () => {
        beforeEach(() => {
            jest.clearAllMocks();
            db.getSessionWithVersion.mockClear();
        });

        it('debe obtener sesion con version y pasarla a la operacion', async () => {
            const telefono = '+521234567890';
            const session = { Estado: 'INICIO', Version: 5 };

            db.getSessionWithVersion.mockResolvedValue(session);

            const operation = jest.fn().mockResolvedValue('success');

            const result = await withSessionRetry(telefono, operation);

            expect(result).toBe('success');
            expect(db.getSessionWithVersion).toHaveBeenCalledWith(telefono);
            expect(operation).toHaveBeenCalledWith(session);
        });

        it('debe reintentar y obtener sesion actualizada en cada intento', async () => {
            const telefono = '+521234567890';

            // Primera llamada: Version=0, falla con ConcurrencyError
            // Segunda llamada: Version=1, éxito
            db.getSessionWithVersion
                .mockResolvedValueOnce({ Estado: 'INICIO', Version: 0 })
                .mockResolvedValueOnce({ Estado: 'INICIO', Version: 1 });

            const operation = jest.fn()
                .mockRejectedValueOnce(new ConcurrencyError(telefono, 0))
                .mockResolvedValueOnce('success');

            const result = await withSessionRetry(telefono, operation);

            expect(result).toBe('success');
            expect(db.getSessionWithVersion).toHaveBeenCalledTimes(2);
            expect(operation).toHaveBeenCalledTimes(2);
            expect(operation).toHaveBeenNthCalledWith(1, { Estado: 'INICIO', Version: 0 });
            expect(operation).toHaveBeenNthCalledWith(2, { Estado: 'INICIO', Version: 1 });
        });

        it('debe fallar despues de maxAttempts', async () => {
            const telefono = '+521234567890';

            db.getSessionWithVersion.mockResolvedValue({ Estado: 'INICIO', Version: 0 });

            const operation = jest.fn()
                .mockRejectedValue(new ConcurrencyError(telefono, 0));

            await expect(withSessionRetry(telefono, operation, { maxAttempts: 3 })).rejects.toThrow(ConcurrencyError);

            expect(db.getSessionWithVersion).toHaveBeenCalledTimes(3);
            expect(operation).toHaveBeenCalledTimes(3);
        });

        it('debe propagar errores que no son ConcurrencyError', async () => {
            const telefono = '+521234567890';

            db.getSessionWithVersion.mockResolvedValue({ Estado: 'INICIO', Version: 0 });

            const operation = jest.fn()
                .mockRejectedValue(new Error('Database error'));

            await expect(withSessionRetry(telefono, operation)).rejects.toThrow('Database error');

            expect(db.getSessionWithVersion).toHaveBeenCalledTimes(1);
            expect(operation).toHaveBeenCalledTimes(1);
        });
    });
});
