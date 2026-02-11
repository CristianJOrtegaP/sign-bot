/**
 * SIGN BOT - Servicio de Integracion con Microsoft Teams
 * Envia notificaciones de documentos y firma a canales de Teams via Webhook
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const config = require('../../config');
const { logger } = require('../infrastructure/errorHandler');

/**
 * URL del Incoming Webhook de Teams
 * Se obtiene de config.teams.webhookUrl (que lee TEAMS_WEBHOOK_URL del entorno)
 */
function getWebhookUrl() {
  return config.teams?.webhookUrl || null;
}

/**
 * Colores para diferentes tipos de notificacion
 */
const COLORS = {
  INFO: '0078D4', // Azul Teams
  SUCCESS: '00A86B', // Verde
  WARNING: 'FFA500', // Naranja
  ERROR: 'D13438', // Rojo
  SIGNING: '6264A7', // Morado Teams
};

/**
 * Envia un mensaje a Teams via Incoming Webhook
 * @param {Object} card - MessageCard para Teams
 * @returns {Promise<boolean>} - true si se envio correctamente
 */
async function sendToTeams(card) {
  const webhookUrl = getWebhookUrl();

  if (!webhookUrl) {
    logger.debug('[TeamsService] Webhook URL no configurado, omitiendo notificacion');
    return false;
  }

  try {
    const url = new URL(webhookUrl);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const postData = JSON.stringify(card);

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    return new Promise((resolve) => {
      const req = httpModule.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            logger.debug('[TeamsService] Notificacion enviada a Teams');
            resolve(true);
          } else {
            logger.warn(`[TeamsService] Error HTTP ${res.statusCode}: ${data}`);
            resolve(false);
          }
        });
      });

      req.on('error', (err) => {
        logger.error(`[TeamsService] Error enviando a Teams: ${err.message}`);
        resolve(false);
      });

      req.setTimeout(5000, () => {
        req.destroy();
        logger.warn('[TeamsService] Timeout enviando a Teams');
        resolve(false);
      });

      req.write(postData);
      req.end();
    });
  } catch (error) {
    logger.error(`[TeamsService] Error: ${error.message}`);
    return false;
  }
}

// ============================================================================
// NOTIFICACIONES GENERICAS
// ============================================================================

/**
 * Notifica un error o problema
 * @param {string} titulo - Titulo del error
 * @param {string} descripcion - Descripcion del error
 * @param {Object} contexto - Contexto adicional
 */
async function notifyError(titulo, descripcion, contexto = {}) {
  const facts = [];

  if (contexto.telefono) {
    facts.push({ name: 'Usuario', value: maskPhone(contexto.telefono) });
  }
  if (contexto.estado) {
    facts.push({ name: 'Estado', value: contexto.estado });
  }
  if (contexto.error) {
    facts.push({ name: 'Error', value: truncate(contexto.error, 200) });
  }

  const card = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: COLORS.ERROR,
    summary: `Error: ${titulo}`,
    sections: [
      {
        activityTitle: titulo,
        activitySubtitle: formatTimestamp(),
        facts: facts.length > 0 ? facts : undefined,
        text: descripcion,
        markdown: true,
      },
    ],
  };

  return sendToTeams(card);
}

// ============================================================================
// NOTIFICACIONES DE SIGN BOT (FIRMA DIGITAL)
// ============================================================================

/**
 * Notifica que un cliente rechazo un documento
 * @param {Object} documento - Datos del documento { nombreDocumento, clienteTelefono, clienteNombre, envelopeId }
 * @param {string} motivoRechazo - Motivo del rechazo proporcionado por el cliente
 * @returns {Promise<boolean>}
 */
async function notifyDocumentRejected(documento, motivoRechazo) {
  const facts = [
    { name: 'Documento', value: documento.nombreDocumento || 'N/A' },
    { name: 'Cliente', value: documento.clienteNombre || maskPhone(documento.clienteTelefono) },
    { name: 'Telefono', value: maskPhone(documento.clienteTelefono) },
    { name: 'Motivo', value: truncate(motivoRechazo, 200) || 'No especificado' },
  ];

  if (documento.envelopeId) {
    facts.push({ name: 'Envelope', value: documento.envelopeId });
  }

  const card = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: COLORS.ERROR,
    summary: `Documento rechazado: ${documento.nombreDocumento || 'N/A'}`,
    sections: [
      {
        activityTitle: 'Documento Rechazado',
        activitySubtitle: formatTimestamp(),
        facts,
        markdown: true,
      },
    ],
  };

  return sendToTeams(card);
}

/**
 * Notifica que un cliente firmo un documento exitosamente
 * @param {Object} documento - Datos del documento { nombreDocumento, clienteTelefono, clienteNombre, envelopeId }
 * @returns {Promise<boolean>}
 */
async function notifyDocumentSigned(documento) {
  const facts = [
    { name: 'Documento', value: documento.nombreDocumento || 'N/A' },
    { name: 'Cliente', value: documento.clienteNombre || maskPhone(documento.clienteTelefono) },
    { name: 'Telefono', value: maskPhone(documento.clienteTelefono) },
  ];

  if (documento.envelopeId) {
    facts.push({ name: 'Envelope', value: documento.envelopeId });
  }

  const card = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: COLORS.SUCCESS,
    summary: `Documento firmado: ${documento.nombreDocumento || 'N/A'}`,
    sections: [
      {
        activityTitle: 'Documento Firmado',
        activitySubtitle: formatTimestamp(),
        facts,
        markdown: true,
      },
    ],
  };

  return sendToTeams(card);
}

/**
 * Notifica que un documento lleva varios dias pendiente de firma
 * @param {Object} documento - Datos del documento { nombreDocumento, clienteTelefono, clienteNombre, envelopeId }
 * @param {number} diasPendientes - Numero de dias que lleva pendiente
 * @returns {Promise<boolean>}
 */
async function notifyPendingReminder(documento, diasPendientes) {
  const facts = [
    { name: 'Documento', value: documento.nombreDocumento || 'N/A' },
    { name: 'Cliente', value: documento.clienteNombre || maskPhone(documento.clienteTelefono) },
    { name: 'Telefono', value: maskPhone(documento.clienteTelefono) },
    { name: 'Dias pendiente', value: String(diasPendientes) },
  ];

  if (documento.envelopeId) {
    facts.push({ name: 'Envelope', value: documento.envelopeId });
  }

  const card = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: COLORS.WARNING,
    summary: `Documento pendiente (${diasPendientes} dias): ${documento.nombreDocumento || 'N/A'}`,
    sections: [
      {
        activityTitle: `Documento Pendiente de Firma (${diasPendientes} dias)`,
        activitySubtitle: formatTimestamp(),
        facts,
        markdown: true,
      },
    ],
  };

  return sendToTeams(card);
}

/**
 * Notifica un error al procesar un documento
 * @param {Object} documento - Datos del documento { nombreDocumento, clienteTelefono, clienteNombre, envelopeId }
 * @param {string|Error} error - Error ocurrido
 * @returns {Promise<boolean>}
 */
async function notifyDocumentError(documento, error) {
  const errorMessage = typeof error === 'string' ? error : error?.message || 'Error desconocido';

  const facts = [
    { name: 'Documento', value: documento.nombreDocumento || 'N/A' },
    { name: 'Cliente', value: documento.clienteNombre || maskPhone(documento.clienteTelefono) },
    { name: 'Telefono', value: maskPhone(documento.clienteTelefono) },
    { name: 'Error', value: truncate(errorMessage, 200) },
  ];

  if (documento.envelopeId) {
    facts.push({ name: 'Envelope', value: documento.envelopeId });
  }

  const card = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: COLORS.ERROR,
    summary: `Error en documento: ${documento.nombreDocumento || 'N/A'}`,
    sections: [
      {
        activityTitle: 'Error Procesando Documento',
        activitySubtitle: formatTimestamp(),
        facts,
        markdown: true,
      },
    ],
  };

  return sendToTeams(card);
}

/**
 * Notifica resumen diario de actividad de Sign Bot
 * @param {Object} metricas - Metricas del dia
 */
async function notifyDailySummary(metricas = {}) {
  const card = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: COLORS.INFO,
    summary: 'Resumen Diario Sign Bot',
    sections: [
      {
        activityTitle: 'Resumen Diario',
        activitySubtitle: new Date().toLocaleDateString('es-MX', {
          timeZone: 'America/Mexico_City',
        }),
        facts: [
          { name: 'Documentos enviados', value: String(metricas.documentosEnviados || 0) },
          { name: 'Documentos firmados', value: String(metricas.documentosFirmados || 0) },
          { name: 'Documentos rechazados', value: String(metricas.documentosRechazados || 0) },
          { name: 'Documentos pendientes', value: String(metricas.documentosPendientes || 0) },
          { name: 'Errores', value: String(metricas.errores || 0) },
        ],
        markdown: true,
      },
    ],
  };

  return sendToTeams(card);
}

// ============================================================================
// FUNCIONES UTILITARIAS
// ============================================================================

/**
 * Formatea timestamp para Mexico City
 * @returns {string}
 */
function formatTimestamp() {
  return new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
}

/**
 * Enmascara un numero de telefono para privacidad
 * @param {string} telefono - Numero completo
 * @returns {string} - Numero enmascarado (ej: 52***1234)
 */
function maskPhone(telefono) {
  if (!telefono || telefono.length < 8) {
    return telefono || 'N/A';
  }
  const prefix = telefono.slice(0, 2);
  const suffix = telefono.slice(-4);
  return `${prefix}***${suffix}`;
}

/**
 * Trunca texto a un maximo de caracteres
 * @param {string} text - Texto original
 * @param {number} maxLength - Longitud maxima
 * @returns {string} - Texto truncado
 */
function truncate(text, maxLength = 200) {
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.substring(0, maxLength - 3)}...`;
}

/**
 * Verifica si el servicio esta configurado
 * @returns {boolean}
 */
function isConfigured() {
  return Boolean(getWebhookUrl());
}

module.exports = {
  sendToTeams,
  notifyError,
  notifyDocumentRejected,
  notifyDocumentSigned,
  notifyPendingReminder,
  notifyDocumentError,
  notifyDailySummary,
  isConfigured,
  COLORS,
};
