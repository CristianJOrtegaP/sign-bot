/**
 * AC FIXBOT - Schema de Validacion para API de Resolver Tickets
 */

const { z } = require('zod');

// Schema para el payload de resolver ticket
const ticketResolveSchema = z.object({
    ticketId: z.string()
        .min(1, 'ticketId es requerido')
        .regex(/^TKT\d+$/, 'ticketId debe tener formato TKT seguido de numeros')
});

/**
 * Valida el payload de resolver ticket
 * @param {Object} payload - Payload a validar
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
function validateTicketResolvePayload(payload) {
    try {
        const result = ticketResolveSchema.parse(payload);
        return { success: true, data: result };
    } catch (error) {
        const errorMessage = error.errors?.map(e => e.message).join(', ') || 'Invalid payload';
        return {
            success: false,
            error: errorMessage
        };
    }
}

module.exports = {
    ticketResolveSchema,
    validateTicketResolvePayload
};
