/**
 * Tests - Encuesta Flow
 * Pruebas del flujo de encuesta de satisfacción
 */

// Mocks
jest.mock('../../core/services/external/whatsappService', () => require('../__mocks__/whatsappService'));
jest.mock('../../core/services/storage/databaseService', () => require('../__mocks__/databaseService'));
jest.mock('../../core/config', () => require('../__mocks__/config'));

jest.mock('../../bot/repositories/EncuestaRepository', () => ({
    getEncuestaCompletaByTelefono: jest.fn().mockResolvedValue({
        EncuestaId: 1,
        ReporteId: 100,
        NumeroTicket: 'TKT-12345678',
        PreguntaActual: 0,
        Estado: 'ENVIADA',
        TipoEncuestaId: 1,
        TipoEncuestaCodigo: 'SATISFACCION_SERVICIO',
        NumeroPreguntas: 6,
        TienePasoComentario: true,
        MensajeAgradecimiento: null
    }),
    getPreguntasByTipo: jest.fn().mockResolvedValue([
        { NumeroPregunta: 1, TextoPregunta: '¿Cómo calificarías la rapidez del servicio?' },
        { NumeroPregunta: 2, TextoPregunta: '¿Cómo calificarías la amabilidad del técnico?' },
        { NumeroPregunta: 3, TextoPregunta: '¿Cómo calificarías la solución brindada?' },
        { NumeroPregunta: 4, TextoPregunta: '¿Cómo calificarías la comunicación?' },
        { NumeroPregunta: 5, TextoPregunta: '¿Cómo calificarías tu experiencia general?' },
        { NumeroPregunta: 6, TextoPregunta: '¿Recomendarías nuestro servicio?' }
    ]),
    updateEstado: jest.fn().mockResolvedValue(true),
    verificarEstadoEncuesta: jest.fn().mockResolvedValue({ valido: true, preguntaActual: 0 }),
    guardarRespuestaAtomica: jest.fn().mockResolvedValue({
        success: true,
        alreadyAnswered: false,
        nuevaPreguntaActual: 1
    }),
    guardarComentario: jest.fn().mockResolvedValue(true),
    finalizarSinComentario: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../core/services/infrastructure/errorHandler', () => ({
    logger: {
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        debug: jest.fn()
    }
}));

const encuestaFlow = require('../../bot/controllers/flows/encuestaFlow');
const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');
const EncuestaRepository = require('../../bot/repositories/EncuestaRepository');

describe('EncuestaFlow', () => {
    let mockContext;
    const testPhone = '+5215540829614';

    beforeEach(() => {
        jest.clearAllMocks();
        whatsapp.__reset();
        db.__reset();
        encuestaFlow.clearEncuestaCache(testPhone);

        mockContext = {
            log: jest.fn(),
            log_error: jest.fn()
        };

        // Reset repository mocks
        EncuestaRepository.getEncuestaCompletaByTelefono.mockResolvedValue({
            EncuestaId: 1,
            ReporteId: 100,
            NumeroTicket: 'TKT-12345678',
            PreguntaActual: 0,
            Estado: 'ENVIADA',
            TipoEncuestaId: 1,
            TipoEncuestaCodigo: 'SATISFACCION_SERVICIO',
            NumeroPreguntas: 6,
            TienePasoComentario: true,
            MensajeAgradecimiento: null
        });

        EncuestaRepository.verificarEstadoEncuesta.mockResolvedValue({
            valido: true,
            preguntaActual: 0
        });

        EncuestaRepository.guardarRespuestaAtomica.mockResolvedValue({
            success: true,
            alreadyAnswered: false,
            nuevaPreguntaActual: 1
        });
    });

    describe('iniciarEncuesta', () => {
        test('debe iniciar encuesta exitosamente', async () => {
            const reporte = {
                ReporteId: 100,
                NumeroTicket: 'TKT-12345678',
                NombreCliente: 'OXXO Centro'
            };

            const tipoEncuesta = {
                TipoEncuestaId: 1,
                Codigo: 'SATISFACCION_SERVICIO',
                NumeroPreguntas: 6,
                TienePasoComentario: true
            };

            const result = await encuestaFlow.iniciarEncuesta(
                testPhone,
                reporte,
                1,
                tipoEncuesta,
                []
            );

            expect(result).toBe(true);
            expect(whatsapp.sendInteractiveMessage).toHaveBeenCalled();
            expect(db.updateSession).toHaveBeenCalledWith(
                testPhone,
                'ENCUESTA_INVITACION',
                expect.any(String),
                null,
                'SISTEMA',
                expect.any(String)
            );
        });

        test('debe manejar errores al iniciar encuesta', async () => {
            whatsapp.sendInteractiveMessage.mockRejectedValueOnce(new Error('API Error'));

            const reporte = {
                ReporteId: 100,
                NumeroTicket: 'TKT-12345678',
                NombreCliente: 'OXXO Centro'
            };

            const result = await encuestaFlow.iniciarEncuesta(testPhone, reporte, 1);

            expect(result).toBe(false);
        });
    });

    describe('handleInvitacion', () => {
        test('debe aceptar encuesta con "aceptar"', async () => {
            const session = {
                Estado: 'ENCUESTA_INVITACION',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleInvitacion(testPhone, 'aceptar', session, mockContext);

            expect(EncuestaRepository.updateEstado).toHaveBeenCalledWith(1, 'EN_PROCESO');
            expect(whatsapp.sendText).toHaveBeenCalled();
        });

        test('debe aceptar encuesta con "si"', async () => {
            const session = {
                Estado: 'ENCUESTA_INVITACION',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleInvitacion(testPhone, 'si', session, mockContext);

            expect(EncuestaRepository.updateEstado).toHaveBeenCalledWith(1, 'EN_PROCESO');
        });

        test('debe rechazar encuesta con "salir"', async () => {
            const session = {
                Estado: 'ENCUESTA_INVITACION',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleInvitacion(testPhone, 'salir', session, mockContext);

            expect(EncuestaRepository.updateEstado).toHaveBeenCalledWith(1, 'RECHAZADA');
            expect(db.updateSession).toHaveBeenCalledWith(
                testPhone,
                'FINALIZADO',
                null,
                null,
                'USUARIO',
                'Encuesta rechazada'
            );
        });

        test('debe solicitar opción válida si input no reconocido', async () => {
            const session = {
                Estado: 'ENCUESTA_INVITACION',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleInvitacion(testPhone, 'otra cosa', session, mockContext);

            expect(whatsapp.sendInteractiveMessage).toHaveBeenCalled();
        });

        test('debe manejar encuestaId faltante en datosTemp', async () => {
            const session = {
                Estado: 'ENCUESTA_INVITACION',
                DatosTemp: null
            };

            await encuestaFlow.handleInvitacion(testPhone, 'aceptar', session, mockContext);

            expect(EncuestaRepository.updateEstado).toHaveBeenCalled();
        });
    });

    describe('handleRespuestaPregunta', () => {
        test('debe procesar calificación numérica válida', async () => {
            const session = {
                Estado: 'ENCUESTA_PREGUNTA_1',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleRespuestaPregunta(testPhone, '5', session, mockContext);

            expect(EncuestaRepository.guardarRespuestaAtomica).toHaveBeenCalled();
            expect(whatsapp.sendText).toHaveBeenCalled();
        });

        test('debe procesar botón de rating', async () => {
            const session = {
                Estado: 'ENCUESTA_PREGUNTA_1',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleRespuestaPregunta(testPhone, 'btn_rating_5', session, mockContext);

            expect(EncuestaRepository.guardarRespuestaAtomica).toHaveBeenCalled();
        });

        test('debe rechazar calificación inválida', async () => {
            const session = {
                Estado: 'ENCUESTA_PREGUNTA_1',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleRespuestaPregunta(testPhone, 'invalid', session, mockContext);

            expect(whatsapp.sendText).toHaveBeenCalledWith(
                testPhone,
                expect.stringContaining('Por favor')
            );
        });

        test('debe detectar race condition y no procesar duplicado', async () => {
            EncuestaRepository.verificarEstadoEncuesta.mockResolvedValueOnce({
                valido: false,
                preguntaActual: 1
            });

            const session = {
                Estado: 'ENCUESTA_PREGUNTA_1',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleRespuestaPregunta(testPhone, '5', session, mockContext);

            expect(EncuestaRepository.guardarRespuestaAtomica).not.toHaveBeenCalled();
        });

        test('debe pasar a comentario en última pregunta', async () => {
            EncuestaRepository.verificarEstadoEncuesta.mockResolvedValueOnce({
                valido: true,
                preguntaActual: 5
            });

            EncuestaRepository.guardarRespuestaAtomica.mockResolvedValueOnce({
                success: true,
                alreadyAnswered: false,
                nuevaPreguntaActual: 6
            });

            EncuestaRepository.getEncuestaCompletaByTelefono.mockResolvedValueOnce({
                EncuestaId: 1,
                PreguntaActual: 5,
                NumeroPreguntas: 6,
                TienePasoComentario: true,
                preguntas: []
            });

            const session = {
                Estado: 'ENCUESTA_PREGUNTA_6',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleRespuestaPregunta(testPhone, '5', session, mockContext);

            expect(whatsapp.sendInteractiveMessage).toHaveBeenCalled();
        });

        test('debe manejar palabras como calificación', async () => {
            const session = {
                Estado: 'ENCUESTA_PREGUNTA_1',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleRespuestaPregunta(testPhone, 'excelente', session, mockContext);

            expect(EncuestaRepository.guardarRespuestaAtomica).toHaveBeenCalled();
        });
    });

    describe('handleComentarioDecision', () => {
        test('debe procesar "si" y solicitar comentario', async () => {
            const session = {
                Estado: 'ENCUESTA_COMENTARIO',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleComentarioDecision(testPhone, 'si', session, mockContext);

            expect(whatsapp.sendText).toHaveBeenCalled();
            expect(db.updateSession).toHaveBeenCalledWith(
                testPhone,
                'ENCUESTA_ESPERA_COMENTARIO',
                expect.any(String),
                null,
                'USUARIO',
                'Quiere comentar'
            );
        });

        test('debe procesar "no" y finalizar encuesta', async () => {
            const session = {
                Estado: 'ENCUESTA_COMENTARIO',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleComentarioDecision(testPhone, 'no', session, mockContext);

            expect(EncuestaRepository.finalizarSinComentario).toHaveBeenCalled();
        });

        test('debe reenviar botones para respuesta no reconocida', async () => {
            const session = {
                Estado: 'ENCUESTA_COMENTARIO',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleComentarioDecision(testPhone, 'quizas', session, mockContext);

            expect(whatsapp.sendInteractiveMessage).toHaveBeenCalled();
        });
    });

    describe('handleComentario', () => {
        test('debe guardar comentario y finalizar encuesta', async () => {
            const session = {
                Estado: 'ENCUESTA_ESPERA_COMENTARIO',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleComentario(
                testPhone,
                'Excelente servicio, muy rápido!',
                session,
                mockContext
            );

            expect(EncuestaRepository.guardarComentario).toHaveBeenCalledWith(
                1,
                'Excelente servicio, muy rápido!'
            );
            expect(db.updateSession).toHaveBeenCalledWith(
                testPhone,
                'FINALIZADO',
                null,
                null,
                'BOT',
                'Encuesta completada'
            );
        });

        test('debe manejar encuestaId faltante', async () => {
            EncuestaRepository.getEncuestaCompletaByTelefono.mockResolvedValueOnce(null);

            const session = {
                Estado: 'ENCUESTA_ESPERA_COMENTARIO',
                DatosTemp: null
            };

            await encuestaFlow.handleComentario(testPhone, 'Comentario', session, mockContext);

            expect(whatsapp.sendText).toHaveBeenCalledWith(
                testPhone,
                expect.stringContaining('error')
            );
        });
    });

    describe('Button Handlers', () => {
        test('handleBotonAceptar debe aceptar encuesta', async () => {
            const session = {
                Estado: 'ENCUESTA_INVITACION',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleBotonAceptar(testPhone, session, mockContext);

            expect(EncuestaRepository.updateEstado).toHaveBeenCalledWith(1, 'EN_PROCESO');
        });

        test('handleBotonSalir debe rechazar encuesta', async () => {
            const session = {
                Estado: 'ENCUESTA_INVITACION',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleBotonSalir(testPhone, session, mockContext);

            expect(EncuestaRepository.updateEstado).toHaveBeenCalledWith(1, 'RECHAZADA');
        });

        test('handleBotonRating debe procesar rating', async () => {
            const session = {
                Estado: 'ENCUESTA_PREGUNTA_1',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleBotonRating(testPhone, 5, session, mockContext);

            expect(EncuestaRepository.guardarRespuestaAtomica).toHaveBeenCalled();
        });

        test('handleBotonSiComentario debe solicitar comentario', async () => {
            const session = {
                Estado: 'ENCUESTA_COMENTARIO',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleBotonSiComentario(testPhone, session, mockContext);

            expect(db.updateSession).toHaveBeenCalledWith(
                testPhone,
                'ENCUESTA_ESPERA_COMENTARIO',
                expect.any(String),
                null,
                'USUARIO',
                'Quiere comentar'
            );
        });

        test('handleBotonNoComentario debe finalizar sin comentario', async () => {
            const session = {
                Estado: 'ENCUESTA_COMENTARIO',
                DatosTemp: JSON.stringify({ encuestaId: 1 })
            };

            await encuestaFlow.handleBotonNoComentario(testPhone, session, mockContext);

            expect(EncuestaRepository.finalizarSinComentario).toHaveBeenCalled();
        });
    });

    describe('clearEncuestaCache', () => {
        test('debe limpiar cache para un teléfono', () => {
            // No debería lanzar error
            expect(() => encuestaFlow.clearEncuestaCache(testPhone)).not.toThrow();
        });
    });
});
