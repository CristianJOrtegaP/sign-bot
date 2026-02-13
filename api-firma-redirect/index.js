/**
 * SIGN BOT - API: Firma Redirect
 * GET /api/firma/{documentoId}
 * Auth: anonymous (link viene de WhatsApp template)
 *
 * Flow:
 * 1. Lookup documento by DocumentoFirmaId
 * 2. Validate documento exists and is in a signable state
 * 3. Generate fresh DocuSign signing URL (recipientView)
 * 4. Redirect (302) to DocuSign
 *
 * Esto resuelve:
 * - URLs de DocuSign que expiran en 5 minutos
 * - WhatsApp template URL button necesita una URL base fija
 */

const { logger } = require('../core/services/infrastructure/errorHandler');
const { applySecurityHeaders } = require('../core/middleware/securityHeaders');
const docusignService = require('../core/services/external/docusignService');
const { ESTADO_DOCUMENTO_ID } = require('../bot/constants/documentStates');

// Lazy-loaded repository
let _documentoRepo = null;
function getDocumentoRepo() {
  if (!_documentoRepo) {
    try {
      _documentoRepo = require('../bot/repositories/DocumentoFirmaRepository');
    } catch (_e) {
      logger.warn('[Firma-Redirect] DocumentoFirmaRepository no disponible');
      _documentoRepo = null;
    }
  }
  return _documentoRepo;
}

// Estados en los que un documento puede ser firmado
const SIGNABLE_STATES = [
  ESTADO_DOCUMENTO_ID.PENDIENTE,
  ESTADO_DOCUMENTO_ID.ENVIADO,
  ESTADO_DOCUMENTO_ID.ENTREGADO,
  ESTADO_DOCUMENTO_ID.VISTO,
];

// Return URL despues de firmar (configurable)
const RETURN_URL = process.env.FIRMA_RETURN_URL || 'https://signbot.dev/signed';

/**
 * HTML de error amigable para el usuario
 */
function errorHtml(title, message) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
  .card{background:#fff;border-radius:12px;padding:2rem;max-width:400px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.1)}
  h1{color:#e74c3c;font-size:1.5rem}
  p{color:#666;line-height:1.6}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

module.exports = async function (context, req) {
  const documentoId = req.params.documentoId;

  // Validate documentoId is numeric
  if (!documentoId || !/^\d+$/.test(documentoId)) {
    context.res = {
      status: 400,
      headers: applySecurityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }),
      body: errorHtml(
        'Enlace invalido',
        'El enlace de firma no es valido. Contacta a tu ejecutivo.'
      ),
    };
    return;
  }

  const repo = getDocumentoRepo();
  if (!repo) {
    context.res = {
      status: 500,
      headers: applySecurityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }),
      body: errorHtml(
        'Error del sistema',
        'El servicio no esta disponible. Intenta de nuevo mas tarde.'
      ),
    };
    return;
  }

  try {
    // 1. Lookup documento
    const documento = await repo.obtenerPorId(parseInt(documentoId, 10));

    if (!documento) {
      context.res = {
        status: 404,
        headers: applySecurityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }),
        body: errorHtml('Documento no encontrado', 'Este documento no existe o fue eliminado.'),
      };
      return;
    }

    // 2. Validate state
    if (!SIGNABLE_STATES.includes(documento.EstadoDocumentoId)) {
      const stateMessages = {
        [ESTADO_DOCUMENTO_ID.FIRMADO]: 'Este documento ya fue firmado exitosamente.',
        [ESTADO_DOCUMENTO_ID.RECHAZADO]: 'Este documento fue rechazado.',
        [ESTADO_DOCUMENTO_ID.ANULADO]: 'Este documento fue anulado.',
      };
      const msg =
        stateMessages[documento.EstadoDocumentoId] ||
        'Este documento ya no esta disponible para firma.';

      context.res = {
        status: 410,
        headers: applySecurityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }),
        body: errorHtml('Documento no disponible', msg),
      };
      return;
    }

    if (!documento.EnvelopeId) {
      context.res = {
        status: 400,
        headers: applySecurityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }),
        body: errorHtml(
          'Sin sobre de firma',
          'Este documento aun no tiene un sobre de firma asociado. Contacta a tu ejecutivo.'
        ),
      };
      return;
    }

    // 3. Generate fresh signing URL
    const signerEmail =
      documento.ClienteEmail || `${documento.ClienteTelefono}@signbot.noreply.com`;
    const signingUrl = await docusignService.createRecipientView(
      documento.EnvelopeId,
      signerEmail,
      documento.ClienteNombre,
      RETURN_URL,
      documento.ClienteTelefono
    );

    logger.info('[Firma-Redirect] Redirigiendo a DocuSign', {
      documentoId,
      envelopeId: documento.EnvelopeId,
      clienteTelefono: documento.ClienteTelefono,
    });

    // 4. Redirect to DocuSign
    context.res = {
      status: 302,
      headers: applySecurityHeaders({
        Location: signingUrl,
        'Cache-Control': 'no-store, no-cache',
      }),
      body: '',
    };
  } catch (error) {
    logger.error('[Firma-Redirect] Error generando URL de firma', error, {
      documentoId,
    });

    context.res = {
      status: 500,
      headers: applySecurityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }),
      body: errorHtml(
        'Error al generar enlace',
        'No se pudo generar el enlace de firma. Intenta de nuevo en unos minutos o contacta a tu ejecutivo.'
      ),
    };
  }
};
