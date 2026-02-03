/**
 * Tests para SecurityService
 * Valida verificacion de firmas, autenticacion y validaciones
 */

const crypto = require('crypto');

// Mock de process.env
const originalEnv = process.env;

describe('SecurityService', () => {
    let security;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
        security = require('../../core/services/infrastructure/securityService');
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('verifyWebhookSignature', () => {
        const testPayload = '{"test": "data"}';
        const testSecret = 'test_app_secret_123';

        beforeEach(() => {
            process.env.WHATSAPP_APP_SECRET = testSecret;
            jest.resetModules();
            security = require('../../core/services/infrastructure/securityService');
        });

        it('debe aceptar firma valida', () => {
            const expectedHash = crypto
                .createHmac('sha256', testSecret)
                .update(testPayload, 'utf8')
                .digest('hex');
            const signature = `sha256=${expectedHash}`;

            const result = security.verifyWebhookSignature(testPayload, signature);
            expect(result).toBe(true);
        });

        it('debe rechazar firma invalida', () => {
            const signature = 'sha256=invalidhash123456789012345678901234567890123456789012345678901234';

            const result = security.verifyWebhookSignature(testPayload, signature);
            expect(result).toBe(false);
        });

        it('debe rechazar si no hay firma', () => {
            const result = security.verifyWebhookSignature(testPayload, null);
            expect(result).toBe(false);
        });

        it('debe rechazar formato de firma incorrecto', () => {
            const result = security.verifyWebhookSignature(testPayload, 'md5=invalid');
            expect(result).toBe(false);
        });

        it('debe permitir si no hay secret configurado (desarrollo)', () => {
            delete process.env.WHATSAPP_APP_SECRET;
            jest.resetModules();
            security = require('../../core/services/infrastructure/securityService');

            const result = security.verifyWebhookSignature(testPayload, null);
            expect(result).toBe(true);
        });
    });

    describe('verifyAdminApiKey', () => {
        const testApiKey = 'test_admin_api_key_secure_32chars';

        beforeEach(() => {
            process.env.ADMIN_API_KEY = testApiKey;
            process.env.NODE_ENV = 'production';
            jest.resetModules();
            security = require('../../core/services/infrastructure/securityService');
        });

        it('debe aceptar API key valida en header', () => {
            const req = {
                headers: { 'x-api-key': testApiKey },
                query: {}
            };

            const result = security.verifyAdminApiKey(req);
            expect(result.valid).toBe(true);
        });

        it('debe aceptar API key valida en query', () => {
            const req = {
                headers: {},
                query: { apiKey: testApiKey }
            };

            const result = security.verifyAdminApiKey(req);
            expect(result.valid).toBe(true);
        });

        it('debe rechazar API key invalida', () => {
            const req = {
                headers: { 'x-api-key': 'wrong_key' },
                query: {}
            };

            const result = security.verifyAdminApiKey(req);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('API key invalida');
        });

        it('debe rechazar si no hay API key', () => {
            const req = {
                headers: {},
                query: {}
            };

            const result = security.verifyAdminApiKey(req);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('API key requerida');
        });

        it('debe permitir sin key en desarrollo', () => {
            delete process.env.ADMIN_API_KEY;
            process.env.NODE_ENV = 'development';
            jest.resetModules();
            security = require('../../core/services/infrastructure/securityService');

            const req = { headers: {}, query: {} };
            const result = security.verifyAdminApiKey(req);
            expect(result.valid).toBe(true);
        });
    });

    describe('validateTicketId', () => {
        it('debe aceptar ticketId valido (formato TKT-XXXXXXXX)', () => {
            const result = security.validateTicketId('TKT-2EF04F2C');
            expect(result.valid).toBe(true);
        });

        it('debe aceptar ticketId en minusculas', () => {
            const result = security.validateTicketId('TKT-2ef04f2c');
            expect(result.valid).toBe(true);
        });

        it('debe rechazar ticketId sin prefijo TKT-', () => {
            const result = security.validateTicketId('2EF04F2C');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Formato de ticketId invalido');
        });

        it('debe rechazar ticketId sin guion', () => {
            const result = security.validateTicketId('TKT2EF04F2C');
            expect(result.valid).toBe(false);
        });

        it('debe rechazar ticketId con menos caracteres', () => {
            const result = security.validateTicketId('TKT-2EF04F');
            expect(result.valid).toBe(false);
        });

        it('debe rechazar ticketId con mas caracteres', () => {
            const result = security.validateTicketId('TKT-2EF04F2C99');
            expect(result.valid).toBe(false);
        });

        it('debe rechazar ticketId null', () => {
            const result = security.validateTicketId(null);
            expect(result.valid).toBe(false);
        });

        it('debe rechazar ticketId no string', () => {
            const result = security.validateTicketId(12345678);
            expect(result.valid).toBe(false);
        });
    });

    describe('validateLocation', () => {
        it('debe aceptar ubicacion valida', () => {
            const result = security.validateLocation({
                latitude: 25.6866,
                longitude: -100.3161
            });
            expect(result.valid).toBe(true);
            expect(result.sanitized.latitude).toBe(25.6866);
            expect(result.sanitized.longitude).toBe(-100.3161);
        });

        it('debe rechazar latitud fuera de rango', () => {
            const result = security.validateLocation({
                latitude: 95,
                longitude: -100
            });
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Latitud');
        });

        it('debe rechazar longitud fuera de rango', () => {
            const result = security.validateLocation({
                latitude: 25,
                longitude: -200
            });
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Longitud');
        });

        it('debe rechazar ubicacion null', () => {
            const result = security.validateLocation(null);
            expect(result.valid).toBe(false);
        });

        it('debe rechazar coordenadas no numericas', () => {
            const result = security.validateLocation({
                latitude: 'invalid',
                longitude: -100
            });
            expect(result.valid).toBe(false);
        });

        it('debe sanitizar precision a 6 decimales', () => {
            const result = security.validateLocation({
                latitude: 25.68660000001,
                longitude: -100.31610000002
            });
            expect(result.valid).toBe(true);
            expect(result.sanitized.latitude).toBe(25.6866);
            expect(result.sanitized.longitude).toBe(-100.3161);
        });
    });

    describe('validatePhoneNumber', () => {
        it('debe aceptar numero mexicano valido', () => {
            const result = security.validatePhoneNumber('5218112345678');
            expect(result.valid).toBe(true);
            expect(result.sanitized).toBe('5218112345678');
        });

        it('debe limpiar caracteres no numericos', () => {
            const result = security.validatePhoneNumber('+52 (811) 234-5678');
            expect(result.valid).toBe(true);
            expect(result.sanitized).toBe('528112345678');
        });

        it('debe rechazar numero muy corto', () => {
            const result = security.validatePhoneNumber('123456789');
            expect(result.valid).toBe(false);
        });

        it('debe rechazar numero muy largo', () => {
            const result = security.validatePhoneNumber('1234567890123456');
            expect(result.valid).toBe(false);
        });

        it('debe rechazar numero null', () => {
            const result = security.validatePhoneNumber(null);
            expect(result.valid).toBe(false);
        });
    });

    describe('checkIpRateLimit', () => {
        beforeEach(() => {
            // Reset rate limiter state
            security.cleanupIpRateLimits();
        });

        it('debe permitir primera solicitud', () => {
            const result = security.checkIpRateLimit('192.168.1.1');
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBeGreaterThan(0);
        });

        it('debe decrementar remaining en cada solicitud', () => {
            const ip = '192.168.1.2';
            const first = security.checkIpRateLimit(ip);
            const second = security.checkIpRateLimit(ip);

            expect(second.remaining).toBe(first.remaining - 1);
        });

        it('debe manejar diferentes IPs independientemente', () => {
            const ip1 = '192.168.1.3';
            const ip2 = '192.168.1.4';

            security.checkIpRateLimit(ip1);
            security.checkIpRateLimit(ip1);
            security.checkIpRateLimit(ip1);

            const resultIp2 = security.checkIpRateLimit(ip2);
            expect(resultIp2.remaining).toBeGreaterThan(95); // Casi lleno
        });
    });

    describe('getClientIp', () => {
        it('debe extraer IP de x-forwarded-for', () => {
            const req = {
                headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18' }
            };
            const ip = security.getClientIp(req);
            expect(ip).toBe('203.0.113.195');
        });

        it('debe extraer IP de x-real-ip', () => {
            const req = {
                headers: { 'x-real-ip': '203.0.113.100' }
            };
            const ip = security.getClientIp(req);
            expect(ip).toBe('203.0.113.100');
        });

        it('debe retornar unknown si no hay headers', () => {
            const req = { headers: {} };
            const ip = security.getClientIp(req);
            expect(ip).toBe('unknown');
        });
    });
});
