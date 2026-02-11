/**
 * SIGN BOT - API: DocuSign Connect Webhook
 * POST /api/docusign-webhook
 * Auth: HMAC signature validation (DocuSign Connect)
 *
 * Flow:
 * 1. Validate HMAC signature using docusignService.validateWebhookHmac()
 * 2. Parse webhook payload
 * 3. Deduplicate: check EventoDocuSignRepository.registrar(eventId, envelopeId, type)
 *    - If duplicate, return 200 (idempotent)
 * 4. Look up document by envelopeId: DocumentoFirmaRepository.obtenerPorEnvelopeId()
 * 5. Handle events:
 *    - envelope-sent: update to ENVIADO (if not already)
 *    - envelope-delivered: update to ENTREGADO
 *    - recipient-viewed: update to VISTO
 *    - envelope-completed:
 *        a. Update to FIRMADO
 *        b. Download signed PDF via docusignService.downloadSignedDocument()
 *        c. Upload signed PDF to Blob Storage
 *        d. Send WhatsApp confirmation template (firma_confirmacion)
 *        e. Notify Teams
 *    - envelope-declined:
 *        a. Update to RECHAZADO with decline reason
 *        b. Notify Teams
 *    - envelope-voided:
 *        a. Update to ANULADO
 *        b. Send WhatsApp anulacion template
 * 6. Return 200
 */

const correlation = require('../core/services/infrastructure/correlationService');
const { logger } = require('../core/services/infrastructure/errorHandler');
const { applySecurityHeaders } = require('../core/middleware/securityHeaders');
const docusignService = require('../core/services/external/docusignService');
const whatsappService = require('../core/services/external/whatsappService');
const blobService = require('../core/services/storage/blobService');
const teamsService = require('../core/services/external/teamsService');
const { buildTemplatePayload, TEMPLATE_NAMES } = require('../bot/constants/whatsappTemplates');
const { ESTADO_DOCUMENTO } = require('../bot/constants/documentStates');

// ==============================================================
// LAZY-LOADED REPOSITORIES
// ==============================================================

let _documentoRepo = null;
function getDocumentoRepo() {
  if (!_documentoRepo) {
    try {
      _documentoRepo = require('../bot/repositories/DocumentoFirmaRepository');
    } catch (_e) {
      logger.warn('[DocuSign-Webhook] DocumentoFirmaRepository no disponible, usando stub');
      _documentoRepo = {
        async obtenerPorEnvelopeId() {
          return null;
        },
        async actualizarEstado() {
          return true;
        },
        async actualizarBlobFirmado() {
          return true;
        },
      };
    }
  }
  return _documentoRepo;
}

let _eventoRepo = null;
function getEventoRepo() {
  if (!_eventoRepo) {
    try {
      _eventoRepo = require('../bot/repositories/EventoDocuSignRepository');
    } catch (_e) {
      logger.warn('[DocuSign-Webhook] EventoDocuSignRepository no disponible, usando stub');
      _eventoRepo = {
        async registrar() {
          return { isDuplicate: false };
        },
      };
    }
  }
  return _eventoRepo;
}

// ==============================================================
// HELPER FUNCTIONS
// ==============================================================

/**
 * Creates loggers with correlation ID
 */
function createLoggers(context, correlationId) {
  return {
    log: (msg, ...args) => context.log(`[${correlationId}] ${msg}`, ...args),
    logWarn: (msg, ...args) => context.log.warn(`[${correlationId}] ${msg}`, ...args),
    logError: (msg, ...args) => context.log.error(`[${correlationId}] ${msg}`, ...args),
  };
}

/**
 * Creates a 200 OK response (DocuSign expects 200 for successful receipt)
 */
function createOkResponse(correlationId) {
  return {
    status: 200,
    headers: applySecurityHeaders({
      'Content-Type': 'application/json',
      'x-correlation-id': correlationId,
    }),
    body: { success: true },
  };
}

/**
 * Extracts event information from DocuSign Connect payload
 * @param {Object} body - Webhook body
 * @returns {{ eventType: string, envelopeId: string, eventId: string, declineReason?: string }}
 */
function extractEventInfo(body) {
  // DocuSign Connect sends different payload formats depending on configuration
  // Standard format: body.event, body.data.envelopeId, body.data.envelopeSummary
  // Legacy XML-to-JSON: body.EnvelopeStatus

  const eventType = body.event || body.eventType || null;
  const envelopeId =
    body.data?.envelopeId || body.data?.envelopeSummary?.envelopeId || body.envelopeId || null;
  const eventId = body.data?.eventId || body.eventId || `${envelopeId}-${eventType}-${Date.now()}`;

  // Extract decline reason if present
  let declineReason = null;
  if (body.data?.envelopeSummary?.recipients?.signers) {
    const signers = body.data.envelopeSummary.recipients.signers;
    for (const signer of signers) {
      if (signer.declinedReason) {
        declineReason = signer.declinedReason;
        break;
      }
    }
  }

  return { eventType, envelopeId, eventId, declineReason };
}

/**
 * Uploads the signed PDF to Blob Storage
 * @param {Buffer} pdfBuffer - Signed PDF buffer
 * @param {string} sapDocumentId - SAP document ID for path organization
 * @returns {Promise<string>} - Blob URL
 */
async function uploadSignedPdf(pdfBuffer, sapDocumentId) {
  const container = await blobService.getContainerClient();
  const timestamp = Date.now();
  const blobName = `documentos/${sapDocumentId}/${timestamp}_firmado.pdf`;

  const blockBlobClient = container.getBlockBlobClient(blobName);

  await blockBlobClient.upload(pdfBuffer, pdfBuffer.length, {
    blobHTTPHeaders: {
      blobContentType: 'application/pdf',
    },
  });

  logger.info('[DocuSign-Webhook] PDF firmado subido a Blob', {
    blobName,
    sizeKB: (pdfBuffer.length / 1024).toFixed(1),
  });

  return blockBlobClient.url;
}

// ==============================================================
// EVENT HANDLERS
// ==============================================================

/**
 * Handles envelope-sent event
 */
async function handleEnvelopeSent(documento, log) {
  if (documento.EstadoDocumento === ESTADO_DOCUMENTO.ENVIADO) {
    log('Documento ya marcado como ENVIADO, omitiendo');
    return;
  }
  await getDocumentoRepo().actualizarEstado(documento.DocumentoFirmaId, ESTADO_DOCUMENTO.ENVIADO);
  log('Estado actualizado a ENVIADO');
}

/**
 * Handles envelope-delivered event
 */
async function handleEnvelopeDelivered(documento, log) {
  await getDocumentoRepo().actualizarEstado(documento.DocumentoFirmaId, ESTADO_DOCUMENTO.ENTREGADO);
  log('Estado actualizado a ENTREGADO');
}

/**
 * Handles recipient-viewed event
 */
async function handleRecipientViewed(documento, log) {
  await getDocumentoRepo().actualizarEstado(documento.DocumentoFirmaId, ESTADO_DOCUMENTO.VISTO);
  log('Estado actualizado a VISTO');
}

/**
 * Handles envelope-completed event (document signed)
 */
async function handleEnvelopeCompleted(documento, envelopeId, log, logError) {
  const repo = getDocumentoRepo();

  // a. Update to FIRMADO
  await repo.actualizarEstado(documento.DocumentoFirmaId, ESTADO_DOCUMENTO.FIRMADO);
  log('Estado actualizado a FIRMADO');

  // b. Download signed PDF from DocuSign
  let signedPdfBuffer;
  try {
    signedPdfBuffer = await docusignService.downloadSignedDocument(envelopeId);
    log(`PDF firmado descargado: ${(signedPdfBuffer.length / 1024).toFixed(1)}KB`);
  } catch (downloadError) {
    logError('Error descargando PDF firmado:', downloadError);
    // Continue - the document is still marked as signed
  }

  // c. Upload signed PDF to Blob Storage
  if (signedPdfBuffer) {
    try {
      const blobUrl = await uploadSignedPdf(signedPdfBuffer, documento.SapDocumentId);
      await repo.actualizarBlobFirmado(documento.DocumentoFirmaId, blobUrl);
      log('PDF firmado subido a Blob Storage');
    } catch (uploadError) {
      logError('Error subiendo PDF firmado a Blob:', uploadError);
    }
  }

  // d. Send WhatsApp confirmation template
  try {
    const templatePayload = buildTemplatePayload(TEMPLATE_NAMES.FIRMA_CONFIRMACION, {
      clienteNombre: documento.ClienteNombre,
      tipoDocumento: documento.TipoDocumento,
      documentoNombre: documento.DocumentoNombre,
    });
    await whatsappService.sendTemplate(documento.ClienteTelefono, templatePayload);
    log('Template de confirmacion enviado por WhatsApp');
  } catch (waError) {
    logError('Error enviando confirmacion por WhatsApp:', waError);
  }

  // e. Notify Teams
  teamsService
    .notifyTicketCreated(
      documento.ClienteTelefono,
      documento.TipoDocumento,
      documento.SapDocumentId,
      { codigoSAP: documento.SapDocumentId, problema: 'Documento firmado exitosamente' }
    )
    .catch((teamsError) => {
      logError('Error notificando a Teams:', teamsError);
    });
}

/**
 * Handles envelope-declined event
 */
async function handleEnvelopeDeclined(documento, declineReason, log, logError) {
  const repo = getDocumentoRepo();

  // a. Update to RECHAZADO with reason
  await repo.actualizarEstado(
    documento.DocumentoFirmaId,
    ESTADO_DOCUMENTO.RECHAZADO,
    declineReason || 'Sin motivo especificado'
  );
  log(`Estado actualizado a RECHAZADO. Motivo: ${declineReason || 'N/A'}`);

  // b. Notify Teams
  teamsService
    .notifyError(
      'Documento Rechazado',
      `${documento.DocumentoNombre} - ${documento.SapDocumentId}`,
      {
        telefono: documento.ClienteTelefono,
        error: declineReason || 'Sin motivo especificado',
      }
    )
    .catch((teamsError) => {
      logError('Error notificando rechazo a Teams:', teamsError);
    });
}

/**
 * Handles envelope-voided event
 */
async function handleEnvelopeVoided(documento, log, logError) {
  const repo = getDocumentoRepo();

  // a. Update to ANULADO
  await repo.actualizarEstado(documento.DocumentoFirmaId, ESTADO_DOCUMENTO.ANULADO);
  log('Estado actualizado a ANULADO');

  // b. Send WhatsApp anulacion template
  try {
    const templatePayload = buildTemplatePayload(TEMPLATE_NAMES.FIRMA_ANULACION, {
      clienteNombre: documento.ClienteNombre,
      tipoDocumento: documento.TipoDocumento,
      documentoNombre: documento.DocumentoNombre,
    });
    await whatsappService.sendTemplate(documento.ClienteTelefono, templatePayload);
    log('Template de anulacion enviado por WhatsApp');
  } catch (waError) {
    logError('Error enviando anulacion por WhatsApp:', waError);
  }
}

// ==============================================================
// MAIN HANDLER
// ==============================================================

module.exports = async function (context, req) {
  const correlationId = correlation.generateCorrelationId();
  context.correlationId = correlationId;

  const { log, logWarn, logError } = createLoggers(context, correlationId);
  log('POST /api/docusign-webhook recibido');

  try {
    // 1. Validate HMAC signature
    const hmacHeader = req.headers['x-docusign-signature-1'];
    const rawBody = req.rawBody || JSON.stringify(req.body);

    // In production, HMAC validation is mandatory
    const isProduction =
      process.env.AZURE_FUNCTIONS_ENVIRONMENT ||
      process.env.WEBSITE_SITE_NAME ||
      process.env.NODE_ENV === 'production';
    const skipValidation = !isProduction && process.env.SKIP_DOCUSIGN_HMAC_VALIDATION === 'true';

    if (skipValidation) {
      logWarn('DEV: Validacion HMAC de DocuSign omitida');
    } else if (!docusignService.validateWebhookHmac(rawBody, hmacHeader)) {
      logWarn('HMAC de DocuSign invalido - request rechazado');
      context.res = {
        status: 401,
        headers: applySecurityHeaders({ 'Content-Type': 'application/json' }),
        body: { error: 'Invalid HMAC signature' },
      };
      return;
    }

    // 2. Parse webhook payload
    const body = req.body;
    if (!body) {
      log('Payload vacio, devolviendo 200');
      context.res = createOkResponse(correlationId);
      return;
    }

    const { eventType, envelopeId, eventId, declineReason } = extractEventInfo(body);

    if (!eventType || !envelopeId) {
      logWarn('Evento sin eventType o envelopeId, ignorando');
      context.res = createOkResponse(correlationId);
      return;
    }

    log(`Evento DocuSign: ${eventType} | Envelope: ${envelopeId} | EventId: ${eventId}`);

    // 3. Deduplicate
    const eventoRepo = getEventoRepo();
    try {
      const dedup = await eventoRepo.registrar(eventId, envelopeId, eventType);
      if (dedup.isDuplicate) {
        log(`Evento duplicado ignorado (idempotente): ${eventId}`);
        context.res = createOkResponse(correlationId);
        return;
      }
    } catch (dedupError) {
      logWarn(`Error en deduplicacion, continuando: ${dedupError.message}`);
      // Continue processing - better to process twice than lose an event
    }

    // 4. Look up document by envelopeId
    const documentoRepo = getDocumentoRepo();
    const documento = await documentoRepo.obtenerPorEnvelopeId(envelopeId);

    if (!documento) {
      logWarn(`Documento no encontrado para envelopeId: ${envelopeId}`);
      // Return 200 to prevent DocuSign from retrying (may be an unrelated envelope)
      context.res = createOkResponse(correlationId);
      return;
    }

    log(`Documento encontrado: ${documento.DocumentoFirmaId} | SAP: ${documento.SapDocumentId}`);

    // 5. Handle events
    switch (eventType) {
      case 'envelope-sent':
        await handleEnvelopeSent(documento, log);
        break;

      case 'envelope-delivered':
        await handleEnvelopeDelivered(documento, log);
        break;

      case 'recipient-viewed':
        await handleRecipientViewed(documento, log);
        break;

      case 'envelope-completed':
        await handleEnvelopeCompleted(documento, envelopeId, log, logError);
        break;

      case 'envelope-declined':
        await handleEnvelopeDeclined(documento, declineReason, log, logError);
        break;

      case 'envelope-voided':
        await handleEnvelopeVoided(documento, log, logError);
        break;

      default:
        log(`Evento no manejado: ${eventType} (ignorando)`);
    }

    // 6. Return 200
    context.res = createOkResponse(correlationId);
  } catch (error) {
    logError('Error procesando webhook de DocuSign:', error);

    // Notify Teams about the error
    teamsService
      .notifyError('Error en DocuSign Webhook', error.message, {
        error: error.message,
      })
      .catch(() => {});

    // Always return 200 to prevent DocuSign from excessive retries
    // The error is logged and Teams is notified for manual investigation
    context.res = createOkResponse(correlationId);
  }
};
