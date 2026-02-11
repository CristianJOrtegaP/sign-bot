/**
 * SIGN BOT - API Admin Consolidada
 * Endpoints administrativos unificados
 *
 * Rutas:
 * - GET/POST /api/admin/cache?type=...         - Gestion de cache
 * - GET      /api/admin/metrics                - Metricas en tiempo real
 * - GET      /api/admin/documents              - Listar documentos
 * - GET      /api/admin/documents/detail       - Detalle de documento
 * - GET      /api/admin/documents/stats        - Estadisticas de documentos
 * - POST     /api/admin/documents/void         - Anular documento
 *
 * Autenticacion: Azure Function Key (authLevel: "function")
 * - Azure valida automaticamente el parametro ?code=xxx o header x-functions-key
 * - Las keys se gestionan en Azure Portal > Function App > App Keys
 * Rate Limiting: 60 requests/minuto por IP
 */

const { applySecurityHeaders } = require('../core/middleware/securityHeaders');
const { checkIpRateLimit } = require('../core/middleware/rateLimitMiddleware');
const { logger } = require('../core/services/infrastructure/errorHandler');

// Handlers
const cacheHandler = require('./handlers/cache');
const metricsHandler = require('./handlers/metrics');
const documentsHandler = require('./handlers/documents');

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
  // AUTENTICACION: Azure Function Key (nativa)
  // Azure ya valido la key antes de llegar aqui
  // Si el request llego, la key es valida
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

    case 'documents':
      switch (subaction) {
        case 'void':
          return documentsHandler.voidDocument(context, req);
        case 'detail':
          return documentsHandler.detail(context, req);
        case 'stats':
          return documentsHandler.stats(context, req);
        default:
          // No subaction = list documents
          if (!subaction) {
            return documentsHandler.list(context, req);
          }
          context.res = {
            status: 400,
            headers: applySecurityHeaders({
              'Content-Type': 'application/json',
              ...rateLimitHeaders,
            }),
            body: {
              success: false,
              error: 'Subaccion no valida para documents',
              available: ['detail', 'stats', 'void'],
              examples: [
                'GET  /api/admin/documents',
                'GET  /api/admin/documents/detail?id=123',
                'GET  /api/admin/documents/stats',
                'POST /api/admin/documents/void',
              ],
            },
          };
          return;
      }

    default:
      context.res = {
        status: 400,
        headers: applySecurityHeaders({
          'Content-Type': 'application/json',
          ...rateLimitHeaders,
        }),
        body: {
          success: false,
          error: 'Accion no valida',
          available_actions: ['cache', 'metrics', 'documents'],
          examples: [
            'GET  /api/admin/cache?type=stats',
            'GET  /api/admin/metrics',
            'GET  /api/admin/documents',
            'GET  /api/admin/documents/detail?id=123',
            'GET  /api/admin/documents/stats',
            'POST /api/admin/documents/void',
          ],
        },
      };
  }
};
