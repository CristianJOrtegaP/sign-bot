/**
 * SIGN BOT - API: Receive Document for Signing
 * POST /api/sap-document
 * Auth: Azure Function Key (authLevel: function)
 *
 * Body: {
 *   sapDocumentId: string,
 *   sapCallbackUrl?: string,
 *   clienteTelefono: string (10-15 digits),
 *   clienteNombre: string,
 *   clienteEmail?: string,
 *   tipoDocumento: 'CONTRATO' | 'ADENDUM' | 'PAGARE' | 'OTRO',
 *   documentoNombre: string,
 *   pdfBase64: string (base64 encoded PDF),
 *   datosExtra?: object
 * }
 *
 * Flow:
 * 1. Validate payload
 * 2. Decode base64 PDF, validate it's a valid PDF (check magic bytes %PDF)
 * 3. Check file size against config.blob.maxPdfSizeMB
 * 4. Upload original PDF to Blob Storage
 * 5. Check if there's an existing active document for same sapDocumentId
 *    - If yes: use correctEnvelope to replace PDF in existing envelope
 *    - If no: create new envelope via docusignService.createEnvelope
 * 6. Save document record in DB via DocumentoFirmaRepository.crear()
 * 7. Send WhatsApp template notification via whatsappService.sendTemplate()
 *    - Use whatsappTemplates.buildTemplatePayload('firma_envio', params)
 * 8. Update document state to ENVIADO
 * 9. Return 201 with { documentoId, envelopeId, estado }
 *
 * Error handling: return appropriate HTTP codes (400, 413, 500)
 */

const config = require('../core/config');
const correlation = require('../core/services/infrastructure/correlationService');
const { logger } = require('../core/services/infrastructure/errorHandler');
const {
  validateContentType,
  secureErrorResponse,
  secureSuccessResponse,
} = require('../core/middleware/securityHeaders');
const docusignService = require('../core/services/external/docusignService');
const whatsappService = require('../core/services/external/whatsappService');
const blobService = require('../core/services/storage/blobService');
const teamsService = require('../core/services/external/teamsService');
const { buildTemplatePayload, TEMPLATE_NAMES } = require('../bot/constants/whatsappTemplates');
const {
  ESTADO_DOCUMENTO,
  ESTADO_DOCUMENTO_ID,
  TIPO_DOCUMENTO,
  getTipoDocumentoId,
} = require('../bot/constants/documentStates');

// PDF magic bytes: %PDF (hex: 25504446)
const PDF_MAGIC_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46]);

// Max PDF size from config (in bytes)
const MAX_PDF_SIZE = (config.blob.maxPdfSizeMB || 25) * 1024 * 1024;

// Valid document types
const VALID_TIPOS = Object.values(TIPO_DOCUMENTO);

/**
 * Validates the incoming payload
 * @param {Object} body - Request body
 * @returns {{ valid: boolean, error?: string }}
 */
function validatePayload(body) {
  if (!body) {
    return { valid: false, error: 'Request body es requerido' };
  }

  // Required fields
  if (!body.sapDocumentId || typeof body.sapDocumentId !== 'string') {
    return { valid: false, error: 'sapDocumentId es requerido (string)' };
  }

  if (!body.clienteTelefono || typeof body.clienteTelefono !== 'string') {
    return { valid: false, error: 'clienteTelefono es requerido (string)' };
  }

  // Validate phone format: 10-15 digits
  const phoneClean = body.clienteTelefono.replace(/\D/g, '');
  if (phoneClean.length < 10 || phoneClean.length > 15) {
    return { valid: false, error: 'clienteTelefono debe tener entre 10 y 15 digitos' };
  }

  if (!body.clienteNombre || typeof body.clienteNombre !== 'string') {
    return { valid: false, error: 'clienteNombre es requerido (string)' };
  }

  if (body.clienteNombre.length > 200) {
    return { valid: false, error: 'clienteNombre excede 200 caracteres' };
  }

  if (!body.tipoDocumento || !VALID_TIPOS.includes(body.tipoDocumento)) {
    return {
      valid: false,
      error: `tipoDocumento debe ser uno de: ${VALID_TIPOS.join(', ')}`,
    };
  }

  if (!body.documentoNombre || typeof body.documentoNombre !== 'string') {
    return { valid: false, error: 'documentoNombre es requerido (string)' };
  }

  if (body.documentoNombre.length > 500) {
    return { valid: false, error: 'documentoNombre excede 500 caracteres' };
  }

  if (!body.pdfBase64 || typeof body.pdfBase64 !== 'string') {
    return { valid: false, error: 'pdfBase64 es requerido (string base64)' };
  }

  // Optional email validation
  if (body.clienteEmail && typeof body.clienteEmail === 'string') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.clienteEmail)) {
      return { valid: false, error: 'clienteEmail no tiene un formato valido' };
    }
  }

  // Optional callback URL validation (SSRF protection)
  if (body.sapCallbackUrl) {
    if (typeof body.sapCallbackUrl !== 'string') {
      return { valid: false, error: 'sapCallbackUrl debe ser un string' };
    }
    try {
      // eslint-disable-next-line no-undef
      const parsed = new URL(body.sapCallbackUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { valid: false, error: 'sapCallbackUrl: protocolo no permitido (solo http/https)' };
      }
      const blockedHostPatterns =
        /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[::1?\])$/i;
      if (blockedHostPatterns.test(parsed.hostname)) {
        return { valid: false, error: 'sapCallbackUrl: host no permitido' };
      }
    } catch (_e) {
      return { valid: false, error: 'sapCallbackUrl no es una URL valida' };
    }
  }

  return { valid: true };
}

/**
 * Decodes and validates a base64 PDF
 * @param {string} base64String - Base64 encoded PDF
 * @returns {{ valid: boolean, buffer?: Buffer, error?: string }}
 */
function decodeAndValidatePdf(base64String) {
  let buffer;
  try {
    buffer = Buffer.from(base64String, 'base64');
  } catch (_error) {
    return { valid: false, error: 'pdfBase64 no es un string base64 valido' };
  }

  if (buffer.length === 0) {
    return { valid: false, error: 'El PDF decodificado esta vacio' };
  }

  // Check magic bytes (%PDF)
  if (buffer.length < 4 || !buffer.subarray(0, 4).equals(PDF_MAGIC_BYTES)) {
    return { valid: false, error: 'El archivo no es un PDF valido (magic bytes incorrectos)' };
  }

  // Check file size
  if (buffer.length > MAX_PDF_SIZE) {
    const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
    const maxMB = config.blob.maxPdfSizeMB || 25;
    return {
      valid: false,
      error: `El PDF excede el tamano maximo permitido: ${sizeMB}MB > ${maxMB}MB`,
      tooLarge: true,
    };
  }

  return { valid: true, buffer };
}

/**
 * Uploads a PDF to Blob Storage with a structured path
 * @param {Buffer} pdfBuffer - PDF buffer
 * @param {string} sapDocumentId - SAP document ID
 * @param {string} suffix - File name suffix (e.g., 'original', 'signed')
 * @returns {Promise<string>} - Blob URL with SAS token
 */
async function uploadPdfToBlob(pdfBuffer, sapDocumentId, suffix = 'original') {
  const container = await blobService.getContainerClient();

  const timestamp = Date.now();
  const blobName = `documentos/${sapDocumentId}/${timestamp}_${suffix}.pdf`;

  const blockBlobClient = container.getBlockBlobClient(blobName);

  await blockBlobClient.upload(pdfBuffer, pdfBuffer.length, {
    blobHTTPHeaders: {
      blobContentType: 'application/pdf',
    },
  });

  logger.info('[SAP-Document] PDF subido a Blob Storage', {
    blobName,
    sizeKB: (pdfBuffer.length / 1024).toFixed(1),
  });

  return blockBlobClient.url;
}

// Lazy-load DocumentoFirmaRepository to avoid circular dependencies at module load
let _documentoRepo = null;
function getDocumentoRepo() {
  if (!_documentoRepo) {
    try {
      _documentoRepo = require('../bot/repositories/DocumentoFirmaRepository');
    } catch (_e) {
      // Repository may not exist yet; provide a stub that warns
      logger.warn('[SAP-Document] DocumentoFirmaRepository no disponible, usando stub');
      _documentoRepo = {
        async crear() {
          logger.warn('[SAP-Document] DocumentoFirmaRepository.crear() stub - no persistence');
          return { DocumentoFirmaId: `stub-${Date.now()}` };
        },
        async obtenerActivoPorSapDocumentId() {
          return null;
        },
        async actualizarEstado() {
          return true;
        },
      };
    }
  }
  return _documentoRepo;
}

module.exports = async function (context, req) {
  const correlationId = correlation.generateCorrelationId();
  context.correlationId = correlationId;

  const log = (msg, ...args) => context.log(`[${correlationId}] ${msg}`, ...args);
  const logError = (msg, ...args) => context.log.error(`[${correlationId}] ${msg}`, ...args);

  log('POST /api/sap-document recibido');

  // Validate Content-Type
  const contentTypeCheck = validateContentType(req);
  if (!contentTypeCheck.valid) {
    context.res = secureErrorResponse(415, contentTypeCheck.error);
    return;
  }

  try {
    const body = req.body;

    // 1. Validate payload
    const validation = validatePayload(body);
    if (!validation.valid) {
      log(`Validacion fallida: ${validation.error}`);
      context.res = secureErrorResponse(400, validation.error);
      return;
    }

    // 2. Decode and validate PDF
    const pdfResult = decodeAndValidatePdf(body.pdfBase64);
    if (!pdfResult.valid) {
      log(`PDF invalido: ${pdfResult.error}`);
      const status = pdfResult.tooLarge ? 413 : 400;
      context.res = secureErrorResponse(status, pdfResult.error);
      return;
    }

    const pdfBuffer = pdfResult.buffer;
    const {
      sapDocumentId,
      sapCallbackUrl,
      clienteTelefono,
      clienteNombre,
      clienteEmail,
      tipoDocumento,
      documentoNombre,
      datosExtra,
    } = body;

    log(
      `Procesando documento SAP: ${sapDocumentId}, tipo: ${tipoDocumento}, cliente: ${clienteTelefono}`
    );

    // 3. Upload original PDF to Blob Storage
    let blobUrl;
    try {
      blobUrl = await uploadPdfToBlob(pdfBuffer, sapDocumentId, 'original');
      log('PDF subido a Blob Storage');
    } catch (blobError) {
      logError('Error subiendo PDF a Blob Storage:', blobError);
      context.res = secureErrorResponse(500, 'Error almacenando el documento PDF');
      return;
    }

    // 4. Check for existing active document for same sapDocumentId
    const documentoRepo = getDocumentoRepo();
    let existingDoc = null;
    try {
      existingDoc = await documentoRepo.obtenerActivoPorSapDocumentId(sapDocumentId);
    } catch (dbError) {
      log(`Error consultando documento existente: ${dbError.message}`);
      // Continue with new envelope creation
    }

    let envelopeId;
    let signingUrl = null;

    if (existingDoc && existingDoc.EnvelopeId) {
      // 5a. Existing active document: correct the envelope (replace PDF)
      log(`Documento existente encontrado, corrigiendo envelope: ${existingDoc.EnvelopeId}`);
      try {
        const corrected = await docusignService.correctEnvelope(
          existingDoc.EnvelopeId,
          pdfBuffer,
          documentoNombre
        );
        envelopeId = corrected.envelopeId;
        log(`Envelope corregido: ${envelopeId}`);
      } catch (correctError) {
        logError('Error corrigiendo envelope, creando uno nuevo:', correctError);
        // Fallback to creating a new envelope
        existingDoc = null;
      }
    }

    if (!existingDoc || !envelopeId) {
      // 5b. Create new envelope
      try {
        const signerEmail = clienteEmail || `${clienteTelefono}@signbot.noreply.com`;
        const envelopeResult = await docusignService.createEnvelope(
          pdfBuffer,
          signerEmail,
          clienteNombre,
          documentoNombre,
          { clienteTelefono }
        );
        envelopeId = envelopeResult.envelopeId;
        signingUrl = envelopeResult.signingUrl;
        log(`Envelope creado: ${envelopeId}`);
      } catch (dsError) {
        logError('Error creando envelope en DocuSign:', dsError);
        context.res = secureErrorResponse(500, 'Error creando el sobre de firma en DocuSign');
        return;
      }
    }

    // 6. Save document record in DB
    let documentoId;
    let documentoVersion = 0;
    try {
      const record = await documentoRepo.crear({
        SapDocumentId: sapDocumentId,
        SapCallbackUrl: sapCallbackUrl || null,
        ClienteTelefono: clienteTelefono,
        ClienteNombre: clienteNombre,
        ClienteEmail: clienteEmail || null,
        TipoDocumentoId: getTipoDocumentoId(tipoDocumento),
        DocumentoNombre: documentoNombre,
        DocumentoOriginalUrl: blobUrl,
        DatosExtra: datosExtra ? JSON.stringify(datosExtra) : null,
      });
      documentoId = record.DocumentoFirmaId;
      documentoVersion = record.Version || 0;
      log(`Documento registrado en BD: ${documentoId}`);
    } catch (dbError) {
      logError('Error guardando documento en BD:', dbError);
      context.res = secureErrorResponse(500, 'Error registrando el documento');
      return;
    }

    // 7. Send WhatsApp template notification
    // signingUrl param = documentoId (el template URL en Meta redirige via /api/firma/{id})
    try {
      const templatePayload = buildTemplatePayload(TEMPLATE_NAMES.FIRMA_ENVIO, {
        clienteNombre,
        tipoDocumento,
        documentoNombre,
        signingUrl: String(documentoId),
      });

      await whatsappService.sendTemplate(clienteTelefono, templatePayload);
      log('Template de WhatsApp enviado');
    } catch (waError) {
      // Don't fail the entire request if WhatsApp fails
      logError('Error enviando template de WhatsApp (no fatal):', waError);
      // Notify Teams about the WhatsApp failure
      teamsService
        .notifyError('Error enviando WhatsApp', `Documento ${sapDocumentId}`, {
          telefono: clienteTelefono,
          error: waError.message,
        })
        .catch(() => {});
    }

    // 8. Update document state to ENVIADO
    try {
      await documentoRepo.actualizarEstado(
        documentoId,
        ESTADO_DOCUMENTO_ID.ENVIADO,
        documentoVersion,
        { EnvelopeId: envelopeId, SigningUrl: signingUrl }
      );
      log('Estado actualizado a ENVIADO');
    } catch (stateError) {
      logError('Error actualizando estado a ENVIADO:', stateError);
      // Not fatal - the document was created successfully
    }

    // 9. Return 201 Created
    context.res = secureSuccessResponse(201, {
      success: true,
      documentoId,
      envelopeId,
      estado: ESTADO_DOCUMENTO.ENVIADO,
      sapDocumentId,
      timestamp: new Date().toISOString(),
      correlationId,
    });
  } catch (error) {
    logError('Error inesperado en POST /api/sap-document:', error);

    // Notify Teams
    teamsService
      .notifyError('Error en API SAP Document', error.message, {
        error: error.message,
      })
      .catch(() => {});

    const errorMessage =
      process.env.NODE_ENV === 'development' ? error.message : 'Error interno del servidor';
    context.res = secureErrorResponse(500, errorMessage);
  }
};
