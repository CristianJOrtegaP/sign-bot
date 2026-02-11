/**
 * Sign Bot - Exportacion centralizada de middleware
 */

const deduplication = require('./deduplication');
const rateLimitMiddleware = require('./rateLimitMiddleware');
const securityHeaders = require('./securityHeaders');

module.exports = {
  // Deduplicacion
  ...deduplication,

  // Rate Limiting
  ...rateLimitMiddleware,

  // Security Headers
  ...securityHeaders,
};
