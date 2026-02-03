/**
 * Tests para CorrelationService
 * Valida generacion y propagacion de correlation IDs para tracing
 */

describe('CorrelationService', () => {
    let correlation;

    beforeEach(() => {
        jest.resetModules();
        correlation = require('../../core/services/infrastructure/correlationService');
    });

    describe('generateCorrelationId', () => {
        it('debe generar ID unico', () => {
            const id1 = correlation.generateCorrelationId();
            const id2 = correlation.generateCorrelationId();
            expect(id1).not.toBe(id2);
        });

        it('debe tener formato correcto (YYYYMMDD-HHMMSS-XXXXXX)', () => {
            const id = correlation.generateCorrelationId();
            // Formato: 20260126-153045-A1B2C3
            expect(id).toMatch(/^\d{8}-\d{6}-[A-F0-9]{6}$/);
        });

        it('debe empezar con fecha actual', () => {
            const id = correlation.generateCorrelationId();
            const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            expect(id.startsWith(today)).toBe(true);
        });
    });

    describe('generateShortId', () => {
        it('debe generar ID corto unico', () => {
            const id1 = correlation.generateShortId();
            const id2 = correlation.generateShortId();
            expect(id1).not.toBe(id2);
        });

        it('debe tener 8 caracteres hexadecimales', () => {
            const id = correlation.generateShortId();
            expect(id).toMatch(/^[A-F0-9]{8}$/);
        });
    });

    describe('runWithCorrelation', () => {
        it('debe ejecutar funcion con contexto', async () => {
            let capturedId = null;

            await correlation.runWithCorrelation(async () => {
                capturedId = correlation.getCorrelationId();
            });

            expect(capturedId).toBeTruthy();
            expect(capturedId).toMatch(/^\d{8}-\d{6}-[A-F0-9]{6}$/);
        });

        it('debe usar correlation ID proporcionado', async () => {
            const customId = 'CUSTOM-123';
            let capturedId = null;

            await correlation.runWithCorrelation(
                async () => {
                    capturedId = correlation.getCorrelationId();
                },
                { correlationId: customId }
            );

            expect(capturedId).toBe(customId);
        });

        it('debe incluir startTime en contexto', async () => {
            let context = null;

            await correlation.runWithCorrelation(async () => {
                context = correlation.getContext();
            });

            expect(context.startTime).toBeDefined();
            expect(typeof context.startTime).toBe('number');
        });

        it('debe propagar contexto a funciones anidadas', async () => {
            let innerCapturedId = null;

            await correlation.runWithCorrelation(async () => {
                const outerId = correlation.getCorrelationId();

                // Funcion anidada
                await (async () => {
                    innerCapturedId = correlation.getCorrelationId();
                })();

                expect(innerCapturedId).toBe(outerId);
            });
        });
    });

    describe('getCorrelationId', () => {
        it('debe retornar null fuera de contexto', () => {
            const id = correlation.getCorrelationId();
            expect(id).toBeNull();
        });

        it('debe retornar ID dentro de contexto', async () => {
            await correlation.runWithCorrelation(async () => {
                const id = correlation.getCorrelationId();
                expect(id).toBeTruthy();
            });
        });
    });

    describe('getContext', () => {
        it('debe retornar objeto vacio fuera de contexto', () => {
            const ctx = correlation.getContext();
            expect(ctx).toEqual({});
        });

        it('debe retornar contexto completo dentro de runWithCorrelation', async () => {
            await correlation.runWithCorrelation(async () => {
                const ctx = correlation.getContext();
                expect(ctx).toHaveProperty('correlationId');
                expect(ctx).toHaveProperty('startTime');
            }, { extra: 'data' });
        });
    });

    describe('addToContext', () => {
        it('debe agregar datos al contexto actual', async () => {
            await correlation.runWithCorrelation(async () => {
                correlation.addToContext({ userId: '123', action: 'test' });
                const ctx = correlation.getContext();
                expect(ctx.userId).toBe('123');
                expect(ctx.action).toBe('test');
            });
        });

        it('debe no hacer nada fuera de contexto', () => {
            expect(() => {
                correlation.addToContext({ test: 'value' });
            }).not.toThrow();
        });
    });

    describe('createContextFromRequest', () => {
        it('debe extraer correlation ID de headers', () => {
            const req = {
                headers: { 'x-correlation-id': 'existing-id-123' },
                query: {},
                body: {}
            };

            const ctx = correlation.createContextFromRequest(req);
            expect(ctx.correlationId).toBe('existing-id-123');
        });

        it('debe generar nuevo ID si no hay header', () => {
            const req = {
                headers: {},
                query: {},
                body: {}
            };

            const ctx = correlation.createContextFromRequest(req);
            expect(ctx.correlationId).toBeTruthy();
            expect(ctx.correlationId).toMatch(/^\d{8}-\d{6}-[A-F0-9]{6}$/);
        });

        it('debe extraer messageId y from de WhatsApp body', () => {
            const req = {
                headers: {},
                query: {},
                body: {
                    entry: [{
                        changes: [{
                            value: {
                                messages: [{
                                    id: 'wamid.123',
                                    from: '5218112345678'
                                }]
                            }
                        }]
                    }]
                }
            };

            const ctx = correlation.createContextFromRequest(req);
            expect(ctx.messageId).toBe('wamid.123');
            expect(ctx.from).toBe('5218112345678');
        });

        it('debe extraer metodo y ruta', () => {
            const req = {
                headers: {},
                query: {},
                body: {},
                method: 'POST',
                url: '/api/webhook'
            };

            const ctx = correlation.createContextFromRequest(req);
            expect(ctx.method).toBe('POST');
            expect(ctx.route).toBe('/api/webhook');
        });
    });

    describe('formatLogMessage', () => {
        it('debe incluir correlation ID y timestamp', async () => {
            await correlation.runWithCorrelation(async () => {
                const formatted = correlation.formatLogMessage('Test message');
                expect(formatted.message).toBe('Test message');
                expect(formatted.correlationId).toBeTruthy();
                expect(formatted.timestamp).toBeTruthy();
            });
        });

        it('debe incluir datos adicionales', async () => {
            await correlation.runWithCorrelation(async () => {
                const formatted = correlation.formatLogMessage('Test', { extra: 'data' });
                expect(formatted.extra).toBe('data');
            });
        });

        it('debe funcionar fuera de contexto', () => {
            const formatted = correlation.formatLogMessage('Test');
            expect(formatted.message).toBe('Test');
            expect(formatted.correlationId).toBeNull();
        });
    });

    describe('getElapsedMs', () => {
        it('debe retornar tiempo transcurrido', async () => {
            await correlation.runWithCorrelation(async () => {
                await new Promise(resolve => { setTimeout(resolve, 50); });
                const elapsed = correlation.getElapsedMs();
                expect(elapsed).toBeGreaterThanOrEqual(50);
                expect(elapsed).toBeLessThan(200);
            });
        });

        it('debe retornar null fuera de contexto', () => {
            const elapsed = correlation.getElapsedMs();
            expect(elapsed).toBeNull();
        });
    });

    describe('withCorrelation middleware', () => {
        it('debe agregar correlation ID al context de Azure', async () => {
            const mockContext = {
                log: jest.fn(),
                res: {}
            };
            mockContext.log.error = jest.fn();
            mockContext.log.warn = jest.fn();
            mockContext.log.info = jest.fn();

            const mockReq = {
                headers: {},
                query: {},
                body: {},
                method: 'GET'
            };

            const handler = async (context, _req) => {
                expect(context.correlationId).toBeTruthy();
            };

            const wrappedHandler = correlation.withCorrelation(handler);
            await wrappedHandler(mockContext, mockReq);

            expect(mockContext.correlationId).toBeTruthy();
        });

        it('debe incluir correlation ID en logs', async () => {
            const logCalls = [];
            const mockContext = {
                log: jest.fn((...args) => logCalls.push(args)),
                res: {}
            };
            mockContext.log.error = jest.fn();
            mockContext.log.warn = jest.fn();
            mockContext.log.info = jest.fn();

            const mockReq = {
                headers: {},
                query: {},
                body: {}
            };

            const handler = async (context, _req) => {
                context.log('Test message');
            };

            const wrappedHandler = correlation.withCorrelation(handler);
            await wrappedHandler(mockContext, mockReq);

            expect(logCalls.length).toBeGreaterThan(0);
            expect(logCalls[0][0]).toMatch(/^\[.+\]/); // Empieza con [correlationId]
        });
    });
});
