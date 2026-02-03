/**
 * Tests - Ticket Resolve API
 * Pruebas del endpoint para resolver tickets
 */

jest.mock('../../bot/repositories/ReporteRepository', () => ({
    getByTicket: jest.fn(),
    resolverReporte: jest.fn()
}));

jest.mock('../../core/services/infrastructure/securityService', () => ({
    validateTicketId: jest.fn().mockReturnValue({ valid: true, cleaned: 'TKT-12345678' }),
    sanitizeInput: jest.fn().mockImplementation((input) => input)
}));

jest.mock('../../core/services/infrastructure/auditService', () => ({
    logTicketResolved: jest.fn().mockReturnValue({ eventType: 'TICKET_RESOLVED' }),
    logAuditEvent: jest.fn()
}));

const ticketResolveApi = require('../../api-ticket-resolve');
const reporteRepository = require('../../bot/repositories/ReporteRepository');
const security = require('../../core/services/infrastructure/securityService');

describe('Ticket Resolve API', () => {
    let mockContext;

    beforeEach(() => {
        jest.clearAllMocks();

        mockContext = {
            log: jest.fn(),
            res: {}
        };
        mockContext.log.error = jest.fn();

        // Reset security mock to default valid
        security.validateTicketId.mockReturnValue({ valid: true, cleaned: 'TKT-12345678' });
    });

    describe('Content Validation', () => {
        test('debe rechazar Content-Length excesivo (413)', async () => {
            const req = {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'content-length': '20000000' // 20MB
                },
                body: { ticketId: 'TKT-12345678' }
            };

            await ticketResolveApi(mockContext, req);

            expect(mockContext.res.status).toBe(413);
            expect(mockContext.res.body.success).toBe(false);
            expect(mockContext.res.body.error).toContain('excede');
        });

        test('debe rechazar Content-Type invalido (415)', async () => {
            const req = {
                method: 'POST',
                headers: {
                    'content-type': 'text/plain'
                },
                body: 'ticketId=TKT-12345678'
            };

            await ticketResolveApi(mockContext, req);

            expect(mockContext.res.status).toBe(415);
            expect(mockContext.res.body.success).toBe(false);
            expect(mockContext.res.body.error).toContain('Content-Type');
        });

        test('debe rechazar formato de ticketId invalido', async () => {
            security.validateTicketId.mockReturnValue({
                valid: false,
                error: 'Formato de ticket invalido'
            });

            const req = {
                headers: { 'content-type': 'application/json' },
                body: { ticketId: 'INVALID-123' }
            };

            await ticketResolveApi(mockContext, req);

            expect(mockContext.res.status).toBe(400);
            expect(mockContext.res.body.success).toBe(false);
            expect(mockContext.res.body.error).toContain('Formato de ticket invalido');
        });
    });

    describe('POST - Resolver Ticket', () => {
        test('debe resolver ticket exitosamente', async () => {
            reporteRepository.getByTicket.mockResolvedValueOnce({
                NumeroTicket: 'TKT-12345678',
                Estado: 'PENDIENTE'
            });
            reporteRepository.resolverReporte.mockResolvedValueOnce(true);

            const req = {
                headers: { 'content-type': 'application/json' },
                body: { ticketId: 'TKT-12345678' }
            };

            await ticketResolveApi(mockContext, req);

            expect(mockContext.res.status).toBe(200);
            expect(mockContext.res.body.success).toBe(true);
            expect(mockContext.res.body.ticketId).toBe('TKT-12345678');
            expect(mockContext.res.body.estadoNuevo).toBe('RESUELTO');
        });

        test('debe rechazar si no se proporciona ticketId', async () => {
            const req = { headers: { 'content-type': 'application/json' }, body: {} };

            await ticketResolveApi(mockContext, req);

            expect(mockContext.res.status).toBe(400);
            expect(mockContext.res.body.success).toBe(false);
            expect(mockContext.res.body.error).toContain('ticketId es requerido');
        });

        test('debe retornar 404 si ticket no existe', async () => {
            reporteRepository.getByTicket.mockResolvedValueOnce(null);

            const req = {
                headers: { 'content-type': 'application/json' },
                body: { ticketId: 'TKT-99999999' }
            };

            await ticketResolveApi(mockContext, req);

            expect(mockContext.res.status).toBe(404);
            expect(mockContext.res.body.success).toBe(false);
            expect(mockContext.res.body.error).toContain('No se encontro');
        });

        test('debe rechazar si ticket ya está resuelto', async () => {
            reporteRepository.getByTicket.mockResolvedValueOnce({
                NumeroTicket: 'TKT-12345678',
                Estado: 'RESUELTO'
            });

            const req = {
                headers: { 'content-type': 'application/json' },
                body: { ticketId: 'TKT-12345678' }
            };

            await ticketResolveApi(mockContext, req);

            expect(mockContext.res.status).toBe(400);
            expect(mockContext.res.body.success).toBe(false);
            expect(mockContext.res.body.error).toContain('ya esta resuelto');
        });

        test('debe rechazar si ticket está cancelado', async () => {
            reporteRepository.getByTicket.mockResolvedValueOnce({
                NumeroTicket: 'TKT-12345678',
                Estado: 'CANCELADO'
            });

            const req = {
                headers: { 'content-type': 'application/json' },
                body: { ticketId: 'TKT-12345678' }
            };

            await ticketResolveApi(mockContext, req);

            expect(mockContext.res.status).toBe(400);
            expect(mockContext.res.body.success).toBe(false);
            expect(mockContext.res.body.error).toContain('cancelado');
        });

        test('debe manejar error de actualización', async () => {
            reporteRepository.getByTicket.mockResolvedValueOnce({
                NumeroTicket: 'TKT-12345678',
                Estado: 'PENDIENTE'
            });
            reporteRepository.resolverReporte.mockResolvedValueOnce(false);

            const req = {
                headers: { 'content-type': 'application/json' },
                body: { ticketId: 'TKT-12345678' }
            };

            await ticketResolveApi(mockContext, req);

            expect(mockContext.res.status).toBe(500);
            expect(mockContext.res.body.success).toBe(false);
            expect(mockContext.res.body.error).toContain('No se pudo actualizar');
        });

        test('debe manejar errores de base de datos', async () => {
            reporteRepository.getByTicket.mockRejectedValueOnce(
                new Error('Database connection failed')
            );

            const req = {
                headers: { 'content-type': 'application/json' },
                body: { ticketId: 'TKT-12345678' }
            };

            await ticketResolveApi(mockContext, req);

            expect(mockContext.res.status).toBe(500);
            expect(mockContext.res.body.success).toBe(false);
            // En producción se oculta el mensaje de error interno
            // En desarrollo se mostraría 'Database connection failed'
            expect(mockContext.res.body.error).toBe('Error interno del servidor');
        });

        test('debe resolver ticket en estado EN_PROCESO', async () => {
            reporteRepository.getByTicket.mockResolvedValueOnce({
                NumeroTicket: 'TKT-12345678',
                Estado: 'EN_PROCESO'
            });
            reporteRepository.resolverReporte.mockResolvedValueOnce(true);

            const req = {
                headers: { 'content-type': 'application/json' },
                body: { ticketId: 'TKT-12345678' }
            };

            await ticketResolveApi(mockContext, req);

            expect(mockContext.res.status).toBe(200);
            expect(mockContext.res.body.success).toBe(true);
            expect(mockContext.res.body.estadoAnterior).toBe('EN_PROCESO');
        });

        test('debe incluir timestamp en la respuesta', async () => {
            reporteRepository.getByTicket.mockResolvedValueOnce({
                NumeroTicket: 'TKT-12345678',
                Estado: 'PENDIENTE'
            });
            reporteRepository.resolverReporte.mockResolvedValueOnce(true);

            const req = {
                headers: { 'content-type': 'application/json' },
                body: { ticketId: 'TKT-12345678' }
            };

            await ticketResolveApi(mockContext, req);

            expect(mockContext.res.body.timestamp).toBeDefined();
            expect(new Date(mockContext.res.body.timestamp)).toBeInstanceOf(Date);
        });
    });
});
