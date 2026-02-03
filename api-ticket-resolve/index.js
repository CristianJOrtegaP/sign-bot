/**
 * AC FIXBOT - Funcion para Resolver Tickets
 * Cambia el estado de un reporte a RESUELTO
 *
 * Endpoint:
 * - POST /api/resolveTicket
 *   Body: { "ticketId": "TKT1737489234567" }
 */

const reporteRepository = require('../bot/repositories/ReporteRepository');
const { ESTADO_REPORTE } = require('../bot/constants/sessionStates');
const security = require('../core/services/infrastructure/securityService');
const {
    validateContentType,
    validateContentLength,
    secureErrorResponse,
    secureSuccessResponse
} = require('../core/middleware/securityHeaders');
const audit = require('../core/services/infrastructure/auditService');

module.exports = async function (context, req) {
    context.log('Solicitud para resolver ticket recibida');

    // Validar Content-Length para prevenir DoS
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

        // Validar que se proporciono el ticketId
        if (!ticketId) {
            context.res = secureErrorResponse(400, 'El campo ticketId es requerido');
            return;
        }

        // Validar formato del ticketId (TKT + 13 digitos)
        const ticketValidation = security.validateTicketId(ticketId);
        if (!ticketValidation.valid) {
            context.res = secureErrorResponse(400, ticketValidation.error);
            return;
        }

        // Verificar que el ticket existe
        const reporte = await reporteRepository.getByTicket(ticketId);
        if (!reporte) {
            context.res = secureErrorResponse(404, `No se encontro el ticket: ${ticketId}`);
            return;
        }

        // Verificar que el ticket no este ya resuelto o cancelado
        if (reporte.Estado === ESTADO_REPORTE.RESUELTO) {
            context.res = secureErrorResponse(400, `El ticket ${ticketId} ya esta resuelto`, {
                ticketId,
                estadoActual: reporte.Estado
            });
            return;
        }

        if (reporte.Estado === ESTADO_REPORTE.CANCELADO) {
            context.res = secureErrorResponse(400, `El ticket ${ticketId} esta cancelado y no puede ser resuelto`, {
                ticketId,
                estadoActual: reporte.Estado
            });
            return;
        }

        // Actualizar el estado a RESUELTO y guardar FechaResolucion
        // Esto habilita el envio de encuestas de satisfaccion
        const updated = await reporteRepository.resolverReporte(ticketId);

        if (!updated) {
            context.res = secureErrorResponse(500, `No se pudo actualizar el ticket: ${ticketId}`);
            return;
        }

        context.log(`Ticket ${ticketId} marcado como RESUELTO`);

        // Audit log para ticket resuelto
        audit.logTicketResolved(ticketId, reporte.Estado, req);

        context.res = secureSuccessResponse(200, {
            success: true,
            message: `Ticket ${ticketId} marcado como resuelto exitosamente`,
            ticketId,
            estadoAnterior: reporte.Estado,
            estadoNuevo: ESTADO_REPORTE.RESUELTO,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        context.log.error('Error al resolver ticket:', error);
        // No exponer detalles del error interno en produccion
        const errorMessage = process.env.NODE_ENV === 'development'
            ? error.message
            : 'Error interno del servidor';
        context.res = secureErrorResponse(500, errorMessage);
    }
};
