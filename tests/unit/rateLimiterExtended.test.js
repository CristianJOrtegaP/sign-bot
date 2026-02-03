/**
 * Tests - Rate Limiter Extended
 * Pruebas adicionales del servicio de rate limiting
 */

jest.mock('../../core/config', () => ({
    rateLimiting: {
        messages: {
            maxPerMinute: 10,
            maxPerHour: 50,
            windowMinuteMs: 60000,
            windowHourMs: 3600000
        },
        images: {
            maxPerMinute: 3,
            maxPerHour: 10,
            windowMinuteMs: 60000,
            windowHourMs: 3600000
        },
        spam: {
            windowMs: 10000,
            maxMessagesInWindow: 10
        },
        cleanupIntervalMs: 300000
    }
}));

jest.mock('../../core/services/infrastructure/metricsService', () => ({
    recordError: jest.fn()
}));

// Clear module cache to get fresh instance
jest.resetModules();

const rateLimiter = require('../../core/services/infrastructure/rateLimiter');

describe('RateLimiter Extended', () => {
    const testPhone1 = '+5215540829614';
    const testPhone2 = '+5215522222222';

    beforeEach(() => {
        jest.clearAllMocks();
        rateLimiter.clearState();
    });

    describe('checkRateLimit - Messages', () => {
        test('debe permitir solicitudes dentro del límite por minuto', () => {
            for (let i = 0; i < 5; i++) {
                rateLimiter.recordRequest(testPhone1, 'message');
                const result = rateLimiter.checkRateLimit(testPhone1, 'message');
                expect(result.allowed).toBe(true);
            }
        });

        test('debe bloquear cuando excede límite por minuto', () => {
            // Llenar el límite
            for (let i = 0; i < 10; i++) {
                rateLimiter.recordRequest(testPhone2, 'message');
            }

            const result = rateLimiter.checkRateLimit(testPhone2, 'message');
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('límite');
            expect(result.waitTime).toBeDefined();
        });
    });

    describe('checkRateLimit - Images', () => {
        test('debe tener límite más restrictivo para imágenes', () => {
            const phone = '+5215533333333';

            // 3 imágenes deben ser permitidas
            for (let i = 0; i < 3; i++) {
                rateLimiter.recordRequest(phone, 'image');
            }

            // La 4ta debería ser bloqueada
            const result = rateLimiter.checkRateLimit(phone, 'image');
            expect(result.allowed).toBe(false);
        });
    });

    describe('isDuplicateMessage', () => {
        test('debe marcar mensaje como no duplicado la primera vez', () => {
            const messageId = `unique_msg_${  Date.now()}`;
            const result = rateLimiter.isDuplicateMessage(messageId);
            expect(result).toBe(false);
        });

        test('debe marcar mensaje como duplicado la segunda vez', () => {
            const messageId = `dup_msg_${  Date.now()}`;

            const first = rateLimiter.isDuplicateMessage(messageId);
            const second = rateLimiter.isDuplicateMessage(messageId);

            expect(first).toBe(false);
            expect(second).toBe(true);
        });

        test('debe manejar messageId null o vacío', () => {
            expect(rateLimiter.isDuplicateMessage(null)).toBe(false);
            expect(rateLimiter.isDuplicateMessage('')).toBe(false);
            expect(rateLimiter.isDuplicateMessage(undefined)).toBe(false);
        });
    });

    describe('recordRequest', () => {
        test('debe registrar solicitud de mensaje', () => {
            const phone = '+5215544444444';
            rateLimiter.recordRequest(phone, 'message');

            const stats = rateLimiter.getUserStats(phone);
            expect(stats.messages.lastMinute).toBeGreaterThan(0);
        });

        test('debe registrar solicitud de imagen', () => {
            const phone = '+5215555555555';
            rateLimiter.recordRequest(phone, 'image');

            const stats = rateLimiter.getUserStats(phone);
            expect(stats.images.lastMinute).toBeGreaterThan(0);
        });
    });

    describe('getUserStats', () => {
        test('debe retornar estadísticas correctas', () => {
            const phone = '+5215566666666';

            // Registrar algunas solicitudes
            rateLimiter.recordRequest(phone, 'message');
            rateLimiter.recordRequest(phone, 'message');
            rateLimiter.recordRequest(phone, 'image');

            const stats = rateLimiter.getUserStats(phone);

            expect(stats.messages.lastMinute).toBe(2);
            expect(stats.images.lastMinute).toBe(1);
            expect(stats.messages.maxPerMinute).toBeDefined();
            expect(stats.images.maxPerHour).toBeDefined();
        });

        test('debe retornar stats vacías para usuario nuevo', () => {
            const newPhone = '+5215599999999';
            const stats = rateLimiter.getUserStats(newPhone);

            expect(stats.messages.lastMinute).toBe(0);
            expect(stats.images.lastMinute).toBe(0);
        });
    });

    describe('isSpamming', () => {
        test('debe retornar false para usuario normal', () => {
            const phone = '+5215577777777';
            rateLimiter.recordRequest(phone, 'message');

            expect(rateLimiter.isSpamming(phone)).toBe(false);
        });

        test('debe detectar spam cuando excede umbral en ventana corta', () => {
            const phone = '+5215588888888';

            // Simular spam: muchos mensajes en poco tiempo
            for (let i = 0; i < 15; i++) {
                rateLimiter.recordRequest(phone, 'message');
            }

            expect(rateLimiter.isSpamming(phone)).toBe(true);
        });
    });

    describe('Múltiples usuarios', () => {
        test('debe manejar múltiples usuarios independientemente', () => {
            const userA = '+5215511111111';
            const userB = '+5215522222222';

            // UserA hace muchas solicitudes
            for (let i = 0; i < 10; i++) {
                rateLimiter.recordRequest(userA, 'message');
            }

            // UserB debería seguir teniendo permitido
            const resultB = rateLimiter.checkRateLimit(userB, 'message');
            expect(resultB.allowed).toBe(true);

            // UserA debería estar bloqueado
            const resultA = rateLimiter.checkRateLimit(userA, 'message');
            expect(resultA.allowed).toBe(false);
        });
    });

    describe('Edge Cases', () => {
        test('debe manejar tipo de solicitud inválido', () => {
            const phone = '+5215512121212';
            rateLimiter.recordRequest(phone, 'invalid_type');

            // No debería lanzar error
            const stats = rateLimiter.getUserStats(phone);
            expect(stats).toBeDefined();
        });
    });
});
