/**
 * Tests para Logger Integration con Correlation IDs
 * Valida que el logger incluya correlation IDs automáticamente
 */

describe('Logger Integration', () => {
    let logger;
    let correlation;
    let consoleSpy;

    beforeEach(() => {
        jest.resetModules();
        correlation = require('../../core/services/infrastructure/correlationService');
        const errorHandler = require('../../core/services/infrastructure/errorHandler');
        logger = errorHandler.logger;

        // Spy en console.log para capturar salida
        consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('logger sin contexto de correlacion', () => {
        it('debe formatear logs sin correlation ID', () => {
            logger.info('Test message');

            expect(consoleSpy).toHaveBeenCalled();
            const logOutput = consoleSpy.mock.calls[0][0];
            expect(logOutput).toContain('Test message');
            expect(logOutput).toContain('[INFO]');
        });
    });

    describe('logger con contexto de correlacion', () => {
        it('debe incluir correlation ID en logs dentro de contexto', async () => {
            const customId = 'TEST-CORR-123';

            await correlation.runWithCorrelation(async () => {
                logger.info('Test message with correlation');
            }, { correlationId: customId });

            expect(consoleSpy).toHaveBeenCalled();
            const logOutput = consoleSpy.mock.calls[0][0];
            expect(logOutput).toContain(customId);
            expect(logOutput).toContain('Test message with correlation');
        });

        it('debe incluir correlation ID en el contexto JSON', async () => {
            const customId = 'TEST-CORR-456';

            await correlation.runWithCorrelation(async () => {
                logger.info('Test with context', { extra: 'data' });
            }, { correlationId: customId });

            expect(consoleSpy).toHaveBeenCalled();
            const logOutput = consoleSpy.mock.calls[0][0];
            expect(logOutput).toContain(customId);
            expect(logOutput).toContain('"extra":"data"');
        });
    });

    describe('logger.withPrefix', () => {
        it('debe crear logger con prefijo', () => {
            const prefixedLogger = logger.withPrefix('TestModule');
            prefixedLogger.info('Prefixed message');

            expect(consoleSpy).toHaveBeenCalled();
            const logOutput = consoleSpy.mock.calls[0][0];
            expect(logOutput).toContain('[TestModule]');
            expect(logOutput).toContain('Prefixed message');
        });

        it('debe mantener correlation ID con prefijo', async () => {
            const customId = 'PREFIX-CORR-789';

            await correlation.runWithCorrelation(async () => {
                const prefixedLogger = logger.withPrefix('TestModule');
                prefixedLogger.info('Prefixed with correlation');
            }, { correlationId: customId });

            expect(consoleSpy).toHaveBeenCalled();
            const logOutput = consoleSpy.mock.calls[0][0];
            expect(logOutput).toContain(customId);
            expect(logOutput).toContain('[TestModule]');
        });
    });

    describe('metodos especializados del logger', () => {
        it('logger.database debe formatear correctamente', () => {
            logger.database('INSERT sesion', true, { telefono: '123' });

            expect(consoleSpy).toHaveBeenCalled();
            const logOutput = consoleSpy.mock.calls[0][0];
            expect(logOutput).toContain('[DB]');
            expect(logOutput).toContain('INSERT sesion');
        });

        it('logger.whatsapp debe formatear correctamente', () => {
            logger.whatsapp('sendText', true, { to: '5218112345678' });

            expect(consoleSpy).toHaveBeenCalled();
            const logOutput = consoleSpy.mock.calls[0][0];
            expect(logOutput).toContain('[WhatsApp]');
            expect(logOutput).toContain('sendText');
        });

        it('logger.ai debe formatear correctamente', () => {
            logger.ai('detectIntent', { intent: 'SALUDO' });

            expect(consoleSpy).toHaveBeenCalled();
            const logOutput = consoleSpy.mock.calls[0][0];
            expect(logOutput).toContain('[AI]');
            expect(logOutput).toContain('detectIntent');
        });

        it('logger.vision debe formatear correctamente', () => {
            logger.vision('OCR completado', { linesFound: 5 });

            expect(consoleSpy).toHaveBeenCalled();
            const logOutput = consoleSpy.mock.calls[0][0];
            expect(logOutput).toContain('[Vision]');
            expect(logOutput).toContain('OCR completado');
        });

        it('logger.metrics debe formatear correctamente', () => {
            logger.metrics('Timer ended', { duration: 100 });

            expect(consoleSpy).toHaveBeenCalled();
            const logOutput = consoleSpy.mock.calls[0][0];
            expect(logOutput).toContain('[Metrics]');
            expect(logOutput).toContain('Timer ended');
        });

        it('logger.security debe formatear correctamente', () => {
            logger.security('Signature verified');

            expect(consoleSpy).toHaveBeenCalled();
            const logOutput = consoleSpy.mock.calls[0][0];
            expect(logOutput).toContain('[Security]');
            expect(logOutput).toContain('Signature verified');
        });
    });

    describe('niveles de log', () => {
        it('logger.debug no debe loguear en produccion', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            // Re-require para aplicar cambio de env
            jest.resetModules();
            const { logger: prodLogger } = require('../../core/services/infrastructure/errorHandler');

            prodLogger.debug('Debug message');
            expect(consoleSpy).not.toHaveBeenCalled();

            process.env.NODE_ENV = originalEnv;
        });

        it('logger.debug debe loguear en desarrollo', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';

            logger.debug('Debug message');
            expect(consoleSpy).toHaveBeenCalled();

            process.env.NODE_ENV = originalEnv;
        });
    });
});
