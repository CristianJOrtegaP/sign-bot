/**
 * Tests - Rate Limiter Service
 * Pruebas del servicio de control de rate limiting
 */

const rateLimiter = require('../../core/services/infrastructure/rateLimiter');

describe('RateLimiter', () => {
    beforeEach(() => {
        // Limpiar estado entre tests
        rateLimiter.clearAll && rateLimiter.clearAll();
    });

    describe('checkRateLimit', () => {
        test('debe permitir primera solicitud', () => {
            const result = rateLimiter.checkRateLimit('+5215512345678');
            expect(result.allowed).toBe(true);
        });

        test('debe permitir múltiples solicitudes dentro del límite', () => {
            const phone = '+5215512345678';

            for (let i = 0; i < 5; i++) {
                const result = rateLimiter.checkRateLimit(phone);
                expect(result.allowed).toBe(true);
            }
        });
    });

    describe('isDuplicateMessage', () => {
        test('debe detectar mensaje duplicado', () => {
            const messageId = 'msg_12345';

            // Primera vez no es duplicado
            const first = rateLimiter.isDuplicateMessage(messageId);
            expect(first).toBe(false);

            // Segunda vez sí es duplicado
            const second = rateLimiter.isDuplicateMessage(messageId);
            expect(second).toBe(true);
        });

        test('debe permitir diferentes mensajes', () => {
            expect(rateLimiter.isDuplicateMessage('msg_1')).toBe(false);
            expect(rateLimiter.isDuplicateMessage('msg_2')).toBe(false);
            expect(rateLimiter.isDuplicateMessage('msg_3')).toBe(false);
        });
    });

    describe('recordRequest', () => {
        test('debe registrar solicitud sin error', () => {
            expect(() => {
                rateLimiter.recordRequest('+5215512345678');
            }).not.toThrow();
        });
    });

    describe('isSpamming', () => {
        test('debe retornar false para usuario normal', () => {
            const result = rateLimiter.isSpamming('+5215512345678');
            expect(result).toBe(false);
        });
    });
});
