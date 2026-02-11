/**
 * SIGN BOT - Templates de Mensajes
 * Mensajes de respuesta del bot para interacciones conversacionales
 */

// ============================================
// MENSAJES GENERALES
// ============================================

const GENERAL = {
  BOT_NAME: 'Sign Bot',
  COMPANY: 'Arca Continental',

  GREETING: 'Hola, soy *Sign Bot*',

  WELCOME:
    'Hola, soy *Sign Bot* de Arca Continental.\n\n' +
    'Te ayudo con la firma digital de tus documentos.\n\n' +
    'Escribe *"mis documentos"* para consultar tus documentos pendientes.',

  GOODBYE: 'Hasta pronto. Escribeme cuando necesites ayuda con tus documentos.',

  THANKS_FOOTER: 'Gracias',
};

// ============================================
// MENSAJES DE RATE LIMITING / SPAM
// ============================================

const RATE_LIMIT = {
  SPAM_WARNING: 'Espera un momento antes de enviar mas mensajes.',
};

// ============================================
// MENSAJES DE FIRMA DE DOCUMENTOS
// ============================================

const FIRMA = {
  // Notificacion de nuevo documento (se usa como fallback si template falla)
  NUEVO_DOCUMENTO: (clienteNombre, tipoDocumento, documentoNombre) =>
    `Hola ${clienteNombre},\n\n` +
    `Tienes un *${tipoDocumento}* pendiente de firma:\n` +
    `*${documentoNombre}*\n\n` +
    'Revisa y firma el documento desde el enlace que te enviamos.',

  // Recordatorio de documento pendiente
  RECORDATORIO: (clienteNombre, tipoDocumento, documentoNombre, diasPendientes) =>
    `Hola ${clienteNombre},\n\n` +
    `Te recordamos que tienes un *${tipoDocumento}* pendiente de firma:\n` +
    `*${documentoNombre}*\n\n` +
    `Lleva *${diasPendientes} dias* sin firmar.`,

  // Confirmacion de firma exitosa
  FIRMA_EXITOSA: (clienteNombre, tipoDocumento, documentoNombre) =>
    `Hola ${clienteNombre},\n\n` +
    `Tu *${tipoDocumento}* ha sido firmado exitosamente:\n` +
    `*${documentoNombre}*\n\n` +
    'Gracias por completar el proceso de firma.',

  // Documento anulado
  DOCUMENTO_ANULADO: (clienteNombre, tipoDocumento, documentoNombre) =>
    `Hola ${clienteNombre},\n\n` +
    `El *${tipoDocumento}* que tenias pendiente de firma ha sido anulado:\n` +
    `*${documentoNombre}*\n\n` +
    'Si tienes dudas, contacta a tu ejecutivo.',

  // Solicitud de motivo de rechazo
  SOLICITAR_MOTIVO_RECHAZO: 'Entendido. Por favor, indicanos brevemente el *motivo del rechazo*:',

  // Confirmacion de rechazo registrado
  RECHAZO_REGISTRADO: (documentoNombre) =>
    `Se registro tu rechazo para *${documentoNombre}*.\n\n` +
    'Tu ejecutivo sera notificado. Si cambias de opinion, te enviaremos el documento nuevamente.',

  // Documento corregido (reenvio con correctEnvelope)
  DOCUMENTO_CORREGIDO: (clienteNombre, tipoDocumento, documentoNombre) =>
    `Hola ${clienteNombre},\n\n` +
    `Se ha actualizado tu *${tipoDocumento}*:\n` +
    `*${documentoNombre}*\n\n` +
    'Revisa la nueva version y firma desde el enlace.',

  // Confirmacion de recepcion de documento desde API
  DOCUMENTO_RECIBIDO_API: 'Documento recibido correctamente. Se enviara al cliente por WhatsApp.',

  // Error al procesar documento
  ERROR_PROCESANDO: 'Hubo un error procesando el documento. Se reintentara automaticamente.',
};

// ============================================
// MENSAJES DE CONSULTA DE DOCUMENTOS
// ============================================

const CONSULTA_DOCS = {
  TITLE: 'Mis Documentos',

  SIN_DOCUMENTOS:
    'No tienes documentos pendientes de firma en este momento.\n\n' +
    'Te notificaremos cuando recibas un nuevo documento.',

  /**
   * Genera mensaje con lista de documentos del usuario
   */
  listaDocumentos: (documentos) => {
    const { getEstadoDocumentoInfo } = require('./documentStates');

    let msg = '*Tus documentos:*\n\n';

    documentos.forEach((doc, index) => {
      const estadoInfo = getEstadoDocumentoInfo(doc.EstadoDocumento);
      const fecha = new Date(doc.FechaCreacion).toLocaleDateString('es-MX', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

      msg += `${index + 1}. *${doc.DocumentoNombre || doc.SapDocumentId}*\n`;
      msg += `   ${estadoInfo.emoji} ${estadoInfo.nombre}\n`;
      msg += `   Tipo: ${doc.TipoDocumento}\n`;
      msg += `   Fecha: ${fecha}\n\n`;
    });

    msg += 'Escribe el *numero* del documento para ver mas detalles.';

    return msg;
  },

  /**
   * Genera mensaje con detalle de un documento
   */
  detalleDocumento: (doc) => {
    const { getEstadoDocumentoInfo } = require('./documentStates');
    const estadoInfo = getEstadoDocumentoInfo(doc.EstadoDocumento);

    const fecha = new Date(doc.FechaCreacion).toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    let msg = `*Detalle del Documento*\n\n`;
    msg += `*Documento:* ${doc.DocumentoNombre || doc.SapDocumentId}\n`;
    msg += `*Tipo:* ${doc.TipoDocumento}\n`;
    msg += `*Estado:* ${estadoInfo.emoji} ${estadoInfo.nombre}\n`;
    msg += `*Fecha:* ${fecha}\n`;

    if (doc.MotivoRechazo) {
      msg += `*Motivo rechazo:* ${doc.MotivoRechazo}\n`;
    }

    msg += `\n${estadoInfo.mensaje}`;

    if (doc.SigningUrl && !['FIRMADO', 'ANULADO'].includes(doc.EstadoDocumento)) {
      msg += '\n\nPuedes firmar desde el enlace que te enviamos anteriormente.';
    }

    return msg;
  },

  DOCUMENTO_NO_ENCONTRADO: 'No encontre ese documento. Verifica el numero e intenta de nuevo.',

  // Cuando el usuario tiene multiples documentos pendientes y responde sin especificar
  MULTIPLES_PENDIENTES:
    'Tienes varios documentos pendientes.\n\n' +
    'Escribe *"mis documentos"* para ver la lista completa.',
};

// ============================================
// MENSAJES DE MENU Y AYUDA
// ============================================

const MENU = {
  TITLE: 'Sign Bot',

  OPCIONES:
    'Puedo ayudarte con:\n\n' +
    '1. *Mis documentos* - Ver documentos pendientes\n' +
    '2. *Ayuda* - Informacion de ayuda\n\n' +
    'Tambien recibiras notificaciones cuando tengas documentos nuevos por firmar.',
};

const AYUDA = {
  MENSAJE:
    '*Sign Bot - Ayuda*\n\n' +
    'Soy un asistente para la firma digital de documentos.\n\n' +
    '*Como funciona:*\n' +
    '1. Recibiras una notificacion cuando tengas un documento pendiente\n' +
    '2. Abre el enlace para revisar el documento\n' +
    '3. Firma o rechaza el documento\n\n' +
    '*Comandos:*\n' +
    '- Escribe *"mis documentos"* para ver tus documentos\n' +
    '- Escribe *"ayuda"* para ver este mensaje\n\n' +
    'Si tienes dudas adicionales, contacta a tu ejecutivo.',
};

// ============================================
// MENSAJES DE ERROR
// ============================================

const ERRORES = {
  GENERICO: 'Ocurrio un error. Intenta de nuevo en unos momentos.',

  SESION_EXPIRADA:
    'Tu sesion expiro por inactividad.\n\n' + 'Escribe cualquier mensaje para comenzar de nuevo.',

  NO_ENTIENDO:
    'No entendi tu mensaje.\n\n' +
    'Escribe *"mis documentos"* para ver tus documentos pendientes\n' +
    'o *"ayuda"* para mas informacion.',

  CONFIRMAR_O_CORREGIR: 'Usa los botones para responder o escribe "si" o "no".',
};

// ============================================
// BOTONES
// ============================================

const BUTTONS = {
  VER_DOCUMENTOS: { id: 'btn_ver_documentos', title: 'Mis Documentos' },
  FIRMAR: { id: 'btn_firmar', title: 'Firmar' },
  RECHAZAR: { id: 'btn_rechazar', title: 'Rechazar' },
  CONFIRMAR_RECHAZO: { id: 'btn_confirmar_rechazo', title: 'Si, rechazar' },
  CANCELAR_RECHAZO: { id: 'btn_cancelar_rechazo', title: 'No, cancelar' },
  AYUDA: { id: 'btn_ayuda', title: 'Ayuda' },
  VOLVER: { id: 'btn_volver', title: 'Volver' },
};

module.exports = {
  GENERAL,
  RATE_LIMIT,
  FIRMA,
  CONSULTA_DOCS,
  MENU,
  AYUDA,
  ERRORES,
  BUTTONS,
};
