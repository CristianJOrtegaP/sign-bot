/**
 * Constantes para estados de sesión y tipos de reporte
 * FASE 2b: Arquitectura flexible con estados simplificados
 * Sincronizado con tablas CatEstadoSesion, CatTipoReporte y CatEstadoReporte en BD
 */

// Tipos de reporte (CatTipoReporte)
const TIPO_REPORTE = {
  REFRIGERADOR: 'REFRIGERADOR',
  VEHICULO: 'VEHICULO',
};

// IDs de tipos de reporte (deben coincidir con BD)
const TIPO_REPORTE_ID = {
  REFRIGERADOR: 1,
  VEHICULO: 2,
};

// Estados de reporte (CatEstadoReporte) - diferente de estados de sesión
const ESTADO_REPORTE = {
  PENDIENTE: 'PENDIENTE',
  EN_PROCESO: 'EN_PROCESO',
  RESUELTO: 'RESUELTO',
  CANCELADO: 'CANCELADO',
};

// IDs de estados de reporte (deben coincidir con BD)
const ESTADO_REPORTE_ID = {
  PENDIENTE: 1,
  EN_PROCESO: 2,
  RESUELTO: 3,
  CANCELADO: 4,
};

// Información de estados de reporte para UI
const ESTADO_REPORTE_INFO = {
  PENDIENTE: {
    emoji: '🟡',
    nombre: 'Pendiente',
    mensaje: '⏳ Tu reporte está en cola y será asignado pronto a un técnico.',
  },
  EN_PROCESO: {
    emoji: '🔵',
    nombre: 'En Proceso',
    mensaje: '👷 Un técnico está trabajando en tu reporte. Te contactará pronto.',
  },
  RESUELTO: {
    emoji: '🟢',
    nombre: 'Resuelto',
    mensaje: '✅ Este reporte ha sido resuelto. ¡Gracias por usar AC FixBot!',
  },
  CANCELADO: { emoji: '🔴', nombre: 'Cancelado', mensaje: '❌ Este reporte fue cancelado.' },
};

// Estados finales de reporte (no pueden cambiar)
const ESTADOS_REPORTE_FINALES = [ESTADO_REPORTE.RESUELTO, ESTADO_REPORTE.CANCELADO];

// Estados de sesión (CatEstadoSesion) - FASE 2b simplificado
const ESTADO = {
  // Estados terminales (sesión inactiva)
  INICIO: 'INICIO',
  CANCELADO: 'CANCELADO',
  FINALIZADO: 'FINALIZADO',
  TIMEOUT: 'TIMEOUT',

  // Estados flexibles FASE 2b (permiten llenado en cualquier orden)
  REFRIGERADOR_ACTIVO: 'REFRIGERADOR_ACTIVO',
  VEHICULO_ACTIVO: 'VEHICULO_ACTIVO',

  // Estado de confirmación de equipo detectado por OCR
  REFRIGERADOR_CONFIRMAR_EQUIPO: 'REFRIGERADOR_CONFIRMAR_EQUIPO',

  // Estados de confirmación de datos detectados por AI Vision
  VEHICULO_CONFIRMAR_DATOS_AI: 'VEHICULO_CONFIRMAR_DATOS_AI',
  REFRIGERADOR_CONFIRMAR_DATOS_AI: 'REFRIGERADOR_CONFIRMAR_DATOS_AI',

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
  CONSULTA_ESPERA_TICKET: 'CONSULTA_ESPERA_TICKET',

  // Estado de atención por agente humano (handoff)
  AGENTE_ACTIVO: 'AGENTE_ACTIVO',
};

// IDs de estados (deben coincidir con BD)
const ESTADO_ID = {
  // Estados terminales
  INICIO: 1,
  CANCELADO: 2,
  FINALIZADO: 3,
  TIMEOUT: 4,
  // Estados flexibles FASE 2b
  REFRIGERADOR_ACTIVO: 23,
  VEHICULO_ACTIVO: 24,
  REFRIGERADOR_CONFIRMAR_EQUIPO: 25,
  // Estados de confirmación AI Vision
  VEHICULO_CONFIRMAR_DATOS_AI: 26,
  REFRIGERADOR_CONFIRMAR_DATOS_AI: 27,
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
  CONSULTA_ESPERA_TICKET: 21,
  // Estado de atención por agente
  AGENTE_ACTIVO: 28,
};

// Estados terminales (sesión inactiva, esperando nuevo flujo)
const ESTADOS_TERMINALES = [ESTADO.INICIO, ESTADO.CANCELADO, ESTADO.FINALIZADO, ESTADO.TIMEOUT];

// Estados flexibles FASE 2b (permiten llenado de campos en cualquier orden)
const ESTADOS_FLEXIBLES = [
  ESTADO.REFRIGERADOR_ACTIVO,
  ESTADO.VEHICULO_ACTIVO,
  ESTADO.REFRIGERADOR_CONFIRMAR_EQUIPO,
  ESTADO.VEHICULO_CONFIRMAR_DATOS_AI,
  ESTADO.REFRIGERADOR_CONFIRMAR_DATOS_AI,
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
  ESTADO.ENCUESTA_ESPERA_COMENTARIO,
];

// Estados de consulta de tickets
const ESTADOS_CONSULTA = [ESTADO.CONSULTA_ESPERA_TICKET];

// Origen de acciones para historial
const ORIGEN_ACCION = {
  USUARIO: 'USUARIO',
  BOT: 'BOT',
  TIMER: 'TIMER',
  SISTEMA: 'SISTEMA',
};

// Tipo de mensaje
const TIPO_MENSAJE = {
  USUARIO: 'U',
  BOT: 'B',
};

// Tipo de contenido de mensaje
const TIPO_CONTENIDO = {
  TEXTO: 'TEXTO',
  IMAGEN: 'IMAGEN',
  BOTON: 'BOTON',
  UBICACION: 'UBICACION',
  AUDIO: 'AUDIO',
};

// Configuración de spam (configurable por variables de entorno)
const SPAM_CONFIG = {
  UMBRAL_MENSAJES_POR_HORA: parseInt(process.env.SPAM_UMBRAL_HORA || '100', 10),
  UMBRAL_MENSAJES_POR_MINUTO: parseInt(process.env.SPAM_UMBRAL_MINUTO || '20', 10),
  TIEMPO_BLOQUEO_MINUTOS: parseInt(process.env.SPAM_BLOQUEO_MINUTOS || '60', 10),
};

// Helpers
function esEstadoTerminal(estado) {
  return ESTADOS_TERMINALES.includes(estado);
}

function esEstadoFlexible(estado) {
  return ESTADOS_FLEXIBLES.includes(estado);
}

function esEstadoEncuesta(estado) {
  return ESTADOS_ENCUESTA.includes(estado);
}

function esEstadoConsulta(estado) {
  return ESTADOS_CONSULTA.includes(estado);
}

function esEstadoAgente(estado) {
  return estado === ESTADO.AGENTE_ACTIVO;
}

function getEstadoId(estadoCodigo) {
  return ESTADO_ID[estadoCodigo] || null;
}

function getTipoReporteId(tipoCodigo) {
  return TIPO_REPORTE_ID[tipoCodigo] || null;
}

function getTipoReportePorEstado(estado) {
  if (estado === ESTADO.REFRIGERADOR_ACTIVO) {
    return TIPO_REPORTE.REFRIGERADOR;
  }
  if (estado === ESTADO.VEHICULO_ACTIVO) {
    return TIPO_REPORTE.VEHICULO;
  }
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
  ESTADOS_FLEXIBLES,
  ESTADOS_ENCUESTA,
  ESTADOS_CONSULTA,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
  SPAM_CONFIG,
  esEstadoTerminal,
  esEstadoFlexible,
  esEstadoEncuesta,
  esEstadoConsulta,
  esEstadoAgente,
  getEstadoId,
  getTipoReporteId,
  getTipoReportePorEstado,
  getEstadoReporteId,
  getEstadoReporteInfo,
  esEstadoReporteFinal,
};
