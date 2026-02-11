/**
 * SIGN BOT - Servicio de DocuSign
 * Funciones para crear, gestionar y firmar documentos via DocuSign eSign API
 * Con JWT Grant authentication y Circuit Breaker para proteccion contra fallos
 */

const crypto = require('crypto');
const docusign = require('docusign-esign');
const config = require('../../config');
const { logger, ExternalServiceError } = require('../infrastructure/errorHandler');
const { getBreaker, SERVICES } = require('../infrastructure/circuitBreaker');

// Circuit breaker para DocuSign
const docusignBreaker = getBreaker(SERVICES.DOCUSIGN);

// Estado del token JWT (singleton)
let apiClient = null;
let tokenExpiresAt = 0;

// Buffer de seguridad para renovacion de token (5 minutos antes de expirar)
const TOKEN_BUFFER_MS = 5 * 60 * 1000;

// Reintentos
const MAX_RETRIES = config.docusign.retry.maxRetries;

/**
 * Calcula el delay con exponential backoff y jitter
 * @param {number} attempt - Numero de intento (0-based)
 * @param {number} baseDelay - Delay base en ms
 * @param {number} maxDelay - Delay maximo en ms
 * @returns {number} - Delay en ms
 */
function calculateBackoff(attempt, baseDelay = 2000, maxDelay = 30000) {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelay);
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
  if (['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE'].includes(error.code)) {
    return true;
  }

  // Errores HTTP 429 (rate limit) y 5xx (server error)
  const status = error.status || error.response?.status;
  if (status === 429 || (status >= 500 && status < 600)) {
    return true;
  }

  return false;
}

/**
 * Ejecuta una operacion con reintentos automaticos, exponential backoff y circuit breaker
 * @param {Function} fn - Funcion async a ejecutar
 * @param {number} retries - Numero de reintentos restantes
 * @param {number} attempt - Numero de intento actual (para backoff)
 */
async function executeWithRetry(fn, retries = MAX_RETRIES, attempt = 0) {
  const check = docusignBreaker.canExecute();
  if (!check.allowed) {
    throw new ExternalServiceError(check.reason, 'DocuSign', { isCircuitBreakerOpen: true });
  }

  try {
    const result = await fn();
    docusignBreaker.recordSuccess();
    return result;
  } catch (error) {
    if (retries > 0 && isRetryableError(error)) {
      const backoffDelay = calculateBackoff(attempt);
      logger.warn('DocuSign error, reintentando con backoff...', {
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        delayMs: backoffDelay,
        errorCode: error.code,
        httpStatus: error.status || error.response?.status,
      });
      await new Promise((resolve) => {
        setTimeout(resolve, backoffDelay);
      });
      return executeWithRetry(fn, retries - 1, attempt + 1);
    }

    docusignBreaker.recordFailure(error);
    throw error;
  }
}

/**
 * Obtiene o renueva el ApiClient con JWT Grant authentication
 * Reutiliza el token mientras no haya expirado (con buffer de 5 min)
 * @returns {Promise<docusign.ApiClient>}
 */
async function getApiClient() {
  const now = Date.now();

  // Reutilizar si el token aun es valido
  if (apiClient && now < tokenExpiresAt - TOKEN_BUFFER_MS) {
    return apiClient;
  }

  logger.info('[DocuSign] Solicitando nuevo token JWT');

  const client = new docusign.ApiClient();
  client.setBasePath(config.docusign.baseUrl);
  client.setOAuthBasePath(config.docusign.oauthBaseUrl.replace('https://', ''));

  // RSA private key: en variables de entorno los \n literales necesitan reemplazarse
  const rsaKey = config.docusign.rsaPrivateKey.replace(/\\n/g, '\n');

  const results = await client.requestJWTUserToken(
    config.docusign.integrationKey,
    config.docusign.userId,
    ['signature', 'impersonation'],
    Buffer.from(rsaKey),
    3600 // Token valido 1 hora
  );

  const accessToken = results.body.access_token;
  const expiresIn = results.body.expires_in; // segundos

  client.addDefaultHeader('Authorization', `Bearer ${accessToken}`);
  tokenExpiresAt = now + expiresIn * 1000;
  apiClient = client;

  logger.info('[DocuSign] Token JWT obtenido correctamente', {
    expiresInMinutes: Math.round(expiresIn / 60),
  });

  return apiClient;
}

/**
 * Crea un nuevo envelope con un PDF para firma remota
 * El firmante recibe una notificacion por email de DocuSign.
 * Tambien genera un recipientView URL para enviar por WhatsApp.
 *
 * @param {Buffer} pdfBuffer - Buffer del documento PDF
 * @param {string} signerEmail - Email del firmante
 * @param {string} signerName - Nombre del firmante
 * @param {string} documentName - Nombre del documento
 * @param {Object} options - Opciones adicionales
 * @param {string} [options.clienteTelefono] - Telefono del cliente (metadata)
 * @param {string} [options.returnUrl] - URL de redireccion despues de firmar
 * @returns {Promise<{envelopeId: string, signingUrl: string|null}>}
 */
async function createEnvelope(pdfBuffer, signerEmail, signerName, documentName, options = {}) {
  try {
    const client = await getApiClient();

    // Construir documento
    const documentBase64 = pdfBuffer.toString('base64');
    const document = new docusign.Document();
    document.documentBase64 = documentBase64;
    document.name = documentName;
    document.fileExtension = 'pdf';
    document.documentId = '1';

    // Construir firmante
    const signer = new docusign.Signer();
    signer.email = signerEmail;
    signer.name = signerName;
    signer.recipientId = '1';
    signer.routingOrder = '1';
    // clientUserId habilita embedded signing (necesario para recipientView)
    signer.clientUserId = options.clienteTelefono || signerEmail;

    // Firma en la ultima pagina (el firmante la posiciona al abrir)
    const signHere = new docusign.SignHere();
    signHere.anchorString = '/sn1/';
    signHere.anchorUnits = 'pixels';
    signHere.anchorXOffset = '0';
    signHere.anchorYOffset = '0';

    const tabs = new docusign.Tabs();
    tabs.signHereTabs = [signHere];
    signer.tabs = tabs;

    // Construir recipients
    const recipients = new docusign.Recipients();
    recipients.signers = [signer];

    // Construir definicion del envelope
    const envelopeDefinition = new docusign.EnvelopeDefinition();
    envelopeDefinition.emailSubject = `Documento para firma: ${documentName}`;
    envelopeDefinition.documents = [document];
    envelopeDefinition.recipients = recipients;
    envelopeDefinition.status = 'sent'; // Enviar inmediatamente

    // Configurar expiracion
    const notification = new docusign.Notification();
    const expirations = new docusign.Expirations();
    expirations.expireEnabled = 'true';
    expirations.expireAfter = String(config.docusign.envelopeExpirationDays);
    expirations.expireWarn = String(Math.max(1, config.docusign.envelopeExpirationDays - 3));
    notification.expirations = expirations;
    envelopeDefinition.notification = notification;

    // Metadata personalizada
    if (options.clienteTelefono) {
      const customField = new docusign.TextCustomField();
      customField.name = 'clienteTelefono';
      customField.value = options.clienteTelefono;
      customField.show = 'false';

      const customFields = new docusign.CustomFields();
      customFields.textCustomFields = [customField];
      envelopeDefinition.customFields = customFields;
    }

    // Crear envelope via API
    const envelopesApi = new docusign.EnvelopesApi(client);

    const envelopeResult = await executeWithRetry(() =>
      envelopesApi.createEnvelope(config.docusign.accountId, {
        envelopeDefinition,
      })
    );

    const envelopeId = envelopeResult.envelopeId;
    logger.info('[DocuSign] Envelope creado', {
      envelopeId,
      documentName,
      signerEmail,
    });

    // Generar signing URL para WhatsApp
    let signingUrl = null;
    try {
      const returnUrl = options.returnUrl || config.docusign.baseUrl;
      signingUrl = await createRecipientView(
        envelopeId,
        signerEmail,
        signerName,
        returnUrl,
        signer.clientUserId
      );
    } catch (urlError) {
      logger.warn('[DocuSign] No se pudo generar signing URL, el firmante usara email', {
        envelopeId,
        error: urlError.message,
      });
    }

    return { envelopeId, signingUrl };
  } catch (error) {
    logger.error('Error creando envelope en DocuSign', error, {
      documentName,
      signerEmail,
      service: 'DocuSign',
      operation: 'createEnvelope',
    });
    throw new ExternalServiceError('No se pudo crear el envelope en DocuSign', 'DocuSign', error);
  }
}

/**
 * Corrige un envelope existente reemplazando el PDF
 * Reutiliza el envelope (ahorra costos) en vez de anular + crear nuevo
 *
 * @param {string} envelopeId - ID del envelope a corregir
 * @param {Buffer} newPdfBuffer - Buffer del nuevo PDF
 * @param {string} documentName - Nombre del documento
 * @returns {Promise<{envelopeId: string, documentName: string}>}
 */
async function correctEnvelope(envelopeId, newPdfBuffer, documentName) {
  try {
    const client = await getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(client);

    // Reemplazar documento en el envelope existente
    const documentBase64 = newPdfBuffer.toString('base64');
    const document = new docusign.Document();
    document.documentBase64 = documentBase64;
    document.name = documentName;
    document.fileExtension = 'pdf';
    document.documentId = '1';

    await executeWithRetry(() =>
      envelopesApi.updateDocuments(config.docusign.accountId, envelopeId, {
        envelopeDefinition: {
          documents: [document],
        },
      })
    );

    logger.info('[DocuSign] Documento corregido en envelope', {
      envelopeId,
      documentName,
    });

    return { envelopeId, documentName };
  } catch (error) {
    logger.error('Error corrigiendo envelope en DocuSign', error, {
      envelopeId,
      documentName,
      service: 'DocuSign',
      operation: 'correctEnvelope',
    });
    throw new ExternalServiceError(
      'No se pudo corregir el documento en DocuSign',
      'DocuSign',
      error
    );
  }
}

/**
 * Anula un envelope existente
 * Se usa para cancelaciones desde SAP o limpieza de housekeeping
 *
 * @param {string} envelopeId - ID del envelope a anular
 * @param {string} reason - Motivo de la anulacion
 * @returns {Promise<void>}
 */
async function voidEnvelope(envelopeId, reason) {
  try {
    const client = await getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(client);

    const envelope = new docusign.Envelope();
    envelope.status = 'voided';
    envelope.voidedReason = reason || 'Cancelado por el sistema';

    await executeWithRetry(() =>
      envelopesApi.update(config.docusign.accountId, envelopeId, {
        envelope,
      })
    );

    logger.info('[DocuSign] Envelope anulado', { envelopeId, reason });
  } catch (error) {
    logger.error('Error anulando envelope en DocuSign', error, {
      envelopeId,
      reason,
      service: 'DocuSign',
      operation: 'voidEnvelope',
    });
    throw new ExternalServiceError('No se pudo anular el envelope en DocuSign', 'DocuSign', error);
  }
}

/**
 * Obtiene el estado actual de un envelope
 *
 * @param {string} envelopeId - ID del envelope
 * @returns {Promise<{status: string, statusChangedDateTime: string, envelopeId: string}>}
 */
async function getEnvelopeStatus(envelopeId) {
  try {
    const client = await getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(client);

    const result = await executeWithRetry(() =>
      envelopesApi.getEnvelope(config.docusign.accountId, envelopeId)
    );

    logger.debug('[DocuSign] Estado de envelope consultado', {
      envelopeId,
      status: result.status,
    });

    return {
      status: result.status,
      statusChangedDateTime: result.statusChangedDateTime,
      envelopeId: result.envelopeId,
    };
  } catch (error) {
    logger.error('Error consultando estado de envelope en DocuSign', error, {
      envelopeId,
      service: 'DocuSign',
      operation: 'getEnvelopeStatus',
    });
    throw new ExternalServiceError(
      'No se pudo consultar el estado del envelope en DocuSign',
      'DocuSign',
      error
    );
  }
}

/**
 * Descarga el documento firmado como Buffer
 * Usa documentId = 'combined' para obtener todos los documentos combinados
 *
 * @param {string} envelopeId - ID del envelope completado
 * @returns {Promise<Buffer>} - Buffer con el PDF firmado
 */
async function downloadSignedDocument(envelopeId) {
  try {
    const client = await getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(client);

    const result = await executeWithRetry(() =>
      envelopesApi.getDocument(config.docusign.accountId, envelopeId, 'combined')
    );

    // El SDK devuelve un Buffer o stream; asegurar que sea Buffer
    const buffer = Buffer.isBuffer(result) ? result : Buffer.from(result);

    logger.info('[DocuSign] Documento firmado descargado', {
      envelopeId,
      sizeKB: (buffer.length / 1024).toFixed(1),
    });

    return buffer;
  } catch (error) {
    logger.error('Error descargando documento firmado de DocuSign', error, {
      envelopeId,
      service: 'DocuSign',
      operation: 'downloadSignedDocument',
    });
    throw new ExternalServiceError(
      'No se pudo descargar el documento firmado de DocuSign',
      'DocuSign',
      error
    );
  }
}

/**
 * Crea una URL de firma embebida (recipientView) para enviar por WhatsApp
 * Genera una URL de un solo uso que el firmante puede abrir en su navegador
 *
 * @param {string} envelopeId - ID del envelope
 * @param {string} signerEmail - Email del firmante
 * @param {string} signerName - Nombre del firmante
 * @param {string} returnUrl - URL de redireccion despues de firmar
 * @param {string} [clientUserId] - clientUserId del signer (para embedded signing)
 * @returns {Promise<string>} - URL de firma
 */
async function createRecipientView(envelopeId, signerEmail, signerName, returnUrl, clientUserId) {
  try {
    const client = await getApiClient();
    const envelopesApi = new docusign.EnvelopesApi(client);

    const viewRequest = new docusign.RecipientViewRequest();
    viewRequest.returnUrl = returnUrl;
    viewRequest.authenticationMethod = 'none';
    viewRequest.email = signerEmail;
    viewRequest.userName = signerName;
    viewRequest.clientUserId = clientUserId || signerEmail;

    const result = await executeWithRetry(() =>
      envelopesApi.createRecipientView(config.docusign.accountId, envelopeId, {
        recipientViewRequest: viewRequest,
      })
    );

    logger.info('[DocuSign] Recipient view URL generado', { envelopeId });

    return result.url;
  } catch (error) {
    logger.error('Error creando recipient view en DocuSign', error, {
      envelopeId,
      signerEmail,
      service: 'DocuSign',
      operation: 'createRecipientView',
    });
    throw new ExternalServiceError(
      'No se pudo generar la URL de firma en DocuSign',
      'DocuSign',
      error
    );
  }
}

/**
 * Valida la firma HMAC de un webhook de DocuSign Connect
 * Compara el HMAC-SHA256 del payload con el header recibido
 *
 * @param {string} payload - Body crudo del webhook (string)
 * @param {string} hmacHeader - Valor del header X-DocuSign-Signature-1
 * @returns {boolean} - true si la firma es valida
 */
function validateWebhookHmac(payload, hmacHeader) {
  if (!config.docusign.webhookSecret || !hmacHeader) {
    logger.warn('[DocuSign] Webhook secret o header HMAC no configurado');
    return false;
  }

  try {
    const computedHmac = crypto
      .createHmac('sha256', config.docusign.webhookSecret)
      .update(payload)
      .digest('base64');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(computedHmac, 'base64'),
      Buffer.from(hmacHeader, 'base64')
    );

    if (!isValid) {
      logger.warn('[DocuSign] Webhook HMAC invalido');
    }

    return isValid;
  } catch (error) {
    logger.error('Error validando webhook HMAC de DocuSign', error, {
      service: 'DocuSign',
      operation: 'validateWebhookHmac',
    });
    return false;
  }
}

module.exports = {
  createEnvelope,
  correctEnvelope,
  voidEnvelope,
  getEnvelopeStatus,
  downloadSignedDocument,
  createRecipientView,
  validateWebhookHmac,
};
