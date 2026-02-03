/**
 * Constantes para estados de sesión y tipos de reporte
 * Sincronizado con tablas CatEstadoSesion, CatTipoReporte y CatEstadoReporte en BD
 */

// Tipos de reporte (CatTipoReporte)
const TIPO_REPORTE = {
    REFRIGERADOR: 'REFRIGERADOR',
    VEHICULO: 'VEHICULO'
};

// IDs de tipos de reporte (deben coincidir con BD)
const TIPO_REPORTE_ID = {
    REFRIGERADOR: 1,
    VEHICULO: 2
};

// Estados de reporte (CatEstadoReporte) - diferente de estados de sesión
const ESTADO_REPORTE = {
    PENDIENTE: 'PENDIENTE',
    EN_PROCESO: 'EN_PROCESO',
    RESUELTO: 'RESUELTO',
    CANCELADO: 'CANCELADO'
};

// IDs de estados de reporte (deben coincidir con BD)
const ESTADO_REPORTE_ID = {
    PENDIENTE: 1,
    EN_PROCESO: 2,
    RESUELTO: 3,
    CANCELADO: 4
};

// Información de estados de reporte para UI
const ESTADO_REPORTE_INFO = {
    PENDIENTE: { emoji: '🟡', nombre: 'Pendiente', mensaje: '⏳ Tu reporte está en cola y será asignado pronto a un técnico.' },
    EN_PROCESO: { emoji: '🔵', nombre: 'En Proceso', mensaje: '👷 Un técnico está trabajando en tu reporte. Te contactará pronto.' },
    RESUELTO: { emoji: '🟢', nombre: 'Resuelto', mensaje: '✅ Este reporte ha sido resuelto. ¡Gracias por usar AC FixBot!' },
    CANCELADO: { emoji: '🔴', nombre: 'Cancelado', mensaje: '❌ Este reporte fue cancelado.' }
};

// Estados finales de reporte (no pueden cambiar)
const ESTADOS_REPORTE_FINALES = [
    ESTADO_REPORTE.RESUELTO,
    ESTADO_REPORTE.CANCELADO
];

// Estados de sesión (CatEstadoSesion)
const ESTADO = {
    // Estados terminales (sesión inactiva)
    INICIO: 'INICIO',
    CANCELADO: 'CANCELADO',
    FINALIZADO: 'FINALIZADO',
    TIMEOUT: 'TIMEOUT',

    // Estados de flujo Refrigerador
    REFRI_ESPERA_SAP: 'REFRI_ESPERA_SAP',
    REFRI_CONFIRMAR_EQUIPO: 'REFRI_CONFIRMAR_EQUIPO',
    REFRI_ESPERA_DESCRIPCION: 'REFRI_ESPERA_DESCRIPCION',

    // Estados de flujo Vehículo
    VEHICULO_ESPERA_EMPLEADO: 'VEHICULO_ESPERA_EMPLEADO',
    VEHICULO_ESPERA_SAP: 'VEHICULO_ESPERA_SAP',
    VEHICULO_ESPERA_DESCRIPCION: 'VEHICULO_ESPERA_DESCRIPCION',
    VEHICULO_ESPERA_UBICACION: 'VEHICULO_ESPERA_UBICACION',
    VEHICULO_CONFIRMAR_DATOS_AI: 'VEHICULO_CONFIRMAR_DATOS_AI',

    // Estados de flujo Encuesta de Satisfacción
    ENCUESTA_INVITACION: 'ENCUESTA_INVITACION',
    ENCUESTA_PREGUNTA_1: 'ENCUESTA_PREGUNTA_1',
    ENCUESTA_PREGUNTA_2: 'ENCUESTA_PREGUNTA_2',
    ENCUESTA_PREGUNTA_3: 'ENCUESTA_PREGUNTA_3',
    ENCUESTA_PREGUNTA_4: 'ENCUESTA_PREGUNTA_4',
    ENCUESTA_PREGUNTA_5: 'ENCUESTA_PREGUNTA_5',
    ENCUESTA_PREGUNTA_6: 'ENCUESTA_PREGUNTA_6',
    ENCUESTA_COMENTARIO: 'ENCUESTA_COMENTARIO',
    ENCUESTA_ESPERA_COMENTARIO: 'ENCUESTA_ESPERA_COMENTARIO',

    // Estados de flujo Consulta de Tickets
    CONSULTA_ESPERA_TICKET: 'CONSULTA_ESPERA_TICKET'
};

// IDs de estados (deben coincidir con BD)
const ESTADO_ID = {
    INICIO: 1,
    CANCELADO: 2,
    FINALIZADO: 3,
    TIMEOUT: 4,
    REFRI_ESPERA_SAP: 5,
    REFRI_CONFIRMAR_EQUIPO: 6,
    REFRI_ESPERA_DESCRIPCION: 7,
    VEHICULO_ESPERA_EMPLEADO: 8,
    VEHICULO_ESPERA_SAP: 9,
    VEHICULO_ESPERA_DESCRIPCION: 10,
    VEHICULO_ESPERA_UBICACION: 11,
    VEHICULO_CONFIRMAR_DATOS_AI: 22,
    // Estados de Encuesta
    ENCUESTA_INVITACION: 12,
    ENCUESTA_PREGUNTA_1: 13,
    ENCUESTA_PREGUNTA_2: 14,
    ENCUESTA_PREGUNTA_3: 15,
    ENCUESTA_PREGUNTA_4: 16,
    ENCUESTA_PREGUNTA_5: 17,
    ENCUESTA_PREGUNTA_6: 18,
    ENCUESTA_COMENTARIO: 19,
    ENCUESTA_ESPERA_COMENTARIO: 20,
    // Estados de Consulta
    CONSULTA_ESPERA_TICKET: 21
};

// Estados terminales (sesión inactiva, esperando nuevo flujo)
const ESTADOS_TERMINALES = [
    ESTADO.INICIO,
    ESTADO.CANCELADO,
    ESTADO.FINALIZADO,
    ESTADO.TIMEOUT
];

// Estados por flujo
const ESTADOS_REFRIGERADOR = [
    ESTADO.REFRI_ESPERA_SAP,
    ESTADO.REFRI_CONFIRMAR_EQUIPO,
    ESTADO.REFRI_ESPERA_DESCRIPCION
];

const ESTADOS_VEHICULO = [
    ESTADO.VEHICULO_ESPERA_EMPLEADO,
    ESTADO.VEHICULO_ESPERA_SAP,
    ESTADO.VEHICULO_ESPERA_DESCRIPCION,
    ESTADO.VEHICULO_ESPERA_UBICACION,
    ESTADO.VEHICULO_CONFIRMAR_DATOS_AI
];

// Estados de encuesta de satisfacción
const ESTADOS_ENCUESTA = [
    ESTADO.ENCUESTA_INVITACION,
    ESTADO.ENCUESTA_PREGUNTA_1,
    ESTADO.ENCUESTA_PREGUNTA_2,
    ESTADO.ENCUESTA_PREGUNTA_3,
    ESTADO.ENCUESTA_PREGUNTA_4,
    ESTADO.ENCUESTA_PREGUNTA_5,
    ESTADO.ENCUESTA_PREGUNTA_6,
    ESTADO.ENCUESTA_COMENTARIO,
    ESTADO.ENCUESTA_ESPERA_COMENTARIO
];

// Estados de consulta de tickets
const ESTADOS_CONSULTA = [
    ESTADO.CONSULTA_ESPERA_TICKET
];

// Mapeo de estado antiguo a nuevo (para migración/compatibilidad)
const MAPEO_ESTADOS_LEGACY = {
    'INICIO': ESTADO.INICIO,
    'ESPERA_SAP': ESTADO.REFRI_ESPERA_SAP,
    'CONFIRMAR_EQUIPO': ESTADO.REFRI_CONFIRMAR_EQUIPO,
    'ESPERA_DESCRIPCION': ESTADO.REFRI_ESPERA_DESCRIPCION, // Ambiguo, necesita tipoReporte
    'ESPERA_NUMERO_EMPLEADO': ESTADO.VEHICULO_ESPERA_EMPLEADO,
    'ESPERA_SAP_VEHICULO': ESTADO.VEHICULO_ESPERA_SAP
};

// Origen de acciones para historial
const ORIGEN_ACCION = {
    USUARIO: 'USUARIO',
    BOT: 'BOT',
    TIMER: 'TIMER',
    SISTEMA: 'SISTEMA'
};

// Tipo de mensaje
const TIPO_MENSAJE = {
    USUARIO: 'U',
    BOT: 'B'
};

// Tipo de contenido de mensaje
const TIPO_CONTENIDO = {
    TEXTO: 'TEXTO',
    IMAGEN: 'IMAGEN',
    BOTON: 'BOTON',
    UBICACION: 'UBICACION'
};

// Configuración de spam (configurable por variables de entorno)
// Límites aumentados para soportar encuestas (6 preguntas + interacciones)
const SPAM_CONFIG = {
    UMBRAL_MENSAJES_POR_HORA: parseInt(process.env.SPAM_UMBRAL_HORA || '100', 10),
    UMBRAL_MENSAJES_POR_MINUTO: parseInt(process.env.SPAM_UMBRAL_MINUTO || '20', 10),
    TIEMPO_BLOQUEO_MINUTOS: parseInt(process.env.SPAM_BLOQUEO_MINUTOS || '60', 10)
};

// Helpers
function esEstadoTerminal(estado) {
    return ESTADOS_TERMINALES.includes(estado);
}

function esEstadoRefrigerador(estado) {
    return ESTADOS_REFRIGERADOR.includes(estado);
}

function esEstadoVehiculo(estado) {
    return ESTADOS_VEHICULO.includes(estado);
}

function esEstadoEncuesta(estado) {
    return ESTADOS_ENCUESTA.includes(estado);
}

function esEstadoConsulta(estado) {
    return ESTADOS_CONSULTA.includes(estado);
}

function getEstadoId(estadoCodigo) {
    return ESTADO_ID[estadoCodigo] || null;
}

function getTipoReporteId(tipoCodigo) {
    return TIPO_REPORTE_ID[tipoCodigo] || null;
}

function getTipoReportePorEstado(estado) {
    if (esEstadoRefrigerador(estado)) {return TIPO_REPORTE.REFRIGERADOR;}
    if (esEstadoVehiculo(estado)) {return TIPO_REPORTE.VEHICULO;}
    return null;
}

// Helpers para estados de reporte
function getEstadoReporteId(estadoCodigo) {
    return ESTADO_REPORTE_ID[estadoCodigo] || null;
}

function getEstadoReporteInfo(estadoCodigo) {
    return ESTADO_REPORTE_INFO[estadoCodigo] || { emoji: '⚪', nombre: estadoCodigo, mensaje: '' };
}

function esEstadoReporteFinal(estado) {
    return ESTADOS_REPORTE_FINALES.includes(estado);
}

module.exports = {
    TIPO_REPORTE,
    TIPO_REPORTE_ID,
    ESTADO_REPORTE,
    ESTADO_REPORTE_ID,
    ESTADO_REPORTE_INFO,
    ESTADOS_REPORTE_FINALES,
    ESTADO,
    ESTADO_ID,
    ESTADOS_TERMINALES,
    ESTADOS_REFRIGERADOR,
    ESTADOS_VEHICULO,
    ESTADOS_ENCUESTA,
    ESTADOS_CONSULTA,
    MAPEO_ESTADOS_LEGACY,
    ORIGEN_ACCION,
    TIPO_MENSAJE,
    TIPO_CONTENIDO,
    SPAM_CONFIG,
    esEstadoTerminal,
    esEstadoRefrigerador,
    esEstadoVehiculo,
    esEstadoEncuesta,
    esEstadoConsulta,
    getEstadoId,
    getTipoReporteId,
    getTipoReportePorEstado,
    getEstadoReporteId,
    getEstadoReporteInfo,
    esEstadoReporteFinal
};
