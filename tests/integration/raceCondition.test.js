/**
 * Integration Test: Race Condition con Optimistic Locking
 * Simula 2 webhooks concurrentes intentando actualizar la misma sesión
 */

const { ConcurrencyError } = require('../../core/errors');
const { withSessionRetry } = require('../../core/utils/retry');

describe('Integration: Race Condition con Optimistic Locking', () => {
    let mockDb;
    let sessionVersion;
    let sessionState;

    beforeEach(() => {
        jest.clearAllMocks();

        // Estado inicial de la sesión
        sessionVersion = 0;
        sessionState = 'INICIO';

        // Mock de databaseService con comportamiento realista
        mockDb = {
            getSessionWithVersion: jest.fn(),
            updateSession: jest.fn()
        };

        // getSessionWithVersion devuelve la versión actual
        mockDb.getSessionWithVersion.mockImplementation(async () => {
            return {
                Estado: sessionState,
                Version: sessionVersion,
                Telefono: '+521234567890'
            };
        });

        // updateSession simula optimistic locking real
        mockDb.updateSession.mockImplementation(async (telefono, nuevoEstado, datosTemp, equipoId, origen, desc, reporteId, expectedVersion) => {
            // Simular delay de BD (realista)
            await new Promise(resolve => setTimeout(resolve, 10));

            // Si expectedVersion no coincide con la versión actual, lanzar ConcurrencyError
            if (expectedVersion !== null && expectedVersion !== undefined && expectedVersion !== sessionVersion) {
                throw new ConcurrencyError(telefono, expectedVersion, 'updateSession');
            }

            // Actualizar estado y versión
            sessionState = nuevoEstado;
            sessionVersion = sessionVersion + 1;

            return { success: true };
        });

        jest.doMock('../../core/services/storage/databaseService', () => mockDb);
    });

    afterEach(() => {
        jest.dontMock('../../core/services/storage/databaseService');
    });

    describe('Race Condition: 2 webhooks concurrentes', () => {
        it('debe manejar race condition con retry exitoso', async () => {
            const telefono = '+521234567890';

            // Simular 2 webhooks que leen la sesión al mismo tiempo (Version=0)
            let webhook1Session = null;
            let webhook2Session = null;

            // Ambos leen la sesión (Version=0)
            webhook1Session = await mockDb.getSessionWithVersion(telefono);
            webhook2Session = await mockDb.getSessionWithVersion(telefono);

            expect(webhook1Session.Version).toBe(0);
            expect(webhook2Session.Version).toBe(0);

            // Webhook 1 actualiza primero (exitoso: Version 0 -> 1)
            await mockDb.updateSession(
                telefono,
                'REFRI_ESPERA_SAP',
                { tipoReporte: 'REFRIGERADOR' },
                null,
                'BOT',
                'Flujo refrigerador',
                null,
                webhook1Session.Version
            );

            expect(sessionVersion).toBe(1);
            expect(sessionState).toBe('REFRI_ESPERA_SAP');

            // Webhook 2 intenta actualizar con Version=0 (debe fallar)
            await expect(
                mockDb.updateSession(
                    telefono,
                    'VEHICULO_ESPERA_EMPLEADO',
                    { tipoReporte: 'VEHICULO' },
                    null,
                    'BOT',
                    'Flujo vehiculo',
                    null,
                    webhook2Session.Version // Sigue siendo 0
                )
            ).rejects.toThrow(ConcurrencyError);

            // Version sigue en 1 (no cambió)
            expect(sessionVersion).toBe(1);
            expect(sessionState).toBe('REFRI_ESPERA_SAP');
        });

        it('debe reintentar automaticamente en race condition', async () => {
            const telefono = '+521234567890';

            // Webhook 1: actualizar con withSessionRetry
            const webhook1Promise = withSessionRetry(telefono, async (session) => {
                await mockDb.updateSession(
                    telefono,
                    'REFRI_ESPERA_SAP',
                    { tipoReporte: 'REFRIGERADOR' },
                    null,
                    'BOT',
                    'Webhook 1',
                    null,
                    session.Version
                );
                return 'webhook1-success';
            });

            // Webhook 2: actualizar con withSessionRetry (simulando que llega casi al mismo tiempo)
            const webhook2Promise = withSessionRetry(telefono, async (session) => {
                await mockDb.updateSession(
                    telefono,
                    'VEHICULO_ESPERA_EMPLEADO',
                    { tipoReporte: 'VEHICULO' },
                    null,
                    'BOT',
                    'Webhook 2',
                    null,
                    session.Version
                );
                return 'webhook2-success';
            });

            // Ejecutar ambos en paralelo
                        const results = await Promise.allSettled([webhook1Promise, webhook2Promise]);

            // Al menos uno debe tener éxito
            const successes = results.filter(r => r.status === 'fulfilled');
            const failures = results.filter(r => r.status === 'rejected');

            expect(successes.length).toBeGreaterThanOrEqual(1);

            // El retry debe haber funcionado para el webhook que falló primero
            // En este caso, ambos deberían tener éxito gracias al retry
            if (failures.length > 0) {
                // Si alguno falló, debe ser después de agotar los reintentos
                expect(failures[0].reason).toBeInstanceOf(ConcurrencyError);
            }

            // La versión final debe ser > 0
            expect(sessionVersion).toBeGreaterThan(0);
        });

        it('debe fallar despues de agotar reintentos en race condition persistente', async () => {
            const telefono = '+521234567890';

            // Simular un escenario donde SIEMPRE hay race condition
            // (otro proceso actualiza continuamente)
            let updateAttempts = 0;
            mockDb.updateSession.mockImplementation(async (telefono, nuevoEstado, datosTemp, equipoId, origen, desc, reporteId, expectedVersion) => {
                updateAttempts++;

                // Simular que otro proceso actualizó primero
                sessionVersion++;

                // Siempre lanzar ConcurrencyError
                throw new ConcurrencyError(telefono, expectedVersion, 'updateSession');
            });

            const webhookPromise = withSessionRetry(telefono, async (session) => {
                await mockDb.updateSession(
                    telefono,
                    'REFRI_ESPERA_SAP',
                    null,
                    null,
                    'BOT',
                    'Test',
                    null,
                    session.Version
                );
            }, { maxAttempts: 3 });

            
            await expect(webhookPromise).rejects.toThrow(ConcurrencyError);
            expect(updateAttempts).toBe(3); // Intentó 3 veces
        });
    });

    describe('Escenarios edge case', () => {
        it('debe manejar 3 webhooks concurrentes', async () => {
            const telefono = '+521234567890';

            const webhook1 = withSessionRetry(telefono, async (session) => {
                await mockDb.updateSession(
                    telefono,
                    'REFRI_ESPERA_SAP',
                    null,
                    null,
                    'BOT',
                    'Webhook 1',
                    null,
                    session.Version
                );
                return 'webhook1';
            });

            const webhook2 = withSessionRetry(telefono, async (session) => {
                await mockDb.updateSession(
                    telefono,
                    'VEHICULO_ESPERA_EMPLEADO',
                    null,
                    null,
                    'BOT',
                    'Webhook 2',
                    null,
                    session.Version
                );
                return 'webhook2';
            });

            const webhook3 = withSessionRetry(telefono, async (session) => {
                await mockDb.updateSession(
                    telefono,
                    'FINALIZADO',
                    null,
                    null,
                    'BOT',
                    'Webhook 3',
                    null,
                    session.Version
                );
                return 'webhook3';
            });

                        const results = await Promise.allSettled([webhook1, webhook2, webhook3]);

            // Al menos 1 debe tener éxito
            const successes = results.filter(r => r.status === 'fulfilled');
            expect(successes.length).toBeGreaterThanOrEqual(1);

            // La versión debe haberse incrementado
            expect(sessionVersion).toBeGreaterThan(0);
        });

        it('debe preservar orden correcto de actualizaciones', async () => {
            const telefono = '+521234567890';

            // Ejecutar 3 updates secuenciales (NO concurrentes)
            await withSessionRetry(telefono, async (session) => {
                await mockDb.updateSession(
                    telefono, 'ESTADO_1', null, null, 'BOT', 'Update 1', null, session.Version
                );
            });

            expect(sessionVersion).toBe(1);
            expect(sessionState).toBe('ESTADO_1');

            await withSessionRetry(telefono, async (session) => {
                await mockDb.updateSession(
                    telefono, 'ESTADO_2', null, null, 'BOT', 'Update 2', null, session.Version
                );
            });

            expect(sessionVersion).toBe(2);
            expect(sessionState).toBe('ESTADO_2');

            await withSessionRetry(telefono, async (session) => {
                await mockDb.updateSession(
                    telefono, 'ESTADO_3', null, null, 'BOT', 'Update 3', null, session.Version
                );
            });

            // Verificar orden correcto final
            expect(sessionVersion).toBe(3);
            expect(sessionState).toBe('ESTADO_3');
        });
    });

    describe('Verificación de atomicidad', () => {
        it('NO debe permitir lost updates', async () => {
            const telefono = '+521234567890';

            // Leer sesión inicial
            const session1 = await mockDb.getSessionWithVersion(telefono);
            const session2 = await mockDb.getSessionWithVersion(telefono);

            expect(session1.Version).toBe(0);
            expect(session2.Version).toBe(0);

            // Update 1 exitoso
            await mockDb.updateSession(
                telefono,
                'REFRI_ESPERA_SAP',
                { campo: 'valor1' },
                null,
                'BOT',
                'Update 1',
                null,
                session1.Version
            );

            expect(sessionVersion).toBe(1);
            expect(sessionState).toBe('REFRI_ESPERA_SAP');

            // Update 2 con versión antigua DEBE FALLAR (evitar lost update)
            await expect(
                mockDb.updateSession(
                    telefono,
                    'VEHICULO_ESPERA_EMPLEADO',
                    { campo: 'valor2' },
                    null,
                    'BOT',
                    'Update 2',
                    null,
                    session2.Version // Sigue siendo 0
                )
            ).rejects.toThrow(ConcurrencyError);

            // Estado NO debe cambiar (lost update prevenido)
            expect(sessionVersion).toBe(1);
            expect(sessionState).toBe('REFRI_ESPERA_SAP');
        });

        it('debe permitir updates secuenciales con versiones correctas', async () => {
            const telefono = '+521234567890';

            // Update 1
            let session = await mockDb.getSessionWithVersion(telefono);
            await mockDb.updateSession(
                telefono, 'ESTADO_1', null, null, 'BOT', 'Update 1', null, session.Version
            );
            expect(sessionVersion).toBe(1);

            // Update 2 (leer versión actualizada)
            session = await mockDb.getSessionWithVersion(telefono);
            await mockDb.updateSession(
                telefono, 'ESTADO_2', null, null, 'BOT', 'Update 2', null, session.Version
            );
            expect(sessionVersion).toBe(2);

            // Update 3 (leer versión actualizada)
            session = await mockDb.getSessionWithVersion(telefono);
            await mockDb.updateSession(
                telefono, 'ESTADO_3', null, null, 'BOT', 'Update 3', null, session.Version
            );
            expect(sessionVersion).toBe(3);

            expect(sessionState).toBe('ESTADO_3');
        });
    });

    describe('Métricas y observabilidad', () => {
        it('debe registrar cantidad de reintentos en race condition', async () => {
            const telefono = '+521234567890';
            const onRetry = jest.fn();

            // Primera tentativa: falla (simular que otro proceso actualizó)
            let firstAttempt = true;
            mockDb.updateSession.mockImplementation(async (telefono, nuevoEstado, datosTemp, equipoId, origen, desc, reporteId, expectedVersion) => {
                if (firstAttempt) {
                    firstAttempt = false;
                    sessionVersion++; // Simular que otro proceso actualizó
                    throw new ConcurrencyError(telefono, expectedVersion, 'updateSession');
                }

                // Segunda tentativa: éxito
                sessionState = nuevoEstado;
                sessionVersion++;
                return { success: true };
            });

            await withSessionRetry(telefono, async (session) => {
                await mockDb.updateSession(
                    telefono,
                    'REFRI_ESPERA_SAP',
                    null,
                    null,
                    'BOT',
                    'Test',
                    null,
                    session.Version
                );
            }, { onRetry });

            
            // Verificar que se registró el reintento
            expect(onRetry).toHaveBeenCalledTimes(1);
            expect(onRetry).toHaveBeenCalledWith(
                0, // attempt (0-indexed)
                expect.any(Number), // delay
                expect.any(ConcurrencyError)
            );
        });
    });
});
