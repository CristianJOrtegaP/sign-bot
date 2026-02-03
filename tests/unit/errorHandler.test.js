/**
 * Tests - Error Handler
 * Pruebas del manejador centralizado de errores
 */

jest.mock('../../core/config', () => require('../__mocks__/config'));

const {
    AppError,
    DatabaseError,
    ValidationError,
    ExternalServiceError,
    SessionError,
    EquipoNotFoundError,
    RateLimitError,
    ConfigurationError,
    logger,
    LogLevel,
    handleError,
    getUserFriendlyMessage,
    withErrorHandling
} = require('../../core/services/infrastructure/errorHandler');

describe('ErrorHandler', () => {
    describe('Custom Error Classes', () => {
        describe('AppError', () => {
            test('debe crear error con propiedades correctas', () => {
                const error = new AppError('Test error', 'TEST_CODE', 400, true);

                expect(error.message).toBe('Test error');
                expect(error.code).toBe('TEST_CODE');
                expect(error.statusCode).toBe(400);
                expect(error.isOperational).toBe(true);
                expect(error.timestamp).toBeDefined();
                expect(error.name).toBe('AppError');
            });

            test('debe serializar a JSON correctamente', () => {
                const error = new AppError('Test error', 'TEST_CODE', 400);
                const json = error.toJSON();

                expect(json.name).toBe('AppError');
                expect(json.message).toBe('Test error');
                expect(json.code).toBe('TEST_CODE');
                expect(json.statusCode).toBe(400);
                expect(json.timestamp).toBeDefined();
            });

            test('debe capturar stack trace', () => {
                const error = new AppError('Test error');
                expect(error.stack).toBeDefined();
                expect(error.stack).toContain('AppError');
            });
        });

        describe('DatabaseError', () => {
            test('debe crear error de base de datos', () => {
                const originalError = new Error('Connection failed');
                const error = new DatabaseError('DB error', originalError, 'INSERT');

                expect(error.code).toBe('DATABASE_ERROR');
                expect(error.statusCode).toBe(500);
                expect(error.operation).toBe('INSERT');
                expect(error.originalError).toBe('Connection failed');
            });

            test('debe manejar null como originalError', () => {
                const error = new DatabaseError('DB error', null, 'SELECT');

                expect(error.originalError).toBeNull();
            });
        });

        describe('ValidationError', () => {
            test('debe crear error de validación', () => {
                const error = new ValidationError('Invalid input', 'email');

                expect(error.code).toBe('VALIDATION_ERROR');
                expect(error.statusCode).toBe(400);
                expect(error.field).toBe('email');
            });
        });

        describe('ExternalServiceError', () => {
            test('debe crear error de servicio externo', () => {
                const originalError = {
                    message: 'API timeout',
                    response: { data: { error: 'timeout' } }
                };
                const error = new ExternalServiceError('WhatsApp error', 'WhatsApp', originalError);

                expect(error.code).toBe('EXTERNAL_SERVICE_ERROR');
                expect(error.statusCode).toBe(502);
                expect(error.service).toBe('WhatsApp');
                expect(error.responseData).toEqual({ error: 'timeout' });
            });
        });

        describe('SessionError', () => {
            test('debe crear error de sesión', () => {
                const error = new SessionError('Session expired', '+5215512345678');

                expect(error.code).toBe('SESSION_ERROR');
                expect(error.telefono).toBe('+5215512345678');
            });
        });

        describe('EquipoNotFoundError', () => {
            test('debe crear error de equipo no encontrado', () => {
                const error = new EquipoNotFoundError('1234567');

                expect(error.code).toBe('EQUIPO_NOT_FOUND');
                expect(error.statusCode).toBe(404);
                expect(error.codigoSAP).toBe('1234567');
                expect(error.message).toContain('1234567');
            });
        });

        describe('RateLimitError', () => {
            test('debe crear error de rate limit', () => {
                const error = new RateLimitError('+5215512345678', 'Too many requests');

                expect(error.code).toBe('RATE_LIMIT_ERROR');
                expect(error.statusCode).toBe(429);
                expect(error.telefono).toBe('+5215512345678');
            });
        });

        describe('ConfigurationError', () => {
            test('debe crear error de configuración', () => {
                const error = new ConfigurationError('Missing API key', 'WHATSAPP_TOKEN');

                expect(error.code).toBe('CONFIGURATION_ERROR');
                expect(error.isOperational).toBe(false);
                expect(error.configKey).toBe('WHATSAPP_TOKEN');
            });
        });
    });

    describe('Logger', () => {
        let consoleSpy;

        beforeEach(() => {
            consoleSpy = {
                log: jest.spyOn(console, 'log').mockImplementation(),
                warn: jest.spyOn(console, 'warn').mockImplementation(),
                error: jest.spyOn(console, 'error').mockImplementation()
            };
        });

        afterEach(() => {
            consoleSpy.log.mockRestore();
            consoleSpy.warn.mockRestore();
            consoleSpy.error.mockRestore();
        });

        test('logger.info debe formatear correctamente', () => {
            logger.info('Test message', { key: 'value' });

            expect(consoleSpy.log).toHaveBeenCalled();
            const logCall = consoleSpy.log.mock.calls[0][0];
            expect(logCall).toContain('[INFO]');
            expect(logCall).toContain('Test message');
            expect(logCall).toContain('"key":"value"');
        });

        test('logger.warn debe formatear correctamente', () => {
            logger.warn('Warning message');

            expect(consoleSpy.warn).toHaveBeenCalled();
            const logCall = consoleSpy.warn.mock.calls[0][0];
            expect(logCall).toContain('[WARN]');
            expect(logCall).toContain('⚠️');
        });

        test('logger.error debe incluir información del error', () => {
            const error = new AppError('Test error', 'TEST_CODE');
            logger.error('Error occurred', error, { context: 'test' });

            expect(consoleSpy.error).toHaveBeenCalled();
            const logCall = consoleSpy.error.mock.calls[0][0];
            expect(logCall).toContain('[ERROR]');
            expect(logCall).toContain('❌');
            expect(logCall).toContain('errorName');
        });

        test('logger.database debe formatear operaciones de BD', () => {
            logger.database('INSERT', true, { table: 'Reportes' });

            expect(consoleSpy.log).toHaveBeenCalled();
            const logCall = consoleSpy.log.mock.calls[0][0];
            expect(logCall).toContain('[DB]');
            expect(logCall).toContain('INSERT');
        });

        test('logger.whatsapp debe formatear operaciones de WhatsApp', () => {
            logger.whatsapp('sendText', true, { to: '+5215512345678' });

            expect(consoleSpy.log).toHaveBeenCalled();
            const logCall = consoleSpy.log.mock.calls[0][0];
            expect(logCall).toContain('[WhatsApp]');
        });

        test('logger.ai debe formatear operaciones de IA', () => {
            logger.ai('detectIntent', { intent: 'SALUDO' });

            expect(consoleSpy.log).toHaveBeenCalled();
            const logCall = consoleSpy.log.mock.calls[0][0];
            expect(logCall).toContain('[AI]');
            expect(logCall).toContain('🤖');
        });

        test('logger.debug solo debe loguear fuera de producción', () => {
            const originalEnv = process.env.NODE_ENV;

            process.env.NODE_ENV = 'production';
            logger.debug('Debug message');
            expect(consoleSpy.log).not.toHaveBeenCalled();

            process.env.NODE_ENV = 'development';
            logger.debug('Debug message');
            expect(consoleSpy.log).toHaveBeenCalled();

            process.env.NODE_ENV = originalEnv;
        });
    });

    describe('handleError', () => {
        test('debe manejar error operacional', () => {
            const error = new ValidationError('Invalid input');
            const result = handleError(error, 'test_operation');

            expect(result.handled).toBe(true);
            expect(result.shouldRetry).toBe(false);
            expect(result.userMessage).toBeDefined();
        });

        test('debe marcar error de conexión como reintentable', () => {
            const error = new Error('Connection reset');
            error.code = 'ECONNRESET';
            const result = handleError(error, 'test_operation');

            expect(result.shouldRetry).toBe(true);
        });

        test('debe manejar error inesperado', () => {
            const error = new Error('Unexpected error');
            const result = handleError(error, 'test_operation');

            expect(result.handled).toBe(false);
            expect(result.userMessage).toContain('inesperado');
        });
    });

    describe('getUserFriendlyMessage', () => {
        test('debe retornar mensaje para ValidationError', () => {
            const error = new ValidationError('El código es inválido');
            expect(getUserFriendlyMessage(error)).toBe('El código es inválido');
        });

        test('debe retornar mensaje para EquipoNotFoundError', () => {
            const error = new EquipoNotFoundError('1234567');
            expect(getUserFriendlyMessage(error)).toContain('1234567');
        });

        test('debe retornar mensaje para RateLimitError', () => {
            const error = new RateLimitError('+52', 'Demasiados mensajes');
            expect(getUserFriendlyMessage(error)).toBe('Demasiados mensajes');
        });

        test('debe retornar mensaje genérico para ExternalServiceError', () => {
            const error = new ExternalServiceError('API error', 'WhatsApp');
            expect(getUserFriendlyMessage(error)).toContain('problemas técnicos');
        });

        test('debe retornar mensaje genérico para DatabaseError', () => {
            const error = new DatabaseError('DB error');
            expect(getUserFriendlyMessage(error)).toContain('completar la operación');
        });

        test('debe retornar mensaje genérico para errores desconocidos', () => {
            const error = new Error('Unknown');
            expect(getUserFriendlyMessage(error)).toContain('intenta de nuevo');
        });
    });

    describe('withErrorHandling', () => {
        test('debe ejecutar función exitosamente', async () => {
            const result = await withErrorHandling(
                async () => 'success',
                { operation: 'test' }
            );

            expect(result).toBe('success');
        });

        test('debe retornar defaultValue en caso de error', async () => {
            const result = await withErrorHandling(
                async () => { throw new Error('Test'); },
                { operation: 'test', defaultValue: 'default' }
            );

            expect(result).toBe('default');
        });

        test('debe relanzar error si rethrow es true', async () => {
            await expect(
                withErrorHandling(
                    async () => { throw new Error('Test'); },
                    { operation: 'test', rethrow: true }
                )
            ).rejects.toThrow('Test');
        });
    });

    describe('LogLevel', () => {
        test('debe tener todos los niveles de log', () => {
            expect(LogLevel.DEBUG).toBe('DEBUG');
            expect(LogLevel.INFO).toBe('INFO');
            expect(LogLevel.WARN).toBe('WARN');
            expect(LogLevel.ERROR).toBe('ERROR');
        });
    });
});
