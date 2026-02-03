/**
 * Mock - EncuestaRepository
 * Simula funciones del repositorio de encuestas
 */

const mockEncuestaRepository = {
    __reset: () => {
        mockEncuestaRepository.getEncuestaCompletaByTelefono.mockClear();
        mockEncuestaRepository.getPreguntasByTipo.mockClear();
        mockEncuestaRepository.updateEstado.mockClear();
        mockEncuestaRepository.verificarEstadoEncuesta.mockClear();
        mockEncuestaRepository.guardarRespuestaAtomica.mockClear();
        mockEncuestaRepository.guardarComentario.mockClear();
        mockEncuestaRepository.finalizarSinComentario.mockClear();
    },

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
        { NumeroPregunta: 1, TextoPregunta: 'Pregunta 1' },
        { NumeroPregunta: 2, TextoPregunta: 'Pregunta 2' },
        { NumeroPregunta: 3, TextoPregunta: 'Pregunta 3' },
        { NumeroPregunta: 4, TextoPregunta: 'Pregunta 4' },
        { NumeroPregunta: 5, TextoPregunta: 'Pregunta 5' },
        { NumeroPregunta: 6, TextoPregunta: 'Pregunta 6' }
    ]),

    updateEstado: jest.fn().mockResolvedValue(true),

    verificarEstadoEncuesta: jest.fn().mockResolvedValue({
        valido: true,
        preguntaActual: 0
    }),

    guardarRespuestaAtomica: jest.fn().mockResolvedValue({
        success: true,
        alreadyAnswered: false,
        nuevaPreguntaActual: 1
    }),

    guardarComentario: jest.fn().mockResolvedValue(true),

    finalizarSinComentario: jest.fn().mockResolvedValue(true),

    create: jest.fn().mockResolvedValue(1),

    getReportesPendientesEncuesta: jest.fn().mockResolvedValue([]),

    expirarSinRespuesta: jest.fn().mockResolvedValue(0)
};

module.exports = mockEncuestaRepository;
