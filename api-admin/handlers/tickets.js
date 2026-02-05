/**
 * Handler: Tickets Management
 * Rutas: POST /api/admin/tickets/resolve
 */

const reporteRepository = require('../../bot/repositories/ReporteRepository');
const { ESTADO_REPORTE } = require('../../bot/constants/sessionStates');
const security = require('../../core/services/infrastructure/securityService');
const {
  validateContentType,
  validateContentLength,
  secureErrorResponse,
  secureSuccessResponse,
} = require('../../core/middleware/securityHeaders');
const audit = require('../../core/services/infrastructure/auditService');

/**
 * Resolver un ticket (cambiar estado a RESUELTO)
 */
async function resolve(context, req) {
  context.log('Solicitud para resolver ticket');

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
    const ticketId = req.body?.ticketId;

    if (!ticketId) {
      context.res = secureErrorResponse(400, 'El campo ticketId es requerido');
      return;
    }

    // Validar formato del ticketId
    const ticketValidation = security.validateTicketId(ticketId);
    if (!ticketValidation.valid) {
      context.res = secureErrorResponse(400, ticketValidation.error);
      return;
    }

    // Verificar que el ticket existe
    const reporte = await reporteRepository.getByTicket(ticketId);
    if (!reporte) {
      context.res = secureErrorResponse(404, `No se encontró el ticket: ${ticketId}`);
      return;
    }

    // Verificar estado actual
    if (reporte.Estado === ESTADO_REPORTE.RESUELTO) {
      context.res = secureErrorResponse(400, `El ticket ${ticketId} ya está resuelto`, {
        ticketId,
        estadoActual: reporte.Estado,
      });
      return;
    }

    if (reporte.Estado === ESTADO_REPORTE.CANCELADO) {
      context.res = secureErrorResponse(400, `El ticket ${ticketId} está cancelado`, {
        ticketId,
        estadoActual: reporte.Estado,
      });
      return;
    }

    // Actualizar estado
    const updated = await reporteRepository.resolverReporte(ticketId);

    if (!updated) {
      context.res = secureErrorResponse(500, `No se pudo actualizar el ticket: ${ticketId}`);
      return;
    }

    context.log(`Ticket ${ticketId} resuelto`);
    audit.logTicketResolved(ticketId, reporte.Estado, req);

    context.res = secureSuccessResponse(200, {
      success: true,
      message: `Ticket ${ticketId} marcado como resuelto`,
      ticketId,
      estadoAnterior: reporte.Estado,
      estadoNuevo: ESTADO_REPORTE.RESUELTO,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    context.log.error('Error al resolver ticket:', error);
    const errorMessage =
      process.env.NODE_ENV === 'development' ? error.message : 'Error interno del servidor';
    context.res = secureErrorResponse(500, errorMessage);
  }
}

module.exports = {
  resolve,
};
