/**
 * Tests para Deduplicación Idempotente (registerMessageAtomic)
 * Valida que el MERGE SQL previene race conditions y trackea reintentos correctamente
 */

const SesionRepository = require('../../bot/repositories/SesionRepository');

describe('Deduplicación Idempotente', () => {
    let mockPool;
    let mockRequest;
    let mockQuery;

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock de SQL request/query
        mockQuery = jest.fn();
        mockRequest = {
            input: jest.fn().mockReturnThis(),
            query: mockQuery
        };
        mockPool = {
            request: jest.fn().mockReturnValue(mockRequest)
        };

        // Mock del getPool method
        jest.spyOn(SesionRepository, 'getPool').mockResolvedValue(mockPool);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('registerMessageAtomic', () => {
        it('debe registrar mensaje nuevo (INSERT en MERGE)', async () => {
            const messageId = 'wamid.ABC123';
            const telefono = '+521234567890';

            // Simular respuesta de MERGE cuando es INSERT (Action = 'INSERT')
            mockQuery.mockResolvedValue({
                recordset: [{
                    Action: 'INSERT',
                    WhatsAppMessageId: messageId,
                    FechaCreacion: new Date('2026-02-03T10:00:00Z'),
                    Reintentos: 0
                }]
            });

            const result = await SesionRepository.registerMessageAtomic(messageId, telefono);

            expect(result).toEqual({
                isDuplicate: false,
                retryCount: 0,
                firstSeen: new Date('2026-02-03T10:00:00Z')
            });

            // Verificar que se llamó al pool correctamente
            expect(mockPool.request).toHaveBeenCalled();
            expect(mockRequest.input).toHaveBeenCalledWith('messageId', expect.anything(), messageId);
            expect(mockRequest.input).toHaveBeenCalledWith('telefono', expect.anything(), telefono);
            expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('MERGE INTO MensajesProcessados'));
        });

        it('debe detectar mensaje duplicado (UPDATE en MERGE)', async () => {
            const messageId = 'wamid.ABC123';
            const telefono = '+521234567890';

            // Simular respuesta de MERGE cuando es UPDATE (Action = 'UPDATE')
            mockQuery.mockResolvedValue({
                recordset: [{
                    Action: 'UPDATE',
                    WhatsAppMessageId: messageId,
                    FechaCreacion: new Date('2026-02-03T10:00:00Z'),
                    Reintentos: 1
                }]
            });

            const result = await SesionRepository.registerMessageAtomic(messageId, telefono);

            expect(result).toEqual({
                isDuplicate: true,
                retryCount: 1,
                firstSeen: new Date('2026-02-03T10:00:00Z')
            });
        });

        it('debe incrementar Reintentos en cada duplicado', async () => {
            const messageId = 'wamid.ABC123';
            const telefono = '+521234567890';

            // Primer duplicado: Reintentos=1
            mockQuery.mockResolvedValueOnce({
                recordset: [{
                    Action: 'UPDATE',
                    WhatsAppMessageId: messageId,
                    FechaCreacion: new Date('2026-02-03T10:00:00Z'),
                    Reintentos: 1
                }]
            });

            const result1 = await SesionRepository.registerMessageAtomic(messageId, telefono);
            expect(result1.isDuplicate).toBe(true);
            expect(result1.retryCount).toBe(1);

            // Segundo duplicado: Reintentos=2
            mockQuery.mockResolvedValueOnce({
                recordset: [{
                    Action: 'UPDATE',
                    WhatsAppMessageId: messageId,
                    FechaCreacion: new Date('2026-02-03T10:00:00Z'),
                    Reintentos: 2
                }]
            });

            const result2 = await SesionRepository.registerMessageAtomic(messageId, telefono);
            expect(result2.isDuplicate).toBe(true);
            expect(result2.retryCount).toBe(2);

            // Tercer duplicado: Reintentos=3
            mockQuery.mockResolvedValueOnce({
                recordset: [{
                    Action: 'UPDATE',
                    WhatsAppMessageId: messageId,
                    FechaCreacion: new Date('2026-02-03T10:00:00Z'),
                    Reintentos: 3
                }]
            });

            const result3 = await SesionRepository.registerMessageAtomic(messageId, telefono);
            expect(result3.isDuplicate).toBe(true);
            expect(result3.retryCount).toBe(3);
        });

        it('debe manejar messageId null/undefined devolviendo resultado por defecto', async () => {
            // messageId null
            const result1 = await SesionRepository.registerMessageAtomic(null, '+521234567890');
            expect(result1.isDuplicate).toBe(false);
            expect(result1.retryCount).toBe(0);
            expect(mockQuery).not.toHaveBeenCalled();

            // messageId undefined
            const result2 = await SesionRepository.registerMessageAtomic(undefined, '+521234567890');
            expect(result2.isDuplicate).toBe(false);
            expect(result2.retryCount).toBe(0);

            // messageId empty string
            const result3 = await SesionRepository.registerMessageAtomic('', '+521234567890');
            expect(result3.isDuplicate).toBe(false);
            expect(result3.retryCount).toBe(0);
        });

        it('debe manejar error de BD devolviendo isDuplicate=false (fail-open)', async () => {
            const messageId = 'wamid.ABC123';
            const telefono = '+521234567890';

            // Simular error de BD
            mockQuery.mockRejectedValue(new Error('Connection timeout'));

            const result = await SesionRepository.registerMessageAtomic(messageId, telefono);

            // En caso de error, permitir procesar (mejor duplicar que perder mensaje)
            expect(result.isDuplicate).toBe(false);
            expect(result.retryCount).toBe(0);
            expect(result.error).toBe('Connection timeout');
        });

        it('debe manejar resultado vacio del MERGE devolviendo fallback', async () => {
            const messageId = 'wamid.ABC123';
            const telefono = '+521234567890';

            // Simular respuesta vacía (no debería pasar, pero por si acaso)
            mockQuery.mockResolvedValue({
                recordset: []
            });

            const result = await SesionRepository.registerMessageAtomic(messageId, telefono);

            expect(result.isDuplicate).toBe(false);
            expect(result.retryCount).toBe(0);
        });

        it('debe manejar Reintentos null en resultado del MERGE', async () => {
            const messageId = 'wamid.ABC123';
            const telefono = '+521234567890';

            // Simular resultado con Reintentos null
            mockQuery.mockResolvedValue({
                recordset: [{
                    Action: 'INSERT',
                    WhatsAppMessageId: messageId,
                    FechaCreacion: new Date('2026-02-03T10:00:00Z'),
                    Reintentos: null
                }]
            });

            const result = await SesionRepository.registerMessageAtomic(messageId, telefono);

            // Debe usar 0 si Reintentos es null
            expect(result.retryCount).toBe(0);
        });
    });

    describe('Atomicidad del MERGE', () => {
        it('debe ejecutar MERGE en una sola operacion atomica', async () => {
            const messageId = 'wamid.ABC123';
            const telefono = '+521234567890';

            mockQuery.mockResolvedValue({
                recordset: [{
                    Action: 'INSERT',
                    WhatsAppMessageId: messageId,
                    FechaCreacion: new Date(),
                    Reintentos: 0
                }]
            });

            await SesionRepository.registerMessageAtomic(messageId, telefono);

            // Verificar que el query contiene MERGE (operación atómica)
            const query = mockQuery.mock.calls[0][0];
            expect(query).toContain('MERGE INTO MensajesProcessados');
            expect(query).toContain('WHEN MATCHED THEN');
            expect(query).toContain('WHEN NOT MATCHED THEN');
            expect(query).toContain('Reintentos = Reintentos + 1');
            expect(query).toContain('UltimoReintento = GETDATE()');
        });

        it('MERGE debe actualizar UltimoReintento en duplicados', async () => {
            const messageId = 'wamid.ABC123';
            const telefono = '+521234567890';

            mockQuery.mockResolvedValue({
                recordset: [{
                    Action: 'UPDATE',
                    WhatsAppMessageId: messageId,
                    FechaCreacion: new Date(),
                    Reintentos: 5
                }]
            });

            await SesionRepository.registerMessageAtomic(messageId, telefono);

            // Verificar que el query actualiza UltimoReintento
            const query = mockQuery.mock.calls[0][0];
            expect(query).toContain('UltimoReintento = GETDATE()');
        });

        it('MERGE debe insertar con Reintentos=0 para mensajes nuevos', async () => {
            const messageId = 'wamid.ABC123';
            const telefono = '+521234567890';

            mockQuery.mockResolvedValue({
                recordset: [{
                    Action: 'INSERT',
                    WhatsAppMessageId: messageId,
                    FechaCreacion: new Date(),
                    Reintentos: 0
                }]
            });

            await SesionRepository.registerMessageAtomic(messageId, telefono);

            // Verificar que el query inserta con Reintentos=0
            const query = mockQuery.mock.calls[0][0];
            expect(query).toContain('VALUES (source.WhatsAppMessageId, source.Telefono, 0, GETDATE())');
        });
    });
});
