/**
 * Tests para AuditService
 * Valida logging de eventos de auditoria y funciones especificas
 */

describe('AuditService', () => {
    let auditService;
    let mockLogger;

    const originalEnv = process.env;

    beforeAll(() => {
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    beforeEach(() => {
        jest.resetModules();

        // Mock del logger
        mockLogger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };

        jest.doMock('../../core/services/infrastructure/errorHandler', () => ({
            logger: mockLogger
        }));

        jest.doMock('../../core/services/infrastructure/correlationService', () => ({
            getCorrelationId: jest.fn().mockReturnValue('test-correlation-id-123')
        }));

        auditService = require('../../core/services/infrastructure/auditService');
    });

    describe('AUDIT_EVENTS', () => {
        it('debe tener todos los tipos de eventos definidos', () => {
            expect(auditService.AUDIT_EVENTS).toBeDefined();
            expect(auditService.AUDIT_EVENTS.ADMIN_CACHE_CLEAR).toBe('ADMIN_CACHE_CLEAR');
            expect(auditService.AUDIT_EVENTS.TICKET_RESOLVED).toBe('TICKET_RESOLVED');
            expect(auditService.AUDIT_EVENTS.AUTH_FAILURE).toBe('AUTH_FAILURE');
            expect(auditService.AUDIT_EVENTS.SESSION_TIMEOUT).toBe('SESSION_TIMEOUT');
        });
    });

    describe('SEVERITY', () => {
        it('debe tener todos los niveles de severidad', () => {
            expect(auditService.SEVERITY).toBeDefined();
            expect(auditService.SEVERITY.INFO).toBe('INFO');
            expect(auditService.SEVERITY.WARNING).toBe('WARNING');
            expect(auditService.SEVERITY.ERROR).toBe('ERROR');
            expect(auditService.SEVERITY.CRITICAL).toBe('CRITICAL');
        });
    });

    describe('logAuditEvent', () => {
        it('debe registrar evento con severidad INFO', () => {
            const result = auditService.logAuditEvent(
                auditService.AUDIT_EVENTS.TICKET_CREATED,
                { ticketId: 'TKT1234567890123' },
                auditService.SEVERITY.INFO
            );

            expect(result).toBeDefined();
            expect(result.eventType).toBe('TICKET_CREATED');
            expect(result.severity).toBe('INFO');
            expect(result.correlationId).toBe('test-correlation-id-123');
            expect(result.details.ticketId).toBe('TKT1234567890123');
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('debe registrar evento con severidad WARNING', () => {
            auditService.logAuditEvent(
                auditService.AUDIT_EVENTS.AUTH_FAILURE,
                { reason: 'Invalid API key' },
                auditService.SEVERITY.WARNING
            );

            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('debe registrar evento con severidad ERROR', () => {
            auditService.logAuditEvent(
                auditService.AUDIT_EVENTS.AUTH_FAILURE,
                { reason: 'Critical auth error' },
                auditService.SEVERITY.ERROR
            );

            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('debe incluir informacion del request si esta disponible', () => {
            const mockReq = {
                method: 'POST',
                url: '/api/admin-cache',
                headers: {
                    'x-forwarded-for': '192.168.1.100',
                    'user-agent': 'Test/1.0'
                }
            };

            const result = auditService.logAuditEvent(
                auditService.AUDIT_EVENTS.ADMIN_CACHE_CLEAR,
                { cacheType: 'all' },
                auditService.SEVERITY.INFO,
                mockReq
            );

            expect(result.request).toBeDefined();
            expect(result.request.method).toBe('POST');
            expect(result.request.url).toBe('/api/admin-cache');
            expect(result.request.ip).toBe('192.168.1.100');
            expect(result.request.userAgent).toBe('Test/1.0');
        });

        it('debe incluir timestamp en formato ISO', () => {
            const result = auditService.logAuditEvent(
                auditService.AUDIT_EVENTS.SESSION_CREATED,
                {}
            );

            expect(result.timestamp).toBeDefined();
            expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
        });
    });

    describe('logAdminAccess', () => {
        it('debe registrar acceso administrativo', () => {
            const mockReq = {
                method: 'GET',
                url: '/api/admin-cache?type=stats',
                headers: { 'x-forwarded-for': '10.0.0.1' }
            };

            const result = auditService.logAdminAccess(
                'CACHE_STATS',
                { entries: 100 },
                mockReq
            );

            expect(result.eventType).toBe('ADMIN_CACHE_STATS');
            expect(mockLogger.info).toHaveBeenCalled();
        });
    });

    describe('logAuthFailure', () => {
        it('debe registrar fallo de autenticacion', () => {
            const mockReq = {
                method: 'POST',
                url: '/api/ticket-resolve',
                headers: {}
            };

            const result = auditService.logAuthFailure('Invalid API key', mockReq);

            expect(result.eventType).toBe('AUTH_FAILURE');
            expect(result.severity).toBe('WARNING');
            expect(result.details.reason).toBe('Invalid API key');
        });
    });

    describe('logInvalidSignature', () => {
        it('debe registrar firma invalida con firma presente', () => {
            const mockReq = {
                headers: { 'x-hub-signature-256': 'sha256=invalidhash' }
            };

            const result = auditService.logInvalidSignature(mockReq);

            expect(result.eventType).toBe('SIGNATURE_INVALID');
            expect(result.details.signature).toBe('present');
        });

        it('debe registrar firma invalida sin firma', () => {
            const mockReq = {
                headers: {}
            };

            const result = auditService.logInvalidSignature(mockReq);

            expect(result.details.signature).toBe('missing');
        });
    });

    describe('logRateLimitExceeded', () => {
        it('debe registrar rate limit excedido', () => {
            const result = auditService.logRateLimitExceeded('192.168.1.50', 100, 60000);

            expect(result.eventType).toBe('RATE_LIMIT_EXCEEDED');
            expect(result.severity).toBe('WARNING');
            expect(result.details.ip).toBe('192.168.1.50');
            expect(result.details.limit).toBe(100);
            expect(result.details.windowMs).toBe(60000);
        });
    });

    describe('logTicketResolved', () => {
        it('debe registrar resolucion de ticket', () => {
            const mockReq = {
                method: 'POST',
                url: '/api/ticket-resolve',
                headers: { 'x-forwarded-for': '10.0.0.5' }
            };

            const result = auditService.logTicketResolved(
                'TKT1234567890123',
                'PENDIENTE',
                mockReq
            );

            expect(result.eventType).toBe('TICKET_RESOLVED');
            expect(result.details.ticketId).toBe('TKT1234567890123');
            expect(result.details.previousState).toBe('PENDIENTE');
        });
    });

    describe('logTicketCreated', () => {
        it('debe registrar creacion de ticket con telefono enmascarado', () => {
            const result = auditService.logTicketCreated(
                'TKT1234567890123',
                '5218112345678',
                'REFRIGERADOR'
            );

            expect(result.eventType).toBe('TICKET_CREATED');
            expect(result.details.ticketId).toBe('TKT1234567890123');
            expect(result.details.telefono).toBe('521811****');
            expect(result.details.tipoReporte).toBe('REFRIGERADOR');
        });
    });

    describe('logCacheClear', () => {
        it('debe registrar limpieza de cache', () => {
            const mockReq = {
                method: 'GET',
                url: '/api/admin-cache?type=all',
                headers: {}
            };

            const result = auditService.logCacheClear(
                'all',
                { itemsCleared: 50 },
                mockReq
            );

            expect(result.eventType).toBe('ADMIN_CACHE_CLEAR');
            expect(result.details.cacheType).toBe('all');
            expect(result.details.itemsCleared).toBe(50);
        });
    });

    describe('logSessionTimeout', () => {
        it('debe registrar timeout de sesion con telefono enmascarado', () => {
            const result = auditService.logSessionTimeout(
                '5218112345678',
                '2024-01-15T10:30:00Z'
            );

            expect(result.eventType).toBe('SESSION_TIMEOUT');
            expect(result.details.telefono).toBe('521811****');
            expect(result.details.lastActivity).toBe('2024-01-15T10:30:00Z');
        });
    });
});
