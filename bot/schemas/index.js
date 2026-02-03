/**
 * AC FIXBOT - Exportacion centralizada de schemas
 */

const webhookPayload = require('./webhookPayload');
const ticketResolvePayload = require('./ticketResolvePayload');
const reportePayload = require('./reportePayload');

module.exports = {
    // Webhook de WhatsApp
    ...webhookPayload,

    // API de resolver tickets
    ...ticketResolvePayload,

    // Reportes
    ...reportePayload
};
