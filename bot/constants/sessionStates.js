/**
 * Constantes para estados de sesion del chatbot
 * Sign Bot: Firma digital de documentos via DocuSign
 * Sincronizado con tabla CatEstadoSesion en BD
 */

// Estados de sesion (CatEstadoSesion)
const ESTADO = {
  // Estados terminales (sesion inactiva)
  INICIO: 'INICIO',
  CANCELADO: 'CANCELADO',
  FINALIZADO: 'FINALIZADO',
  TIMEOUT: 'TIMEOUT',

  // Estados de consulta de documentos
  CONSULTA_DOCUMENTOS: 'CONSULTA_DOCUMENTOS',
  CONSULTA_DETALLE: 'CONSULTA_DETALLE',

  // Estado de confirmacion de firma/rechazo
  ESPERANDO_CONFIRMACION: 'ESPERANDO_CONFIRMACION',

  // Estado de atencion por agente humano (v2)
  AGENTE_ACTIVO: 'AGENTE_ACTIVO',
};

// IDs de estados (deben coincidir con BD)
const ESTADO_ID = {
  INICIO: 1,
  CANCELADO: 2,
  FINALIZADO: 3,
  TIMEOUT: 4,
  CONSULTA_DOCUMENTOS: 10,
  CONSULTA_DETALLE: 11,
  ESPERANDO_CONFIRMACION: 12,
  AGENTE_ACTIVO: 20,
};

// Estados terminales (sesion inactiva, esperando nuevo flujo)
const ESTADOS_TERMINALES = [ESTADO.INICIO, ESTADO.CANCELADO, ESTADO.FINALIZADO, ESTADO.TIMEOUT];

// Estados de consulta de documentos
const ESTADOS_CONSULTA = [ESTADO.CONSULTA_DOCUMENTOS, ESTADO.CONSULTA_DETALLE];

// Estados de confirmacion
const ESTADOS_CONFIRMACION = [ESTADO.ESPERANDO_CONFIRMACION];

// Origen de acciones para historial
const ORIGEN_ACCION = {
  USUARIO: 'USUARIO',
  BOT: 'BOT',
  TIMER: 'TIMER',
  SISTEMA: 'SISTEMA',
  API: 'API',
};

// Tipo de mensaje
const TIPO_MENSAJE = {
  USUARIO: 'U',
  BOT: 'B',
};

// Tipo de contenido de mensaje
const TIPO_CONTENIDO = {
  TEXTO: 'TEXTO',
  BOTON: 'BOTON',
  TEMPLATE: 'TEMPLATE',
};

// Configuracion de spam (configurable por variables de entorno)
const SPAM_CONFIG = {
  UMBRAL_MENSAJES_POR_HORA: parseInt(process.env.SPAM_UMBRAL_HORA || '100', 10),
  UMBRAL_MENSAJES_POR_MINUTO: parseInt(process.env.SPAM_UMBRAL_MINUTO || '20', 10),
  TIEMPO_BLOQUEO_MINUTOS: parseInt(process.env.SPAM_BLOQUEO_MINUTOS || '60', 10),
};

// Helpers
function esEstadoTerminal(estado) {
  return ESTADOS_TERMINALES.includes(estado);
}

function esEstadoConsulta(estado) {
  return ESTADOS_CONSULTA.includes(estado);
}

function esEstadoConfirmacion(estado) {
  return ESTADOS_CONFIRMACION.includes(estado);
}

function esEstadoAgente(estado) {
  return estado === ESTADO.AGENTE_ACTIVO;
}

function getEstadoId(estadoCodigo) {
  return ESTADO_ID[estadoCodigo] || null;
}

module.exports = {
  ESTADO,
  ESTADO_ID,
  ESTADOS_TERMINALES,
  ESTADOS_CONSULTA,
  ESTADOS_CONFIRMACION,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
  SPAM_CONFIG,
  esEstadoTerminal,
  esEstadoConsulta,
  esEstadoConfirmacion,
  esEstadoAgente,
  getEstadoId,
};
