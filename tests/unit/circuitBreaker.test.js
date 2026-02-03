/**
 * Tests para CircuitBreaker
 * Valida el patron circuit breaker para proteccion de servicios externos
 */

describe('CircuitBreaker', () => {
    let circuitBreaker;
    let CircuitBreaker;
    let CircuitBreakerOpenError;
    let STATES;

    beforeEach(() => {
        jest.resetModules();
        const cb = require('../../core/services/infrastructure/circuitBreaker');
        circuitBreaker = cb;
        CircuitBreaker = cb.CircuitBreaker;
        CircuitBreakerOpenError = cb.CircuitBreakerOpenError;
        STATES = cb.STATES;

        // Reset all breakers
        cb.resetAll();
    });

    describe('CircuitBreaker class', () => {
        it('debe iniciar en estado CLOSED', () => {
            const breaker = new CircuitBreaker('test-service');
            const stats = breaker.getStats();
            expect(stats.state).toBe(STATES.CLOSED);
        });

        it('debe permitir ejecucion en estado CLOSED', () => {
            const breaker = new CircuitBreaker('test-service');
            const check = breaker.canExecute();
            expect(check.allowed).toBe(true);
        });

        it('debe abrir despues de alcanzar umbral de fallos', () => {
            const breaker = new CircuitBreaker('test-service', { failureThreshold: 3 });

            // Registrar fallos
            breaker.recordFailure(new Error('Test error 1'));
            breaker.recordFailure(new Error('Test error 2'));
            breaker.recordFailure(new Error('Test error 3'));

            const stats = breaker.getStats();
            expect(stats.state).toBe(STATES.OPEN);
        });

        it('debe rechazar ejecucion en estado OPEN', () => {
            const breaker = new CircuitBreaker('test-service', { failureThreshold: 2 });

            breaker.recordFailure(new Error('Error 1'));
            breaker.recordFailure(new Error('Error 2'));

            const check = breaker.canExecute();
            expect(check.allowed).toBe(false);
            expect(check.reason).toContain('Circuit open');
        });

        it('debe resetear contador de fallos con exito', () => {
            const breaker = new CircuitBreaker('test-service', { failureThreshold: 3 });

            breaker.recordFailure(new Error('Error 1'));
            breaker.recordFailure(new Error('Error 2'));
            breaker.recordSuccess();

            // Verificar que aun esta cerrado y contador reseteado
            const stats = breaker.getStats();
            expect(stats.state).toBe(STATES.CLOSED);
            expect(stats.failures).toBe(0);
        });

        it('debe transicionar a HALF_OPEN despues del timeout', async () => {
            const breaker = new CircuitBreaker('test-service', {
                failureThreshold: 2,
                timeout: 50 // 50ms para test rapido
            });

            breaker.recordFailure(new Error('Error 1'));
            breaker.recordFailure(new Error('Error 2'));
            expect(breaker.getStats().state).toBe(STATES.OPEN);

            // Esperar timeout
            await new Promise(resolve => { setTimeout(resolve, 60); });

            const check = breaker.canExecute();
            expect(check.allowed).toBe(true);
            expect(breaker.getStats().state).toBe(STATES.HALF_OPEN);
        });

        it('debe cerrar desde HALF_OPEN despues de exitos suficientes', async () => {
            const breaker = new CircuitBreaker('test-service', {
                failureThreshold: 2,
                successThreshold: 2,
                timeout: 50
            });

            // Abrir el circuit
            breaker.recordFailure(new Error('Error 1'));
            breaker.recordFailure(new Error('Error 2'));

            // Esperar timeout para HALF_OPEN
            await new Promise(resolve => { setTimeout(resolve, 60); });
            breaker.canExecute(); // Transiciona a HALF_OPEN

            // Registrar exitos
            breaker.recordSuccess();
            breaker.recordSuccess();

            expect(breaker.getStats().state).toBe(STATES.CLOSED);
        });

        it('debe reabrir desde HALF_OPEN con un fallo', async () => {
            const breaker = new CircuitBreaker('test-service', {
                failureThreshold: 2,
                timeout: 50
            });

            // Abrir el circuit
            breaker.recordFailure(new Error('Error 1'));
            breaker.recordFailure(new Error('Error 2'));

            // Esperar timeout para HALF_OPEN
            await new Promise(resolve => { setTimeout(resolve, 60); });
            breaker.canExecute(); // Transiciona a HALF_OPEN

            // Registrar fallo en HALF_OPEN
            breaker.recordFailure(new Error('Error in HALF_OPEN'));

            expect(breaker.getStats().state).toBe(STATES.OPEN);
        });
    });

    describe('execute method', () => {
        it('debe ejecutar funcion y retornar resultado', async () => {
            const breaker = new CircuitBreaker('test-service');
            const result = await breaker.execute(() => Promise.resolve('success'));
            expect(result).toBe('success');
        });

        it('debe registrar exito automaticamente', async () => {
            const breaker = new CircuitBreaker('test-service');
            await breaker.execute(() => Promise.resolve('success'));
            expect(breaker.getStats().successfulCalls).toBe(1);
        });

        it('debe registrar fallo automaticamente', async () => {
            const breaker = new CircuitBreaker('test-service');
            await expect(
                breaker.execute(() => Promise.reject(new Error('fail')))
            ).rejects.toThrow('fail');
            expect(breaker.getStats().failedCalls).toBe(1);
        });

        it('debe usar fallback cuando circuit esta abierto', async () => {
            const breaker = new CircuitBreaker('test-service', { failureThreshold: 1 });

            // Abrir circuit
            breaker.recordFailure(new Error('Error'));

            const result = await breaker.execute(
                () => Promise.resolve('main'),
                () => 'fallback'
            );

            expect(result).toBe('fallback');
        });

        it('debe usar fallback cuando funcion falla', async () => {
            const breaker = new CircuitBreaker('test-service');

            const result = await breaker.execute(
                () => Promise.reject(new Error('fail')),
                () => 'fallback'
            );

            expect(result).toBe('fallback');
        });

        it('debe lanzar CircuitBreakerOpenError sin fallback', async () => {
            const breaker = new CircuitBreaker('test-service', { failureThreshold: 1 });
            breaker.recordFailure(new Error('Error'));

            await expect(
                breaker.execute(() => Promise.resolve('main'))
            ).rejects.toThrow(CircuitBreakerOpenError);
        });
    });

    describe('getBreaker', () => {
        it('debe retornar mismo breaker para mismo nombre', () => {
            const breaker1 = circuitBreaker.getBreaker('same-service');
            const breaker2 = circuitBreaker.getBreaker('same-service');
            expect(breaker1).toBe(breaker2);
        });

        it('debe crear nuevo breaker para nombre diferente', () => {
            const breaker1 = circuitBreaker.getBreaker('service-1');
            const breaker2 = circuitBreaker.getBreaker('service-2');
            expect(breaker1).not.toBe(breaker2);
        });

        it('debe aplicar configuracion custom', () => {
            const breaker = circuitBreaker.getBreaker('custom-service', {
                failureThreshold: 10
            });
            const stats = breaker.getStats();
            expect(stats.config.failureThreshold).toBe(10);
        });
    });

    describe('getAllStats', () => {
        it('debe retornar stats de todos los breakers', () => {
            circuitBreaker.getBreaker('service-a');
            circuitBreaker.getBreaker('service-b');

            const stats = circuitBreaker.getAllStats();
            expect(stats).toHaveProperty('service-a');
            expect(stats).toHaveProperty('service-b');
        });
    });

    describe('SERVICES predefinidos', () => {
        it('debe tener breaker para WhatsApp', () => {
            const breaker = circuitBreaker.getBreaker(circuitBreaker.SERVICES.WHATSAPP);
            expect(breaker).toBeDefined();
            expect(breaker.getStats().config.failureThreshold).toBe(3);
        });

        it('debe tener breaker para Gemini', () => {
            const breaker = circuitBreaker.getBreaker(circuitBreaker.SERVICES.GEMINI);
            expect(breaker).toBeDefined();
        });

        it('debe tener breaker para Azure OpenAI', () => {
            const breaker = circuitBreaker.getBreaker(circuitBreaker.SERVICES.AZURE_OPENAI);
            expect(breaker).toBeDefined();
        });

        it('debe tener breaker para Database', () => {
            const breaker = circuitBreaker.getBreaker(circuitBreaker.SERVICES.DATABASE);
            expect(breaker).toBeDefined();
            // Timeout debe ser > requestTimeout (30s) para evitar falsos positivos
            expect(breaker.getStats().config.timeout).toBe(35000);
        });
    });

    describe('resetAll', () => {
        it('debe resetear todos los breakers', () => {
            const breaker = circuitBreaker.getBreaker('test-reset', { failureThreshold: 2 });

            // Abrir circuit
            breaker.recordFailure(new Error('Error 1'));
            breaker.recordFailure(new Error('Error 2'));
            expect(breaker.getStats().state).toBe(STATES.OPEN);

            // Reset
            circuitBreaker.resetAll();
            expect(breaker.getStats().state).toBe(STATES.CLOSED);
        });
    });
});
