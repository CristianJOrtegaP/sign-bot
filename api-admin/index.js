/**
 * AC FIXBOT - API Admin Consolidada
 * Endpoints administrativos unificados
 *
 * Rutas:
 * - GET/POST /api/admin/cache?type=...     - Gestión de caché
 * - GET      /api/admin/metrics            - Métricas en tiempo real
 * - POST     /api/admin/tickets/resolve    - Resolver tickets
 *
 * Autenticación: Azure Function Key (authLevel: "function")
 * - Azure valida automáticamente el parámetro ?code=xxx o header x-functions-key
 * - Las keys se gestionan en Azure Portal > Function App > App Keys
 * Rate Limiting: 60 requests/minuto por IP
 */

const { applySecurityHeaders } = require('../core/middleware/securityHeaders');
const { checkIpRateLimit } = require('../core/middleware/rateLimitMiddleware');
const { logger } = require('../core/services/infrastructure/errorHandler');

// Handlers
const cacheHandler = require('./handlers/cache');
const metricsHandler = require('./handlers/metrics');
const ticketsHandler = require('./handlers/tickets');

module.exports = async function (context, req) {
  const action = context.bindingData.action?.toLowerCase();
  const subaction = context.bindingData.subaction?.toLowerCase();

  context.log(`Admin API: /${action}${subaction ? `/${subaction}` : ''}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: applySecurityHeaders({
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-functions-key',
        'Access-Control-Max-Age': '86400',
      }),
    };
    return;
  }

  // ============================================
  // AUTENTICACIÓN: Azure Function Key (nativa)
  // Azure ya validó la key antes de llegar aquí
  // Si el request llegó, la key es válida
  // ============================================

  // Rate limiting por IP (la key ya fue validada por Azure)
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  const rateLimit = checkIpRateLimit(clientIp);

  if (!rateLimit.allowed) {
    logger.warn('[Admin API] Rate limit excedido', { ip: clientIp });
    context.res = {
      status: 429,
      headers: applySecurityHeaders({
        'Content-Type': 'application/json',
        'Retry-After': Math.ceil(rateLimit.resetIn / 1000).toString(),
      }),
      body: {
        success: false,
        error: 'Demasiadas solicitudes. Espera antes de reintentar.',
        retryAfter: Math.ceil(rateLimit.resetIn / 1000),
      },
    };
    return;
  }

  const rateLimitHeaders = {
    'X-RateLimit-Remaining': rateLimit.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(rateLimit.resetIn / 1000).toString(),
  };

  logger.debug('[Admin API] Request procesado', { action, subaction, ip: clientIp });

  // Pasar rate limit headers al contexto para handlers
  context.rateLimitHeaders = rateLimitHeaders;

  // Router
  switch (action) {
    case 'cache':
      return cacheHandler(context, req);

    case 'metrics':
      return metricsHandler(context, req);

    case 'tickets':
      if (subaction === 'resolve') {
        return ticketsHandler.resolve(context, req);
      }
      context.res = {
        status: 400,
        headers: applySecurityHeaders({
          'Content-Type': 'application/json',
          ...rateLimitHeaders,
        }),
        body: {
          success: false,
          error: 'Subacción no válida para tickets',
          available: ['resolve'],
          example: 'POST /api/admin/tickets/resolve',
        },
      };
      return;

    default:
      context.res = {
        status: 400,
        headers: applySecurityHeaders({
          'Content-Type': 'application/json',
          ...rateLimitHeaders,
        }),
        body: {
          success: false,
          error: 'Acción no válida',
          available_actions: ['cache', 'metrics', 'tickets'],
          examples: [
            'GET  /api/admin/cache?type=stats',
            'GET  /api/admin/metrics',
            'POST /api/admin/tickets/resolve',
          ],
        },
      };
  }
};
