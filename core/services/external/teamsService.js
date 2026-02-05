/**
 * AC FIXBOT - Servicio de Integración con Microsoft Teams
 * Envía notificaciones de conversaciones a canales de Teams via Webhook
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const config = require('../../config');
const { logger } = require('../infrastructure/errorHandler');

/**
 * URL del Incoming Webhook de Teams
 * Configurar en: Teams > Canal > Conectores > Incoming Webhook
 */
const TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL || config.teams?.webhookUrl || null;

/**
 * Colores para diferentes tipos de notificación
 */
const COLORS = {
  INFO: '0078D4', // Azul Teams
  SUCCESS: '00A86B', // Verde
  WARNING: 'FFA500', // Naranja
  ERROR: 'D13438', // Rojo
  CONVERSATION: '6264A7', // Morado Teams
};

/**
 * Envía un mensaje a Teams via Incoming Webhook
 * @param {Object} card - Adaptive Card para Teams
 * @returns {Promise<boolean>} - true si se envió correctamente
 */
async function sendToTeams(card) {
  if (!TEAMS_WEBHOOK_URL) {
    logger.debug('[TeamsService] Webhook URL no configurado, omitiendo notificación');
    return false;
  }

  try {
    const url = new URL(TEAMS_WEBHOOK_URL);
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
            logger.debug('[TeamsService] Notificación enviada a Teams');
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

/**
 * Notifica una nueva conversación iniciada
 * @param {string} telefono - Número del usuario
 * @param {string} tipoReporte - VEHICULO, REFRIGERADOR, etc.
 * @param {string} mensaje - Primer mensaje del usuario
 */
async function notifyNewConversation(telefono, tipoReporte, mensaje = '') {
  const card = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: COLORS.CONVERSATION,
    summary: `Nueva conversación: ${tipoReporte || 'Inicio'}`,
    sections: [
      {
        activityTitle: '💬 Nueva Conversación',
        activitySubtitle: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
        facts: [
          { name: '📱 Usuario', value: maskPhone(telefono) },
          { name: '🔧 Tipo', value: tipoReporte || 'Por definir' },
        ],
        text: mensaje ? `**Mensaje:** ${truncate(mensaje, 200)}` : '',
        markdown: true,
      },
    ],
  };

  return sendToTeams(card);
}

/**
 * Notifica un mensaje de usuario en una conversación activa
 * @param {string} telefono - Número del usuario
 * @param {string} tipo - 'U' usuario, 'B' bot
 * @param {string} mensaje - Contenido del mensaje
 * @param {Object} contexto - Contexto adicional (estado, tipoReporte, etc.)
 */
async function notifyMessage(telefono, tipo, mensaje, contexto = {}) {
  const esUsuario = tipo === 'U';
  const emoji = esUsuario ? '👤' : '🤖';
  const quien = esUsuario ? 'Usuario' : 'Bot';

  const card = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: esUsuario ? COLORS.INFO : COLORS.SUCCESS,
    summary: `${quien}: ${truncate(mensaje, 50)}`,
    sections: [
      {
        activityTitle: `${emoji} ${quien}`,
        activitySubtitle: `${maskPhone(telefono)} • ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`,
        facts: [
          { name: 'Estado', value: contexto.estado || 'N/A' },
          { name: 'Tipo', value: contexto.tipoReporte || 'N/A' },
        ],
        text: truncate(mensaje, 500),
        markdown: true,
      },
    ],
  };

  return sendToTeams(card);
}

/**
 * Notifica un ticket/reporte creado
 * @param {string} telefono - Número del usuario
 * @param {string} tipoReporte - Tipo de reporte
 * @param {string} ticketId - ID del ticket creado
 * @param {Object} datos - Datos del reporte
 */
async function notifyTicketCreated(telefono, tipoReporte, ticketId, datos = {}) {
  const facts = [
    { name: '📱 Usuario', value: maskPhone(telefono) },
    { name: '🎫 Ticket', value: ticketId || 'N/A' },
    { name: '🔧 Tipo', value: tipoReporte || 'N/A' },
  ];

  if (datos.codigoSAP) {
    facts.push({ name: '📦 SAP', value: datos.codigoSAP });
  }
  if (datos.problema) {
    facts.push({ name: '⚠️ Problema', value: truncate(datos.problema, 100) });
  }

  const card = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: COLORS.SUCCESS,
    summary: `✅ Ticket creado: ${ticketId}`,
    sections: [
      {
        activityTitle: '✅ Ticket Creado',
        activitySubtitle: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
        facts,
        markdown: true,
      },
    ],
  };

  return sendToTeams(card);
}

/**
 * Notifica un error o problema
 * @param {string} titulo - Título del error
 * @param {string} descripcion - Descripción del error
 * @param {Object} contexto - Contexto adicional
 */
async function notifyError(titulo, descripcion, contexto = {}) {
  const facts = [];

  if (contexto.telefono) {
    facts.push({ name: '📱 Usuario', value: maskPhone(contexto.telefono) });
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
    summary: `❌ Error: ${titulo}`,
    sections: [
      {
        activityTitle: `❌ ${titulo}`,
        activitySubtitle: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
        facts: facts.length > 0 ? facts : undefined,
        text: descripcion,
        markdown: true,
      },
    ],
  };

  return sendToTeams(card);
}

/**
 * Notifica análisis de AI Vision completado
 * @param {string} telefono - Número del usuario
 * @param {Object} analisis - Resultado del análisis AI
 */
async function notifyAIVisionAnalysis(telefono, analisis = {}) {
  const facts = [{ name: '📱 Usuario', value: maskPhone(telefono) }];

  if (analisis.tipo_equipo) {
    facts.push({ name: '🔧 Equipo', value: analisis.tipo_equipo });
  }
  if (analisis.codigo_sap) {
    facts.push({ name: '📦 SAP', value: analisis.codigo_sap });
  }
  if (analisis.numero_empleado) {
    facts.push({ name: '👤 Empleado', value: analisis.numero_empleado });
  }
  if (analisis.problema) {
    facts.push({ name: '⚠️ Problema', value: truncate(analisis.problema, 100) });
  }

  const card = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: COLORS.INFO,
    summary: `🤖 AI Vision: ${analisis.tipo_equipo || 'Análisis'}`,
    sections: [
      {
        activityTitle: '🤖 Análisis AI Vision',
        activitySubtitle: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
        facts,
        text: analisis.informacion_visual
          ? `**Lo detectado:** ${truncate(analisis.informacion_visual, 200)}`
          : '',
        markdown: true,
      },
    ],
  };

  return sendToTeams(card);
}

/**
 * Notifica resumen diario de actividad
 * @param {Object} metricas - Métricas del día
 */
async function notifyDailySummary(metricas = {}) {
  const card = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor: COLORS.INFO,
    summary: '📊 Resumen Diario AC FIXBOT',
    sections: [
      {
        activityTitle: '📊 Resumen Diario',
        activitySubtitle: new Date().toLocaleDateString('es-MX', {
          timeZone: 'America/Mexico_City',
        }),
        facts: [
          { name: '💬 Conversaciones', value: String(metricas.totalConversaciones || 0) },
          { name: '✅ Tickets Creados', value: String(metricas.ticketsCreados || 0) },
          { name: '🚗 Vehículos', value: String(metricas.vehiculos || 0) },
          { name: '❄️ Refrigeradores', value: String(metricas.refrigeradores || 0) },
          { name: '❌ Errores', value: String(metricas.errores || 0) },
        ],
        markdown: true,
      },
    ],
  };

  return sendToTeams(card);
}

/**
 * Enmascara un número de teléfono para privacidad
 * @param {string} telefono - Número completo
 * @returns {string} - Número enmascarado (ej: 52***1234)
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
 * Trunca texto a un máximo de caracteres
 * @param {string} text - Texto original
 * @param {number} maxLength - Longitud máxima
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
 * Verifica si el servicio está configurado
 * @returns {boolean}
 */
function isConfigured() {
  return Boolean(TEAMS_WEBHOOK_URL);
}

module.exports = {
  sendToTeams,
  notifyNewConversation,
  notifyMessage,
  notifyTicketCreated,
  notifyError,
  notifyAIVisionAnalysis,
  notifyDailySummary,
  isConfigured,
  COLORS,
};
