/**
 * AC FIXBOT - Exportacion centralizada de middleware
 */

const deduplication = require('./deduplication');
const rateLimitMiddleware = require('./rateLimitMiddleware');
const sanitization = require('./sanitization');
const securityHeaders = require('./securityHeaders');

module.exports = {
    // Deduplicacion
    ...deduplication,

    // Rate Limiting
    ...rateLimitMiddleware,

    // Sanitizacion
    ...sanitization,

    // Security Headers
    ...securityHeaders
};
