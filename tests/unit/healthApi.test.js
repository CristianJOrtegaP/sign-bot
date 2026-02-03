/**
 * Tests para Health API Endpoint
 * Valida respuestas del health check y rate limiting
 */

// Mocks
const mockPool = {
    request: jest.fn().mockReturnValue({
        query: jest.fn()
    })
};

jest.mock('../../core/services/storage/connectionPool', () => ({
    getPool: jest.fn().mockResolvedValue(mockPool)
}));

jest.mock('../../core/services/infrastructure/securityService', () => ({
    getClientIp: jest.fn().mockReturnValue('127.0.0.1'),
    checkIpRateLimit: jest.fn().mockReturnValue({
        allowed: true,
        remaining: 99,
        resetMs: 60000
    })
}));

jest.mock('../../core/services/infrastructure/circuitBreaker', () => ({
    getBreaker: jest.fn().mockReturnValue({
        canExecute: jest.fn().mockReturnValue({ allowed: true })
    }),
    SERVICES: {
        GEMINI: 'gemini',
        AZURE_OPENAI: 'azure-openai',
        WHATSAPP: 'whatsapp'
    }
}));

jest.mock('../../core/services/infrastructure/deadLetterService', () => ({
    getStats: jest.fn().mockResolvedValue({
        total: 0,
        byStatus: {}
    })
}));

describe('Health API', () => {
    let healthHandler;
    let mockContext;
    let securityService;

    const originalEnv = process.env;

    beforeAll(() => {
        process.env = {
            ...originalEnv,
            SQL_CONNECTION_STRING: 'Server=test;Database=test',
            WHATSAPP_TOKEN: 'test-token',
            WHATSAPP_PHONE_ID: '123456789',
            WHATSAPP_VERIFY_TOKEN: 'verify-token',
            NODE_ENV: 'test'
        };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();

        mockContext = {
            log: jest.fn(),
            res: null
        };
        mockContext.log.warn = jest.fn();
        mockContext.log.error = jest.fn();

        // Reset mocks
        mockPool.request().query.mockResolvedValue({ recordset: [{ test: 1 }] });

        securityService = require('../../core/services/infrastructure/securityService');
        healthHandler = require('../../api-health/index');
    });

    describe('GET /api/health', () => {
        it('debe retornar status healthy cuando todo funciona', async () => {
            const req = {
                method: 'GET',
                headers: {}
            };

            await healthHandler(mockContext, req);

            expect(mockContext.res.status).toBe(200);
            expect(mockContext.res.body.status).toBe('healthy');
            expect(mockContext.res.body.checks).toBeDefined();
            expect(mockContext.res.body.checks.database.status).toBe('healthy');
        });

        it('debe incluir checks de memoria', async () => {
            const req = {
                method: 'GET',
                headers: {}
            };

            await healthHandler(mockContext, req);

            expect(mockContext.res.body.checks.memory).toBeDefined();
            expect(mockContext.res.body.checks.memory.heapUsedMB).toBeDefined();
            expect(mockContext.res.body.checks.memory.heapTotalMB).toBeDefined();
            expect(mockContext.res.body.checks.memory.heapPercentage).toBeDefined();
        });

        it('debe incluir checks de uptime', async () => {
            const req = {
                method: 'GET',
                headers: {}
            };

            await healthHandler(mockContext, req);

            expect(mockContext.res.body.checks.uptime).toBeDefined();
            expect(mockContext.res.body.checks.uptime.status).toBe('healthy');
            expect(mockContext.res.body.checks.uptime.uptimeSeconds).toBeGreaterThanOrEqual(0);
        });

        it('debe incluir headers de seguridad', async () => {
            const req = {
                method: 'GET',
                headers: {}
            };

            await healthHandler(mockContext, req);

            expect(mockContext.res.headers['X-Content-Type-Options']).toBe('nosniff');
            expect(mockContext.res.headers['X-Frame-Options']).toBe('DENY');
            expect(mockContext.res.headers['Content-Type']).toBe('application/json');
        });

        it('debe incluir tiempo de respuesta', async () => {
            const req = {
                method: 'GET',
                headers: {}
            };

            await healthHandler(mockContext, req);

            expect(mockContext.res.body.responseTimeMs).toBeDefined();
            expect(typeof mockContext.res.body.responseTimeMs).toBe('number');
        });

        it('debe incluir version y environment', async () => {
            const req = {
                method: 'GET',
                headers: {}
            };

            await healthHandler(mockContext, req);

            expect(mockContext.res.body.version).toBeDefined();
            expect(mockContext.res.body.environment).toBeDefined();
        });
    });

    describe('Rate Limiting', () => {
        it('debe retornar 429 cuando se excede el rate limit', async () => {
            securityService.checkIpRateLimit.mockReturnValue({
                allowed: false,
                remaining: 0,
                resetMs: 30000
            });

            const req = {
                method: 'GET',
                headers: {}
            };

            await healthHandler(mockContext, req);

            expect(mockContext.res.status).toBe(429);
            expect(mockContext.res.body.status).toBe('rate_limited');
            expect(mockContext.res.body.message).toBe('Too many requests');
            expect(mockContext.res.headers['Retry-After']).toBeDefined();
        });

        it('debe incluir header X-RateLimit-Remaining', async () => {
            securityService.checkIpRateLimit.mockReturnValue({
                allowed: false,
                remaining: 0,
                resetMs: 30000
            });

            const req = {
                method: 'GET',
                headers: {}
            };

            await healthHandler(mockContext, req);

            expect(mockContext.res.headers['X-RateLimit-Remaining']).toBe('0');
        });
    });

    describe('Database Check', () => {
        it('debe retornar unhealthy si la base de datos falla', async () => {
            mockPool.request().query.mockRejectedValue(new Error('Connection failed'));

            const req = {
                method: 'GET',
                headers: {}
            };

            await healthHandler(mockContext, req);

            expect(mockContext.res.status).toBe(503);
            expect(mockContext.res.body.status).toBe('unhealthy');
            expect(mockContext.res.body.checks.database.status).toBe('unhealthy');
            expect(mockContext.res.body.checks.database.message).toBe('Connection failed');
        });
    });

    describe('Configuration Check', () => {
        it('debe reportar estado de configuracion', async () => {
            const req = {
                method: 'GET',
                headers: {}
            };

            await healthHandler(mockContext, req);

            expect(mockContext.res.body.checks.configuration).toBeDefined();
            expect(mockContext.res.body.checks.configuration.status).toBe('healthy');
        });
    });

    describe('Circuit Breakers Check', () => {
        it('debe incluir estado de circuit breakers', async () => {
            const req = {
                method: 'GET',
                headers: {}
            };

            await healthHandler(mockContext, req);

            expect(mockContext.res.body.checks.circuitBreakers).toBeDefined();
            expect(mockContext.res.body.checks.circuitBreakers.services).toBeDefined();
        });
    });

    describe('External Services Check', () => {
        it('debe incluir estado de servicios externos', async () => {
            const req = {
                method: 'GET',
                headers: {}
            };

            await healthHandler(mockContext, req);

            expect(mockContext.res.body.checks.externalServices).toBeDefined();
            expect(mockContext.res.body.checks.externalServices.services).toBeDefined();
            expect(mockContext.res.body.checks.externalServices.services.whatsapp).toBeDefined();
        });
    });

    describe('Circuit Breaker Error Handling', () => {
        it('debe retornar unknown si circuit breaker lanza error', async () => {
            // Re-require para obtener la instancia mockeada actual
            const cb = require('../../core/services/infrastructure/circuitBreaker');
            cb.getBreaker.mockImplementation(() => {
                throw new Error('Circuit breaker error');
            });

            const req = {
                method: 'GET',
                headers: {}
            };

            await healthHandler(mockContext, req);

            expect(mockContext.res.body.checks.circuitBreakers.status).toBe('unknown');
            expect(mockContext.res.body.checks.circuitBreakers.message).toBeDefined();
        });
    });

    describe('Dead Letter Queue Error Handling', () => {
        it('debe retornar unknown si deadLetter lanza error', async () => {
            const dls = require('../../core/services/infrastructure/deadLetterService');
            dls.getStats.mockRejectedValue(new Error('Dead letter error'));

            const req = {
                method: 'GET',
                headers: {}
            };

            await healthHandler(mockContext, req);

            expect(mockContext.res.body.checks.deadLetter.status).toBe('unknown');
            expect(mockContext.res.body.checks.deadLetter.message).toBeDefined();
        });

        it('debe retornar warning si hay muchos mensajes fallidos', async () => {
            const dls = require('../../core/services/infrastructure/deadLetterService');
            dls.getStats.mockResolvedValue({
                total: 20,
                byStatus: {
                    PENDING: { count: 5 },
                    FAILED: { count: 15 }
                }
            });

            const req = {
                method: 'GET',
                headers: {}
            };

            await healthHandler(mockContext, req);

            expect(mockContext.res.body.checks.deadLetter.status).toBe('warning');
            expect(mockContext.res.body.checks.deadLetter.failed).toBe(15);
        });
    });
});
