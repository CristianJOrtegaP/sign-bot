/**
 * Tests - Helpers/Utils
 * Pruebas de funciones de utilidad
 */

// Mock logger para evitar errores
jest.mock('../../core/services/infrastructure/errorHandler', () => ({
    logger: {
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        debug: jest.fn()
    }
}));

const helpers = require('../../core/utils/helpers');

describe('Helpers', () => {
    describe('safeParseJSON', () => {
        test('debe parsear JSON válido', () => {
            const result = helpers.safeParseJSON('{"name": "test"}');
            expect(result).toEqual({ name: 'test' });
        });

        test('debe retornar objeto vacío para JSON inválido', () => {
            const result = helpers.safeParseJSON('not valid json');
            expect(result).toEqual({});
        });

        test('debe retornar objeto vacío para null', () => {
            const result = helpers.safeParseJSON(null);
            expect(result).toEqual({});
        });

        test('debe retornar objeto vacío para undefined', () => {
            const result = helpers.safeParseJSON(undefined);
            expect(result).toEqual({});
        });

        test('debe retornar objeto vacío para string vacío', () => {
            const result = helpers.safeParseJSON('');
            expect(result).toEqual({});
        });

        test('debe parsear arrays', () => {
            const result = helpers.safeParseJSON('[1, 2, 3]');
            expect(result).toEqual([1, 2, 3]);
        });

        test('debe parsear objetos anidados', () => {
            const result = helpers.safeParseJSON('{"outer": {"inner": "value"}}');
            expect(result).toEqual({ outer: { inner: 'value' } });
        });

        test('debe retornar defaultValue personalizado para JSON inválido', () => {
            const defaultValue = { default: true };
            const result = helpers.safeParseJSON('invalid', defaultValue);
            expect(result).toEqual(defaultValue);
        });
    });

    describe('validateSAPCode', () => {
        test('debe validar código SAP de 7 dígitos', () => {
            const result = helpers.validateSAPCode('1234567');
            expect(result.valid).toBe(true);
            expect(result.cleaned).toBe('1234567');
            expect(result.error).toBeNull();
        });

        test('debe validar código SAP de 5 dígitos (mínimo)', () => {
            const result = helpers.validateSAPCode('12345');
            expect(result.valid).toBe(true);
            expect(result.cleaned).toBe('12345');
        });

        test('debe rechazar código con menos de 5 dígitos', () => {
            const result = helpers.validateSAPCode('1234');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('5 dígitos');
        });

        test('debe rechazar código con más de 10 dígitos', () => {
            const result = helpers.validateSAPCode('12345678901');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('10 dígitos');
        });

        test('debe limpiar letras y validar dígitos', () => {
            const result = helpers.validateSAPCode('123ABC456');
            expect(result.cleaned).toBe('123456');
            expect(result.valid).toBe(true);
        });

        test('debe rechazar código vacío', () => {
            const result = helpers.validateSAPCode('');
            expect(result.valid).toBe(false);
        });

        test('debe rechazar código null', () => {
            const result = helpers.validateSAPCode(null);
            expect(result.valid).toBe(false);
        });
    });

    describe('validateEmployeeNumber', () => {
        test('debe validar número de empleado de 6 dígitos', () => {
            const result = helpers.validateEmployeeNumber('123456');
            expect(result.valid).toBe(true);
            expect(result.cleaned).toBe('123456');
            expect(result.error).toBeNull();
        });

        test('debe validar número de empleado de 3 caracteres (mínimo)', () => {
            const result = helpers.validateEmployeeNumber('ABC');
            expect(result.valid).toBe(true);
        });

        test('debe rechazar número con menos de 3 caracteres', () => {
            const result = helpers.validateEmployeeNumber('AB');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('3 caracteres');
        });

        test('debe rechazar número con más de 20 caracteres', () => {
            const result = helpers.validateEmployeeNumber('123456789012345678901');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('20 caracteres');
        });

        test('debe rechazar número vacío', () => {
            const result = helpers.validateEmployeeNumber('');
            expect(result.valid).toBe(false);
        });
    });

    describe('validatePhoneE164', () => {
        test('debe validar teléfono de 12 dígitos', () => {
            const result = helpers.validatePhoneE164('521234567890');
            expect(result.valid).toBe(true);
            expect(result.cleaned).toBe('521234567890');
        });

        test('debe limpiar caracteres no numéricos', () => {
            const result = helpers.validatePhoneE164('+52 (123) 456-7890');
            expect(result.cleaned).toBe('521234567890');
            expect(result.valid).toBe(true);
        });

        test('debe rechazar teléfono con menos de 10 dígitos', () => {
            const result = helpers.validatePhoneE164('123456789');
            expect(result.valid).toBe(false);
        });

        test('debe rechazar teléfono que empieza con 0', () => {
            const result = helpers.validatePhoneE164('0123456789012');
            expect(result.valid).toBe(false);
        });
    });

    describe('sanitizeMessage', () => {
        test('debe sanitizar mensaje normal', () => {
            const result = helpers.sanitizeMessage('Hola, tengo un problema');
            expect(result).toBe('Hola, tengo un problema');
        });

        test('debe normalizar espacios múltiples', () => {
            const result = helpers.sanitizeMessage('Hola    mundo');
            expect(result).toBe('Hola mundo');
        });

        test('debe truncar mensajes muy largos', () => {
            const longMessage = 'a'.repeat(600);
            const result = helpers.sanitizeMessage(longMessage);
            expect(result.length).toBeLessThanOrEqual(500);
        });

        test('debe manejar string vacío', () => {
            const result = helpers.sanitizeMessage('');
            expect(result).toBe('');
        });

        test('debe manejar null', () => {
            const result = helpers.sanitizeMessage(null);
            expect(result).toBe('');
        });
    });

    describe('generateTicketNumber', () => {
        test('debe generar ticket con formato TKT-XXXXXXXX', () => {
            const ticket = helpers.generateTicketNumber();
            expect(ticket).toMatch(/^TKT-[A-Z0-9]{8}$/);
        });

        test('debe generar tickets únicos', () => {
            const tickets = new Set();
            for (let i = 0; i < 100; i++) {
                tickets.add(helpers.generateTicketNumber());
            }
            expect(tickets.size).toBe(100);
        });
    });
});
