/**
 * Constantes para estados de documentos de firma
 * Sign Bot: Ciclo de vida del documento en DocuSign
 * Sincronizado con tablas CatEstadoDocumento y CatTipoDocumento en BD
 */

// Estados de documento (CatEstadoDocumento)
const ESTADO_DOCUMENTO = {
  PENDIENTE_ENVIO: 'PENDIENTE_ENVIO', // Recibido de SAP, aun no enviado a DocuSign
  ENVIADO: 'ENVIADO', // Envelope creado en DocuSign, enviado al cliente
  ENTREGADO: 'ENTREGADO', // WhatsApp confirmo entrega del mensaje
  VISTO: 'VISTO', // Cliente abrio el documento en DocuSign
  FIRMADO: 'FIRMADO', // Cliente firmo el documento
  RECHAZADO: 'RECHAZADO', // Cliente rechazo firmar
  ANULADO: 'ANULADO', // SAP solicito anulacion o housekeeping
  ERROR: 'ERROR', // Error en el proceso (reintentable)
};

// IDs de estados de documento (deben coincidir con BD)
const ESTADO_DOCUMENTO_ID = {
  PENDIENTE_ENVIO: 1,
  ENVIADO: 2,
  ENTREGADO: 3,
  VISTO: 4,
  FIRMADO: 5,
  RECHAZADO: 6,
  ANULADO: 7,
  ERROR: 8,
};

// Tipos de documento (CatTipoDocumento)
const TIPO_DOCUMENTO = {
  CONTRATO: 'CONTRATO',
  ADENDUM: 'ADENDUM',
  PAGARE: 'PAGARE',
  OTRO: 'OTRO',
};

// IDs de tipos de documento (deben coincidir con BD)
const TIPO_DOCUMENTO_ID = {
  CONTRATO: 1,
  ADENDUM: 2,
  PAGARE: 3,
  OTRO: 4,
};

// Informacion de estados de documento para UI
const ESTADO_DOCUMENTO_INFO = {
  PENDIENTE_ENVIO: {
    emoji: '📤',
    nombre: 'Pendiente de envio',
    mensaje: 'El documento esta en cola para ser enviado al cliente.',
  },
  ENVIADO: {
    emoji: '📨',
    nombre: 'Enviado',
    mensaje: 'El documento fue enviado al cliente por WhatsApp.',
  },
  ENTREGADO: {
    emoji: '✅',
    nombre: 'Entregado',
    mensaje: 'El mensaje fue entregado al dispositivo del cliente.',
  },
  VISTO: {
    emoji: '👁️',
    nombre: 'Visto',
    mensaje: 'El cliente abrio el documento en DocuSign.',
  },
  FIRMADO: {
    emoji: '✍️',
    nombre: 'Firmado',
    mensaje: 'El documento fue firmado exitosamente.',
  },
  RECHAZADO: {
    emoji: '❌',
    nombre: 'Rechazado',
    mensaje: 'El cliente rechazo firmar el documento.',
  },
  ANULADO: {
    emoji: '🚫',
    nombre: 'Anulado',
    mensaje: 'El documento fue anulado.',
  },
  ERROR: {
    emoji: '⚠️',
    nombre: 'Error',
    mensaje: 'Hubo un error procesando el documento.',
  },
};

// Estados finales de documento (no pueden cambiar)
const ESTADOS_DOCUMENTO_FINALES = [ESTADO_DOCUMENTO.FIRMADO, ESTADO_DOCUMENTO.ANULADO];

// Estados activos de documento (pendientes de firma)
const ESTADOS_DOCUMENTO_ACTIVOS = [
  ESTADO_DOCUMENTO.PENDIENTE_ENVIO,
  ESTADO_DOCUMENTO.ENVIADO,
  ESTADO_DOCUMENTO.ENTREGADO,
  ESTADO_DOCUMENTO.VISTO,
  ESTADO_DOCUMENTO.RECHAZADO, // Rechazado permite reenvio con correctEnvelope
  ESTADO_DOCUMENTO.ERROR, // Error es reintentable
];

// Estados que permiten recordatorios
const ESTADOS_RECORDATORIO = [
  ESTADO_DOCUMENTO.ENVIADO,
  ESTADO_DOCUMENTO.ENTREGADO,
  ESTADO_DOCUMENTO.VISTO,
  ESTADO_DOCUMENTO.RECHAZADO,
];

// Helpers
function esEstadoDocumentoFinal(estado) {
  return ESTADOS_DOCUMENTO_FINALES.includes(estado);
}

function esEstadoDocumentoActivo(estado) {
  return ESTADOS_DOCUMENTO_ACTIVOS.includes(estado);
}

function esEstadoRecordatorio(estado) {
  return ESTADOS_RECORDATORIO.includes(estado);
}

function getEstadoDocumentoId(estadoCodigo) {
  return ESTADO_DOCUMENTO_ID[estadoCodigo] || null;
}

function getTipoDocumentoId(tipoCodigo) {
  return TIPO_DOCUMENTO_ID[tipoCodigo] || null;
}

function getEstadoDocumentoInfo(estadoCodigo) {
  return ESTADO_DOCUMENTO_INFO[estadoCodigo] || { emoji: '⚪', nombre: estadoCodigo, mensaje: '' };
}

module.exports = {
  ESTADO_DOCUMENTO,
  ESTADO_DOCUMENTO_ID,
  TIPO_DOCUMENTO,
  TIPO_DOCUMENTO_ID,
  ESTADO_DOCUMENTO_INFO,
  ESTADOS_DOCUMENTO_FINALES,
  ESTADOS_DOCUMENTO_ACTIVOS,
  ESTADOS_RECORDATORIO,
  esEstadoDocumentoFinal,
  esEstadoDocumentoActivo,
  esEstadoRecordatorio,
  getEstadoDocumentoId,
  getTipoDocumentoId,
  getEstadoDocumentoInfo,
};
