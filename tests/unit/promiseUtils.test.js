/**
 * Tests para Promise Utilities (Timeouts y Fallbacks)
 * Valida withTimeout, withTimeoutAndFallback, allWithTimeout, etc.
 */

const {
    withTimeout,
    withTimeoutAndFallback,
    withTimeoutAndFallbackFn,
    allWithTimeout,
    allWithTimeoutAndFallback,
    delay,
    TimeoutError
} = require('../../core/utils/promises');

describe('Promise Utilities', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('TimeoutError', () => {
        it('debe crear un error con los campos correctos', () => {
            const error = new TimeoutError('fetchData', 3000);

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(TimeoutError);
            expect(error.name).toBe('TimeoutError');
            expect(error.operationName).toBe('fetchData');
            expect(error.timeoutMs).toBe(3000);
            expect(error.isTimeout).toBe(true);
            expect(error.message).toContain('fetchData');
            expect(error.message).toContain('3000ms');
        });
    });

    describe('withTimeout', () => {
        it('debe ejecutar promesa exitosa sin timeout', async () => {
            const promise = Promise.resolve('success');

            const result = await withTimeout(promise, 1000, 'testOp');

            expect(result).toBe('success');
        });

        it('debe lanzar TimeoutError si promesa excede timeout', async () => {
            const promise = new Promise((resolve) => {
                setTimeout(() => resolve('too late'), 2000);
            });

            const timeoutPromise = withTimeout(promise, 1000, 'slowOperation');

            // Avanzar 1000ms (timeout)
            jest.advanceTimersByTime(1000);

            await expect(timeoutPromise).rejects.toThrow(TimeoutError);
            await expect(timeoutPromise).rejects.toThrow('slowOperation');
            await expect(timeoutPromise).rejects.toThrow('1000ms');
        });

        it('debe resolver antes del timeout si promesa es rapida', async () => {
            const promise = new Promise((resolve) => {
                setTimeout(() => resolve('fast'), 500);
            });

            const timeoutPromise = withTimeout(promise, 2000, 'fastOperation');

            jest.advanceTimersByTime(500);

            const result = await timeoutPromise;
            expect(result).toBe('fast');
        });

        it('debe propagar error si promesa falla antes del timeout', async () => {
            const promise = Promise.reject(new Error('Operation failed'));

            const timeoutPromise = withTimeout(promise, 1000, 'failingOp');

            await expect(timeoutPromise).rejects.toThrow('Operation failed');
        });

        it('debe limpiar timer si promesa se resuelve antes del timeout', async () => {
            const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

            const promise = Promise.resolve('quick');
            await withTimeout(promise, 5000, 'quickOp');

            expect(clearTimeoutSpy).toHaveBeenCalled();

            clearTimeoutSpy.mockRestore();
        });

        it('debe validar que el primer parametro es una promesa', async () => {
            await expect(
                withTimeout('not a promise', 1000, 'test')
            ).rejects.toThrow('El primer parámetro debe ser una Promise');

            await expect(
                withTimeout(null, 1000, 'test')
            ).rejects.toThrow('El primer parámetro debe ser una Promise');

            await expect(
                withTimeout(123, 1000, 'test')
            ).rejects.toThrow('El primer parámetro debe ser una Promise');
        });

        it('debe validar que timeoutMs es un numero positivo', async () => {
            const promise = Promise.resolve('test');

            await expect(
                withTimeout(promise, -100, 'test')
            ).rejects.toThrow('timeoutMs debe ser un número positivo');

            await expect(
                withTimeout(promise, 0, 'test')
            ).rejects.toThrow('timeoutMs debe ser un número positivo');

            await expect(
                withTimeout(promise, 'invalid', 'test')
            ).rejects.toThrow('timeoutMs debe ser un número positivo');
        });
    });

    describe('withTimeoutAndFallback', () => {
        it('debe devolver resultado de promesa exitosa', async () => {
            const promise = Promise.resolve('success');

            const result = await withTimeoutAndFallback(
                promise,
                1000,
                'fallback',
                'testOp'
            );

            expect(result).toBe('success');
        });

        it('debe devolver fallback si promesa excede timeout', async () => {
            const promise = new Promise((resolve) => {
                setTimeout(() => resolve('too late'), 2000);
            });

            const timeoutPromise = withTimeoutAndFallback(
                promise,
                1000,
                'fallback value',
                'slowOp'
            );

            jest.advanceTimersByTime(1000);

            const result = await timeoutPromise;
            expect(result).toBe('fallback value');
        });

        it('debe devolver fallback si promesa falla', async () => {
            const promise = Promise.reject(new Error('Operation failed'));

            const result = await withTimeoutAndFallback(
                promise,
                1000,
                'fallback on error',
                'failingOp'
            );

            expect(result).toBe('fallback on error');
        });

        it('debe aceptar objeto como fallback', async () => {
            const promise = Promise.reject(new Error('Failed'));

            const fallbackObj = { intencion: 'REPORTAR_FALLA', confianza: 0 };
            const result = await withTimeoutAndFallback(
                promise,
                1000,
                fallbackObj,
                'aiDetection'
            );

            expect(result).toEqual(fallbackObj);
        });

        it('debe aceptar array como fallback', async () => {
            const promise = Promise.reject(new Error('Failed'));

            const fallbackArray = ['default', 'values'];
            const result = await withTimeoutAndFallback(
                promise,
                1000,
                fallbackArray,
                'extraction'
            );

            expect(result).toEqual(fallbackArray);
        });

        it('NUNCA debe lanzar error (siempre devuelve fallback)', async () => {
            const promise = Promise.reject(new Error('Critical error'));

            // No debe lanzar error
            const result = await withTimeoutAndFallback(
                promise,
                1000,
                null,
                'criticalOp'
            );

            expect(result).toBe(null);
        });
    });

    describe('withTimeoutAndFallbackFn', () => {
        it('debe ejecutar funcion de fallback en timeout', async () => {
            const promise = new Promise((resolve) => {
                setTimeout(() => resolve('too late'), 2000);
            });

            const fallbackFn = jest.fn().mockReturnValue('computed fallback');

            const timeoutPromise = withTimeoutAndFallbackFn(
                promise,
                1000,
                fallbackFn,
                'slowOp'
            );

            jest.advanceTimersByTime(1000);

            const result = await timeoutPromise;
            expect(result).toBe('computed fallback');
            expect(fallbackFn).toHaveBeenCalledWith(expect.any(TimeoutError));
        });

        it('debe ejecutar funcion de fallback async', async () => {
            const promise = Promise.reject(new Error('Failed'));

            const fallbackFn = jest.fn().mockResolvedValue('async fallback');

            const result = await withTimeoutAndFallbackFn(
                promise,
                1000,
                fallbackFn,
                'failOp'
            );

            expect(result).toBe('async fallback');
            expect(fallbackFn).toHaveBeenCalled();
        });

        it('debe pasar error a funcion de fallback', async () => {
            const error = new Error('Specific error');
            const promise = Promise.reject(error);

            const fallbackFn = jest.fn((err) => {
                return `fallback for: ${err.message}`;
            });

            const result = await withTimeoutAndFallbackFn(
                promise,
                1000,
                fallbackFn,
                'errorOp'
            );

            expect(result).toBe('fallback for: Specific error');
            expect(fallbackFn).toHaveBeenCalledWith(error);
        });

        it('debe devolver resultado de promesa exitosa sin llamar fallback', async () => {
            const promise = Promise.resolve('success');

            const fallbackFn = jest.fn().mockReturnValue('fallback');

            const result = await withTimeoutAndFallbackFn(
                promise,
                1000,
                fallbackFn,
                'successOp'
            );

            expect(result).toBe('success');
            expect(fallbackFn).not.toHaveBeenCalled();
        });
    });

    describe('allWithTimeout', () => {
        it('debe ejecutar multiples promesas con timeouts individuales', async () => {
            const operations = [
                { promise: Promise.resolve('result1'), timeout: 1000, name: 'op1' },
                { promise: Promise.resolve('result2'), timeout: 2000, name: 'op2' },
                { promise: Promise.resolve('result3'), timeout: 3000, name: 'op3' }
            ];

            const results = await allWithTimeout(operations);

            expect(results).toEqual(['result1', 'result2', 'result3']);
        });

        it('debe fallar si alguna promesa excede su timeout', async () => {
            const operations = [
                { promise: Promise.resolve('result1'), timeout: 1000, name: 'op1' },
                {
                    promise: new Promise((resolve) => setTimeout(() => resolve('late'), 5000)),
                    timeout: 1000,
                    name: 'slowOp'
                }
            ];

            const promise = allWithTimeout(operations);

            jest.advanceTimersByTime(1000);

            await expect(promise).rejects.toThrow(TimeoutError);
        });

        it('debe fallar si alguna promesa lanza error', async () => {
            const operations = [
                { promise: Promise.resolve('result1'), timeout: 1000, name: 'op1' },
                { promise: Promise.reject(new Error('Operation 2 failed')), timeout: 1000, name: 'op2' }
            ];

            await expect(allWithTimeout(operations)).rejects.toThrow('Operation 2 failed');
        });
    });

    describe('allWithTimeoutAndFallback', () => {
        it('debe ejecutar multiples promesas con fallbacks individuales', async () => {
            const operations = [
                { promise: Promise.resolve('result1'), timeout: 1000, fallback: 'fallback1', name: 'op1' },
                { promise: Promise.resolve('result2'), timeout: 2000, fallback: 'fallback2', name: 'op2' }
            ];

            const results = await allWithTimeoutAndFallback(operations);

            expect(results).toEqual(['result1', 'result2']);
        });

        it('debe devolver fallback para promesas que excedan timeout', async () => {
            jest.useRealTimers(); // Usar timers reales para este test

            const operations = [
                { promise: Promise.resolve('result1'), timeout: 100, fallback: 'fallback1', name: 'op1' },
                {
                    promise: new Promise((resolve) => setTimeout(() => resolve('late'), 500)),
                    timeout: 50,
                    fallback: 'fallback2',
                    name: 'slowOp'
                }
            ];

            const results = await allWithTimeoutAndFallback(operations);
            expect(results).toEqual(['result1', 'fallback2']);

            jest.useFakeTimers(); // Volver a fake timers
        });

        it('debe devolver fallback para promesas que fallen', async () => {
            const operations = [
                { promise: Promise.resolve('result1'), timeout: 1000, fallback: 'fallback1', name: 'op1' },
                { promise: Promise.reject(new Error('Failed')), timeout: 1000, fallback: 'fallback2', name: 'op2' }
            ];

            const results = await allWithTimeoutAndFallback(operations);

            expect(results).toEqual(['result1', 'fallback2']);
        });

        it('NUNCA debe fallar (siempre devuelve array con resultados o fallbacks)', async () => {
            jest.useRealTimers(); // Usar timers reales para este test

            const operations = [
                { promise: Promise.reject(new Error('Error 1')), timeout: 100, fallback: 'fallback1', name: 'op1' },
                {
                    promise: new Promise((resolve) => setTimeout(() => resolve('late'), 500)),
                    timeout: 50,
                    fallback: 'fallback2',
                    name: 'op2'
                },
                { promise: Promise.resolve('success'), timeout: 100, fallback: 'fallback3', name: 'op3' }
            ];

            const results = await allWithTimeoutAndFallback(operations);
            expect(results).toEqual(['fallback1', 'fallback2', 'success']);

            jest.useFakeTimers(); // Volver a fake timers
        });
    });

    describe('delay', () => {
        it('debe resolver despues del tiempo especificado', async () => {
            const promise = delay(1000);

            jest.advanceTimersByTime(999);
            expect(jest.getTimerCount()).toBeGreaterThan(0);

            jest.advanceTimersByTime(1);
            await promise;
        });

        it('debe aceptar delay de 0ms', async () => {
            const promise = delay(0);
            jest.advanceTimersByTime(0);
            await promise;
        });
    });

    describe('Casos de uso reales', () => {
        it('debe proteger llamada a AI con timeout y fallback', async () => {
            // Simular llamada a AI lenta
            const aiCall = new Promise((resolve) => {
                setTimeout(() => resolve({ intencion: 'REPORTAR_FALLA', confianza: 0.95 }), 5000);
            });

            const fallback = { intencion: 'REPORTAR_FALLA', confianza: 0, metodo: 'fallback' };

            const promise = withTimeoutAndFallback(
                aiCall,
                3000,
                fallback,
                'detectIntent'
            );

            jest.advanceTimersByTime(3000);

            const result = await promise;
            expect(result).toEqual(fallback);
        });

        it('debe ejecutar extraccion y deteccion en paralelo con timeouts', async () => {
            const operations = [
                {
                    promise: Promise.resolve({ intencion: 'REPORTAR_FALLA', confianza: 0.9 }),
                    timeout: 3000,
                    fallback: { intencion: 'REPORTAR_FALLA', confianza: 0 },
                    name: 'detectIntent'
                },
                {
                    promise: Promise.resolve({ tipo_equipo: 'REFRIGERADOR', problema: 'no enfria' }),
                    timeout: 4000,
                    fallback: { datos_encontrados: [] },
                    name: 'extractData'
                }
            ];

            const [intent, extracted] = await allWithTimeoutAndFallback(operations);

            expect(intent.intencion).toBe('REPORTAR_FALLA');
            expect(extracted.tipo_equipo).toBe('REFRIGERADOR');
        });
    });
});
