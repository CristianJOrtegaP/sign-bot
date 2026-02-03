/**
 * AC FIXBOT - Fixtures de Sesiones Mock
 * Datos de prueba reutilizables para tests de sesion
 */

const { ESTADO_SESION } = require('../../bot/constants/sessionStates');

// Sesion en estado inicial
const sessionInicio = {
    SesionId: 1,
    Telefono: '5215512345678',
    Estado: ESTADO_SESION.INICIO,
    EstadoId: 1,
    TipoReporte: null,
    DatosTemporales: null,
    FechaCreacion: new Date('2024-01-01T10:00:00Z'),
    FechaActualizacion: new Date('2024-01-01T10:00:00Z'),
    AdvertenciaTimeoutEnviada: false
};

// Sesion esperando codigo SAP de refrigerador
const sessionEsperaSAP = {
    SesionId: 2,
    Telefono: '5215512345678',
    Estado: ESTADO_SESION.REFRI_ESPERA_SAP,
    EstadoId: 5,
    TipoReporte: 'REFRIGERADOR',
    DatosTemporales: JSON.stringify({ descripcionDetectada: 'No enfria' }),
    FechaCreacion: new Date('2024-01-01T10:00:00Z'),
    FechaActualizacion: new Date('2024-01-01T10:05:00Z'),
    AdvertenciaTimeoutEnviada: false
};

// Sesion esperando confirmacion de equipo
const sessionConfirmarEquipo = {
    SesionId: 3,
    Telefono: '5215512345678',
    Estado: ESTADO_SESION.REFRI_CONFIRMAR_EQUIPO,
    EstadoId: 6,
    TipoReporte: 'REFRIGERADOR',
    DatosTemporales: JSON.stringify({
        descripcionDetectada: 'No enfria',
        codigoSAP: '4045101',
        equipoId: 1
    }),
    FechaCreacion: new Date('2024-01-01T10:00:00Z'),
    FechaActualizacion: new Date('2024-01-01T10:10:00Z'),
    AdvertenciaTimeoutEnviada: false
};

// Sesion en flujo de encuesta
const sessionEncuesta = {
    SesionId: 4,
    Telefono: '5215512345678',
    Estado: ESTADO_SESION.ENCUESTA_PREGUNTA_1,
    EstadoId: 13,
    TipoReporte: null,
    DatosTemporales: JSON.stringify({
        encuestaId: 1,
        preguntaActual: 1,
        totalPreguntas: 6
    }),
    FechaCreacion: new Date('2024-01-01T10:00:00Z'),
    FechaActualizacion: new Date('2024-01-01T10:15:00Z'),
    AdvertenciaTimeoutEnviada: false
};

// Sesion con timeout proximo
const sessionProximaTimeout = {
    SesionId: 5,
    Telefono: '5215512345678',
    Estado: ESTADO_SESION.REFRI_ESPERA_SAP,
    EstadoId: 5,
    TipoReporte: 'REFRIGERADOR',
    DatosTemporales: null,
    FechaCreacion: new Date(Date.now() - 26 * 60 * 1000), // 26 minutos atras
    FechaActualizacion: new Date(Date.now() - 26 * 60 * 1000),
    AdvertenciaTimeoutEnviada: false
};

/**
 * Crea una sesion mock personalizada
 * @param {Object} overrides - Propiedades a sobrescribir
 * @returns {Object} - Sesion mock
 */
function createMockSession(overrides = {}) {
    return {
        ...sessionInicio,
        SesionId: Math.floor(Math.random() * 10000),
        FechaCreacion: new Date(),
        FechaActualizacion: new Date(),
        ...overrides
    };
}

/**
 * Crea un equipo mock
 * @param {Object} overrides - Propiedades a sobrescribir
 * @returns {Object} - Equipo mock
 */
function createMockEquipo(overrides = {}) {
    return {
        EquipoId: 1,
        CodigoSAP: '4045101',
        Modelo: 'Top Mount',
        Marca: 'Imbera',
        ClienteId: 1,
        ClienteNombre: 'Soriana Centro',
        ClienteDireccion: 'Av. Principal 123',
        ClienteCiudad: 'Monterrey',
        ...overrides
    };
}

/**
 * Crea un reporte mock
 * @param {Object} overrides - Propiedades a sobrescribir
 * @returns {Object} - Reporte mock
 */
function createMockReporte(overrides = {}) {
    return {
        ReporteId: 1,
        NumeroTicket: `TKT${  Date.now()}`,
        TipoReporte: 'REFRIGERADOR',
        Estado: 'PENDIENTE',
        TelefonoReportante: '5215512345678',
        Descripcion: 'El refrigerador no enfria',
        FechaCreacion: new Date(),
        FechaResolucion: null,
        ...overrides
    };
}

module.exports = {
    sessionInicio,
    sessionEsperaSAP,
    sessionConfirmarEquipo,
    sessionEncuesta,
    sessionProximaTimeout,
    createMockSession,
    createMockEquipo,
    createMockReporte
};
