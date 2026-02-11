/**
 * SIGN BOT - Servicio de WhatsApp
 * Funciones para enviar mensajes a través de la API de Meta
 * Con Circuit Breaker para protección contra fallos en cascada
 */

const axios = require('axios');
const https = require('https');
const config = require('../../config');
const { logger, ExternalServiceError } = require('../infrastructure/errorHandler');
const { getBreaker, SERVICES } = require('../infrastructure/circuitBreaker');

// Configuración de timeouts y reintentos
const HTTP_TIMEOUT = config.whatsapp.timeout.defaultMs;
const MAX_RETRIES = config.whatsapp.retry.maxRetries;

// Circuit breaker para WhatsApp
const whatsappBreaker = getBreaker(SERVICES.WHATSAPP);

// Agente HTTPS reutilizable con keep-alive para connection pooling
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

// Instancia singleton de axios (inicializada lazy)
let axiosInstance = null;

/**
 * Obtiene la configuración de WhatsApp de forma lazy (al momento de uso)
 * Esto evita problemas cuando las variables de entorno no están disponibles
 * en el momento de carga del módulo (ej: Azure Functions Timer Trigger)
 */
function getWhatsAppConfig() {
  return {
    apiUrl: config.whatsapp.apiUrl,
    phoneNumberId: config.whatsapp.phoneNumberId,
    accessToken: config.whatsapp.accessToken,
  };
}

/**
 * Obtiene la instancia singleton de axios, creándola lazy
 * Reutiliza conexiones TCP vía httpsAgent con keep-alive
 */
function getAxiosInstance() {
  if (!axiosInstance) {
    const { accessToken } = getWhatsAppConfig();
    axiosInstance = axios.create({
      timeout: HTTP_TIMEOUT,
      httpsAgent,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }
  return axiosInstance;
}

/**
 * Calcula el delay con exponential backoff y jitter
 * @param {number} attempt - Numero de intento (0-based)
 * @param {number} baseDelay - Delay base en ms
 * @param {number} maxDelay - Delay maximo en ms
 * @returns {number} - Delay en ms
 */
function calculateBackoff(attempt, baseDelay = 1000, maxDelay = 30000) {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  // Aplicar cap maximo
  const cappedDelay = Math.min(exponentialDelay, maxDelay);
  // Agregar jitter aleatorio (0-25% del delay) para evitar thundering herd
  const jitter = Math.random() * 0.25 * cappedDelay;
  return Math.floor(cappedDelay + jitter);
}

/**
 * Determina si un error es retryable
 * @param {Error} error - Error a evaluar
 * @returns {boolean} - true si se debe reintentar
 */
function isRetryableError(error) {
  // Errores de timeout/conexion
  if (config.whatsapp.retry.retryOnCodes.includes(error.code)) {
    return true;
  }

  // Errores HTTP 429 (rate limit) y 5xx (server error)
  const status = error.response?.status;
  if (status === 429 || (status >= 500 && status < 600)) {
    return true;
  }

  return false;
}

/**
 * Ejecuta una peticion con reintentos automaticos, exponential backoff y circuit breaker
 * El circuit breaker previene llamadas cuando el servicio esta fallando
 * @param {Function} fn - Funcion async a ejecutar
 * @param {number} retries - Numero de reintentos restantes
 * @param {number} attempt - Numero de intento actual (para backoff)
 */
async function executeWithRetry(fn, retries = MAX_RETRIES, attempt = 0) {
  // Verificar circuit breaker primero
  const check = whatsappBreaker.canExecute();
  if (!check.allowed) {
    throw new ExternalServiceError(check.reason, 'WhatsApp', { isCircuitBreakerOpen: true });
  }

  try {
    const result = await fn();
    whatsappBreaker.recordSuccess();
    return result;
  } catch (error) {
    // Solo reintentar en errores retryables
    if (retries > 0 && isRetryableError(error)) {
      const backoffDelay = calculateBackoff(attempt);
      logger.warn(`WhatsApp error, reintentando con backoff...`, {
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        delayMs: backoffDelay,
        errorCode: error.code,
        httpStatus: error.response?.status,
      });
      await new Promise((resolve) => {
        setTimeout(resolve, backoffDelay);
      });
      return executeWithRetry(fn, retries - 1, attempt + 1);
    }

    // Registrar fallo en circuit breaker
    whatsappBreaker.recordFailure(error);
    throw error;
  }
}

/**
 * Envía un mensaje de texto simple
 * @param {string} to - Número de teléfono del destinatario
 * @param {string} text - Texto del mensaje
 */
async function sendText(to, text) {
  try {
    const { apiUrl, phoneNumberId } = getWhatsAppConfig();
    const axiosInstance = getAxiosInstance();

    const response = await executeWithRetry(() =>
      axiosInstance.post(`${apiUrl}/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: {
          preview_url: false,
          body: text,
        },
      })
    );
    return response.data;
  } catch (error) {
    logger.error('Error enviando texto', error, { to, service: 'WhatsApp', operation: 'sendText' });
    throw new ExternalServiceError('No se pudo enviar el mensaje de texto', 'WhatsApp', error);
  }
}

/**
 * Envía un mensaje con botones interactivos
 * @param {string} to - Número de teléfono del destinatario
 * @param {string} bodyText - Texto del cuerpo del mensaje
 * @param {Array} buttons - Array de botones [{id, title}, ...]
 */
async function sendButtons(to, bodyText, buttons) {
  try {
    const { apiUrl, phoneNumberId } = getWhatsAppConfig();
    const axiosInstance = getAxiosInstance();

    // Formatear botones para la API de WhatsApp
    const formattedButtons = formatButtons(buttons);

    const response = await executeWithRetry(() =>
      axiosInstance.post(`${apiUrl}/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: bodyText,
          },
          action: {
            buttons: formattedButtons,
          },
        },
      })
    );
    return response.data;
  } catch (error) {
    logger.error('Error enviando botones', error, {
      to,
      service: 'WhatsApp',
      operation: 'sendButtons',
    });
    throw new ExternalServiceError('No se pudo enviar los botones', 'WhatsApp', error);
  }
}

/**
 * Formatea botones para la API de WhatsApp
 * @param {Array} buttons - Array de botones [{id, title}, ...]
 * @returns {Array} - Botones formateados para la API
 */
function formatButtons(buttons) {
  return buttons.map((btn) => ({
    type: 'reply',
    reply: {
      id: btn.id,
      title: btn.title.substring(0, config.whatsapp.limits.buttonTitleMaxLength),
    },
  }));
}

/**
 * Descarga un archivo multimedia de WhatsApp
 * @param {string} mediaId - ID del archivo multimedia
 * @returns {Buffer} - Buffer con el contenido del archivo
 */
async function downloadMedia(mediaId) {
  try {
    const { apiUrl, accessToken } = getWhatsAppConfig();
    const axiosInstance = getAxiosInstance();

    // Paso 1: Obtener URL del archivo
    const mediaInfo = await executeWithRetry(() => axiosInstance.get(`${apiUrl}/${mediaId}`));

    const mediaUrl = mediaInfo.data.url;

    // Paso 2: Descargar el archivo (con timeout extendido y connection pooling)
    const mediaResponse = await axios.get(mediaUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      httpsAgent,
      responseType: 'arraybuffer',
      timeout: config.whatsapp.timeout.mediaDownloadMs,
    });

    return Buffer.from(mediaResponse.data);
  } catch (error) {
    logger.error('Error descargando media', error, {
      mediaId,
      service: 'WhatsApp',
      operation: 'downloadMedia',
    });
    throw new ExternalServiceError('No se pudo descargar el archivo multimedia', 'WhatsApp', error);
  }
}

/**
 * Marca como leído y muestra "Escribiendo..."
 * API oficial de WhatsApp (liberada a finales de 2025)
 * @param {string} to - Número de teléfono del destinatario (no usado pero mantenido para compatibilidad)
 * @param {string} messageId - ID del mensaje recibido
 */
async function sendTypingIndicator(to, messageId) {
  try {
    const { apiUrl, phoneNumberId } = getWhatsAppConfig();
    const axiosInstance = getAxiosInstance();

    logger.debug(`Enviando typing indicator`, { to, messageId });

    // Enviar read status + typing indicator en un solo request
    // Según la documentación de WhatsApp (finales de 2025)
    await executeWithRetry(() =>
      axiosInstance.post(`${apiUrl}/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: {
          type: 'text',
        },
      })
    );
    logger.whatsapp('sendTypingIndicator', true, { messageId });
  } catch (error) {
    // No lanzar error, solo loguear (typing indicator es opcional)
    logger.warn('Error enviando typing indicator', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
  }
}

/**
 * Envía un mensaje con header y botones en una sola llamada
 * @param {string} to - Número de teléfono del destinatario
 * @param {string} headerText - Texto del encabezado
 * @param {string} bodyText - Texto del cuerpo del mensaje
 * @param {Array} buttons - Array de botones [{id, title}, ...]
 */
async function sendInteractiveMessage(to, headerText, bodyText, buttons) {
  try {
    const { apiUrl, phoneNumberId } = getWhatsAppConfig();
    const axiosInstance = getAxiosInstance();

    // Formatear botones para la API de WhatsApp (reutilizar función)
    const formattedButtons = formatButtons(buttons);

    const response = await executeWithRetry(() =>
      axiosInstance.post(`${apiUrl}/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'button',
          header: {
            type: 'text',
            text: headerText,
          },
          body: {
            text: bodyText,
          },
          action: {
            buttons: formattedButtons,
          },
        },
      })
    );
    return response.data;
  } catch (error) {
    logger.error('Error enviando mensaje interactivo', error, {
      to,
      service: 'WhatsApp',
      operation: 'sendInteractiveMessage',
    });
    throw new ExternalServiceError('No se pudo enviar el mensaje interactivo', 'WhatsApp', error);
  }
}

/**
 * Envía un mensaje con lista desplegable (hasta 10 opciones)
 * @param {string} to - Número de teléfono del destinatario
 * @param {string} headerText - Texto del encabezado
 * @param {string} bodyText - Texto del cuerpo del mensaje
 * @param {string} buttonText - Texto del botón para abrir la lista
 * @param {Array} rows - Array de opciones [{id, title, description}, ...]
 */
async function sendListMessage(to, headerText, bodyText, buttonText, rows) {
  try {
    const { apiUrl, phoneNumberId } = getWhatsAppConfig();
    const axiosInstance = getAxiosInstance();

    // Formatear rows para la API de WhatsApp
    const formattedRows = rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description || '',
    }));

    const response = await executeWithRetry(() =>
      axiosInstance.post(`${apiUrl}/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: {
            type: 'text',
            text: headerText,
          },
          body: {
            text: bodyText,
          },
          action: {
            button: buttonText,
            sections: [
              {
                title: 'Opciones',
                rows: formattedRows,
              },
            ],
          },
        },
      })
    );
    return response.data;
  } catch (error) {
    logger.error('Error enviando mensaje de lista', error, {
      to,
      service: 'WhatsApp',
      operation: 'sendListMessage',
    });
    throw new ExternalServiceError('No se pudo enviar el mensaje de lista', 'WhatsApp', error);
  }
}

/**
 * Envia un mensaje de template (Message Templates de WhatsApp)
 * Usado para notificaciones outbound (recordatorios de firma, etc.)
 * @param {string} to - Numero de telefono del destinatario
 * @param {Object} templatePayload - Payload del template { name, language: { code }, components: [...] }
 * @returns {Promise<string>} - Message ID (wamid)
 */
async function sendTemplate(to, templatePayload) {
  try {
    const { apiUrl, phoneNumberId } = getWhatsAppConfig();
    const axiosInstance = getAxiosInstance();

    const response = await executeWithRetry(() =>
      axiosInstance.post(`${apiUrl}/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: templatePayload,
      })
    );

    const messageId = response.data?.messages?.[0]?.id || null;
    logger.info('[WhatsApp] Template enviado', {
      to,
      templateName: templatePayload?.name,
      messageId,
    });
    return messageId;
  } catch (error) {
    logger.error('Error enviando template', error, {
      to,
      templateName: templatePayload?.name,
      service: 'WhatsApp',
      operation: 'sendTemplate',
    });
    throw new ExternalServiceError('No se pudo enviar el template de WhatsApp', 'WhatsApp', error);
  }
}

// ==============================================================
// HELPERS CON GUARDADO AUTOMÁTICO EN BD
// Envian mensaje Y lo guardan en MensajesChat automaticamente
// ==============================================================

// Lazy load para evitar dependencia circular
let _db = null;
function getDb() {
  if (!_db) {
    _db = require('../storage/databaseService');
  }
  return _db;
}

/**
 * Envía texto Y lo guarda en BD automáticamente
 * @param {string} to - Número de teléfono
 * @param {string} text - Texto del mensaje
 * @param {string} tipoContenido - Tipo de contenido (default: 'TEXTO')
 */
async function sendAndSaveText(to, text, tipoContenido = 'TEXTO') {
  await sendText(to, text);
  // Guardar en BD (fire-and-forget, no bloquea)
  getDb()
    .saveMessage(to, 'B', text, tipoContenido)
    .catch((err) => {
      logger.warn('Error guardando mensaje del bot', { to, error: err.message });
    });
}

/**
 * Envía mensaje interactivo (con botones) Y lo guarda en BD
 * @param {string} to - Número de teléfono
 * @param {string} headerText - Texto del encabezado
 * @param {string} bodyText - Texto del cuerpo
 * @param {Array} buttons - Array de botones
 */
async function sendAndSaveInteractive(to, headerText, bodyText, buttons) {
  await sendInteractiveMessage(to, headerText, bodyText, buttons);
  // Guardar el texto completo (header + body) en BD
  const textoCompleto = headerText ? `${headerText}\n\n${bodyText}` : bodyText;
  getDb()
    .saveMessage(to, 'B', textoCompleto, 'TEXTO')
    .catch((err) => {
      logger.warn('Error guardando mensaje interactivo del bot', { to, error: err.message });
    });
}

/**
 * Envía lista Y la guarda en BD
 * @param {string} to - Número de teléfono
 * @param {string} headerText - Texto del encabezado
 * @param {string} bodyText - Texto del cuerpo
 * @param {string} buttonText - Texto del botón
 * @param {Array} rows - Opciones de la lista
 */
async function sendAndSaveList(to, headerText, bodyText, buttonText, rows) {
  await sendListMessage(to, headerText, bodyText, buttonText, rows);
  const textoCompleto = headerText ? `${headerText}\n\n${bodyText}` : bodyText;
  getDb()
    .saveMessage(to, 'B', textoCompleto, 'TEXTO')
    .catch((err) => {
      logger.warn('Error guardando mensaje de lista del bot', { to, error: err.message });
    });
}

module.exports = {
  // Funciones basicas (sin guardado)
  sendText,
  sendButtons,
  sendInteractiveMessage,
  sendListMessage,
  sendTemplate,
  downloadMedia,
  sendTypingIndicator,
  // Funciones con guardado automatico en BD
  sendAndSaveText,
  sendAndSaveInteractive,
  sendAndSaveList,
};
