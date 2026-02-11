/**
 * Definicion de WhatsApp Message Templates
 * Sign Bot: Templates pre-aprobados por Meta para mensajes outbound
 *
 * IMPORTANTE: Estos templates deben ser creados y aprobados en Meta Business Manager
 * antes de poder usarse. Los nombres y parametros deben coincidir exactamente.
 *
 * Referencia: https://developers.facebook.com/docs/whatsapp/message-templates
 */

// Nombres de templates (deben coincidir con Meta Business Manager)
const TEMPLATE_NAMES = {
  FIRMA_ENVIO: 'firma_envio',
  FIRMA_RECORDATORIO: 'firma_recordatorio',
  FIRMA_CONFIRMACION: 'firma_confirmacion',
  FIRMA_ANULACION: 'firma_anulacion',
};

/**
 * Template: firma_envio
 * Se envia cuando un nuevo documento llega de SAP para firma
 *
 * Parametros del body:
 *   {{1}} = Nombre del cliente
 *   {{2}} = Tipo de documento (Contrato, Adendum, etc.)
 *   {{3}} = Nombre/referencia del documento
 *
 * Botones:
 *   [0] URL: Link de firma DocuSign ({{1}} = URL dinamica)
 *   [1] Quick Reply: "Rechazar"
 */
const FIRMA_ENVIO = {
  name: TEMPLATE_NAMES.FIRMA_ENVIO,
  language: 'es_MX',
  category: 'UTILITY',
  components: [
    {
      type: 'body',
      parameters: ['clienteNombre', 'tipoDocumento', 'documentoNombre'],
    },
    {
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: ['signingUrl'],
    },
    {
      type: 'button',
      sub_type: 'quick_reply',
      index: 1,
      payload: 'RECHAZAR_DOCUMENTO',
    },
  ],
  // Texto sugerido para crear en Meta (referencia, no se usa en codigo)
  suggestedBody:
    'Hola {{1}},\n\n' +
    'Tienes un *{{2}}* pendiente de firma:\n' +
    '*{{3}}*\n\n' +
    'Revisa y firma el documento desde el siguiente enlace.',
};

/**
 * Template: firma_recordatorio
 * Se envia como recordatorio periodico de documentos pendientes
 *
 * Parametros del body:
 *   {{1}} = Nombre del cliente
 *   {{2}} = Tipo de documento
 *   {{3}} = Nombre/referencia del documento
 *   {{4}} = Dias pendientes
 *
 * Botones:
 *   [0] URL: Link de firma DocuSign
 *   [1] Quick Reply: "Rechazar"
 */
const FIRMA_RECORDATORIO = {
  name: TEMPLATE_NAMES.FIRMA_RECORDATORIO,
  language: 'es_MX',
  category: 'UTILITY',
  components: [
    {
      type: 'body',
      parameters: ['clienteNombre', 'tipoDocumento', 'documentoNombre', 'diasPendientes'],
    },
    {
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: ['signingUrl'],
    },
    {
      type: 'button',
      sub_type: 'quick_reply',
      index: 1,
      payload: 'RECHAZAR_DOCUMENTO',
    },
  ],
  suggestedBody:
    'Hola {{1}},\n\n' +
    'Te recordamos que tienes un *{{2}}* pendiente de firma:\n' +
    '*{{3}}*\n\n' +
    'Lleva *{{4}} dias* sin firmar.\n' +
    'Revisa y firma el documento desde el siguiente enlace.',
};

/**
 * Template: firma_confirmacion
 * Se envia cuando el documento fue firmado exitosamente
 *
 * Parametros del body:
 *   {{1}} = Nombre del cliente
 *   {{2}} = Tipo de documento
 *   {{3}} = Nombre/referencia del documento
 */
const FIRMA_CONFIRMACION = {
  name: TEMPLATE_NAMES.FIRMA_CONFIRMACION,
  language: 'es_MX',
  category: 'UTILITY',
  components: [
    {
      type: 'body',
      parameters: ['clienteNombre', 'tipoDocumento', 'documentoNombre'],
    },
  ],
  suggestedBody:
    'Hola {{1}},\n\n' +
    'Tu *{{2}}* ha sido firmado exitosamente:\n' +
    '*{{3}}*\n\n' +
    'Gracias por completar el proceso de firma.',
};

/**
 * Template: firma_anulacion
 * Se envia cuando un documento es anulado por SAP
 *
 * Parametros del body:
 *   {{1}} = Nombre del cliente
 *   {{2}} = Tipo de documento
 *   {{3}} = Nombre/referencia del documento
 */
const FIRMA_ANULACION = {
  name: TEMPLATE_NAMES.FIRMA_ANULACION,
  language: 'es_MX',
  category: 'UTILITY',
  components: [
    {
      type: 'body',
      parameters: ['clienteNombre', 'tipoDocumento', 'documentoNombre'],
    },
  ],
  suggestedBody:
    'Hola {{1}},\n\n' +
    'El *{{2}}* que tenias pendiente de firma ha sido anulado:\n' +
    '*{{3}}*\n\n' +
    'Si tienes dudas, contacta a tu ejecutivo.',
};

/**
 * Construye el payload de template para la API de WhatsApp
 * @param {string} templateName - Nombre del template
 * @param {Object} params - Parametros del template
 * @returns {Object} Payload para whatsappService.sendTemplate()
 */
function buildTemplatePayload(templateName, params) {
  const template = TEMPLATES[templateName];
  if (!template) {
    throw new Error(`Template '${templateName}' no encontrado`);
  }

  const components = [];

  for (const component of template.components) {
    if (component.type === 'body') {
      const bodyParams = component.parameters.map((paramName) => ({
        type: 'text',
        text: String(params[paramName] || ''),
      }));
      components.push({ type: 'body', parameters: bodyParams });
    } else if (component.type === 'button') {
      if (component.sub_type === 'url') {
        const urlParams = component.parameters.map((paramName) => ({
          type: 'text',
          text: String(params[paramName] || ''),
        }));
        components.push({
          type: 'button',
          sub_type: 'url',
          index: component.index,
          parameters: urlParams,
        });
      }
      // quick_reply buttons don't need dynamic parameters
    }
  }

  return {
    name: template.name,
    language: { code: template.language },
    components,
  };
}

// Mapa de templates por nombre
const TEMPLATES = {
  [TEMPLATE_NAMES.FIRMA_ENVIO]: FIRMA_ENVIO,
  [TEMPLATE_NAMES.FIRMA_RECORDATORIO]: FIRMA_RECORDATORIO,
  [TEMPLATE_NAMES.FIRMA_CONFIRMACION]: FIRMA_CONFIRMACION,
  [TEMPLATE_NAMES.FIRMA_ANULACION]: FIRMA_ANULACION,
};

module.exports = {
  TEMPLATE_NAMES,
  TEMPLATES,
  FIRMA_ENVIO,
  FIRMA_RECORDATORIO,
  FIRMA_CONFIRMACION,
  FIRMA_ANULACION,
  buildTemplatePayload,
};
