/**
 * AC FIXBOT - API Admin Consolidada
 * Endpoints administrativos unificados
 *
 * Rutas:
 * - GET/POST /api/admin/cache?type=...     - Gestión de caché
 * - GET      /api/admin/metrics            - Métricas en tiempo real
 * - POST     /api/admin/tickets/resolve    - Resolver tickets
 *
 * Autenticación: Requiere header X-API-Key o query param apiKey
 */

const { applySecurityHeaders } = require('../core/middleware/securityHeaders');

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
        'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
        'Access-Control-Max-Age': '86400',
      }),
    };
    return;
  }

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
        headers: applySecurityHeaders({ 'Content-Type': 'application/json' }),
        body: {
          error: 'Subacción no válida para tickets',
          available: ['resolve'],
          example: 'POST /api/admin/tickets/resolve',
        },
      };
      return;

    default:
      context.res = {
        status: 400,
        headers: applySecurityHeaders({ 'Content-Type': 'application/json' }),
        body: {
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
