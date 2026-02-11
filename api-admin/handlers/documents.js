/**
 * Handler: Documents Management
 * Rutas:
 *   GET  /api/admin/documents         - Listar documentos con filtros
 *   GET  /api/admin/documents/detail   - Detalle de un documento
 *   GET  /api/admin/documents/stats    - Estadisticas de documentos
 *   POST /api/admin/documents/void     - Anular un documento (admin action)
 */

const {
  validateContentType,
  validateContentLength,
  secureErrorResponse,
  secureSuccessResponse,
} = require('../../core/middleware/securityHeaders');
const audit = require('../../core/services/infrastructure/auditService');
const docusignService = require('../../core/services/external/docusignService');
const {
  ESTADO_DOCUMENTO,
  ESTADOS_DOCUMENTO_FINALES,
} = require('../../bot/constants/documentStates');

// Lazy-load repository
let _documentoRepo = null;
function getDocumentoRepo() {
  if (!_documentoRepo) {
    try {
      _documentoRepo = require('../../bot/repositories/DocumentoFirmaRepository');
    } catch (_e) {
      // Stub if repository not yet created
      _documentoRepo = {
        async listar() {
          return { records: [], total: 0 };
        },
        async obtenerPorId() {
          return null;
        },
        async obtenerEstadisticas() {
          return {};
        },
        async actualizarEstado() {
          return true;
        },
      };
    }
  }
  return _documentoRepo;
}

/**
 * List documents with optional filters
 * GET /api/admin/documents?estado=ENVIADO&tipo=CONTRATO&telefono=521...&page=1&pageSize=20
 */
async function list(context, req) {
  try {
    const filters = {
      estado: req.query.estado || null,
      tipoDocumento: req.query.tipo || null,
      clienteTelefono: req.query.telefono || null,
      sapDocumentId: req.query.sapId || null,
      page: parseInt(req.query.page) || 1,
      pageSize: Math.min(parseInt(req.query.pageSize) || 20, 100),
    };

    const repo = getDocumentoRepo();
    const result = await repo.listar(filters);

    context.log(`[Admin] Documentos listados: ${result.total || 0} resultados`);

    context.res = secureSuccessResponse(200, {
      success: true,
      documents: result.records || [],
      total: result.total || 0,
      page: filters.page,
      pageSize: filters.pageSize,
      filters: {
        estado: filters.estado,
        tipoDocumento: filters.tipoDocumento,
        clienteTelefono: filters.clienteTelefono,
        sapDocumentId: filters.sapDocumentId,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    context.log.error('Error listando documentos:', error);
    const errorMessage =
      process.env.NODE_ENV === 'development' ? error.message : 'Error interno del servidor';
    context.res = secureErrorResponse(500, errorMessage);
  }
}

/**
 * Get document detail
 * GET /api/admin/documents/detail?id=123&sapId=DOC-001
 */
async function detail(context, req) {
  try {
    const documentoId = req.query.id;
    const sapDocumentId = req.query.sapId;

    if (!documentoId && !sapDocumentId) {
      context.res = secureErrorResponse(400, 'Se requiere id o sapId como parametro');
      return;
    }

    const repo = getDocumentoRepo();
    let documento;

    if (documentoId) {
      documento = await repo.obtenerPorId(parseInt(documentoId));
    } else {
      documento = await repo.obtenerPorSapDocumentId(sapDocumentId);
    }

    if (!documento) {
      context.res = secureErrorResponse(404, 'Documento no encontrado');
      return;
    }

    context.res = secureSuccessResponse(200, {
      success: true,
      document: documento,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    context.log.error('Error obteniendo detalle de documento:', error);
    const errorMessage =
      process.env.NODE_ENV === 'development' ? error.message : 'Error interno del servidor';
    context.res = secureErrorResponse(500, errorMessage);
  }
}

/**
 * Get document statistics
 * GET /api/admin/documents/stats
 */
async function stats(context, _req) {
  try {
    const repo = getDocumentoRepo();
    const estadisticas = await repo.obtenerEstadisticas();

    context.res = secureSuccessResponse(200, {
      success: true,
      statistics: estadisticas,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    context.log.error('Error obteniendo estadisticas:', error);
    const errorMessage =
      process.env.NODE_ENV === 'development' ? error.message : 'Error interno del servidor';
    context.res = secureErrorResponse(500, errorMessage);
  }
}

/**
 * Void (annul) a document - Admin action
 * POST /api/admin/documents/void
 * Body: { documentoId: number, reason?: string }
 */
async function voidDocument(context, req) {
  context.log('Solicitud para anular documento');

  // Validar Content-Length
  const contentLengthCheck = validateContentLength(req);
  if (!contentLengthCheck.valid) {
    context.res = secureErrorResponse(413, contentLengthCheck.error);
    return;
  }

  // Validar Content-Type
  const contentTypeCheck = validateContentType(req);
  if (!contentTypeCheck.valid) {
    context.res = secureErrorResponse(415, contentTypeCheck.error);
    return;
  }

  try {
    const documentoId = req.body?.documentoId;
    const reason = req.body?.reason || 'Anulado por administrador';

    if (!documentoId) {
      context.res = secureErrorResponse(400, 'El campo documentoId es requerido');
      return;
    }

    const repo = getDocumentoRepo();

    // Verificar que el documento existe
    const documento = await repo.obtenerPorId(parseInt(documentoId));
    if (!documento) {
      context.res = secureErrorResponse(404, `No se encontro el documento: ${documentoId}`);
      return;
    }

    // Verificar que no esta en estado final
    if (ESTADOS_DOCUMENTO_FINALES.includes(documento.EstadoDocumento)) {
      context.res = secureErrorResponse(
        400,
        `El documento ${documentoId} esta en estado final: ${documento.EstadoDocumento}`,
        {
          documentoId,
          estadoActual: documento.EstadoDocumento,
        }
      );
      return;
    }

    // Anular envelope en DocuSign (si tiene envelopeId)
    if (documento.EnvelopeId) {
      try {
        await docusignService.voidEnvelope(documento.EnvelopeId, reason);
        context.log(`Envelope ${documento.EnvelopeId} anulado en DocuSign`);
      } catch (dsError) {
        context.log.error('Error anulando envelope en DocuSign:', dsError);
        // Continue - we still want to update the DB state
      }
    }

    // Actualizar estado en BD
    await repo.actualizarEstado(documentoId, ESTADO_DOCUMENTO.ANULADO, reason);

    context.log(`Documento ${documentoId} anulado`);
    audit.logTicketResolved(String(documentoId), documento.EstadoDocumento, req);

    context.res = secureSuccessResponse(200, {
      success: true,
      message: `Documento ${documentoId} marcado como anulado`,
      documentoId,
      estadoAnterior: documento.EstadoDocumento,
      estadoNuevo: ESTADO_DOCUMENTO.ANULADO,
      reason,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    context.log.error('Error al anular documento:', error);
    const errorMessage =
      process.env.NODE_ENV === 'development' ? error.message : 'Error interno del servidor';
    context.res = secureErrorResponse(500, errorMessage);
  }
}

module.exports = {
  list,
  detail,
  stats,
  voidDocument,
};
