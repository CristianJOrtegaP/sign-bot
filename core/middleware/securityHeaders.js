/**
 * Sign Bot - Security Headers Middleware
 * Agrega headers de seguridad a todas las respuestas HTTP
 * Incluye validacion de Content-Length y CORS
 */

const { logger } = require('../services/infrastructure/errorHandler');

/**
 * Limite de tamaño de Content-Length para prevenir DoS
 * @constant {number}
 */
const MAX_CONTENT_LENGTH = 10 * 1024 * 1024; // 10MB

/**
 * Origenes permitidos para CORS (configurable via env)
 * @constant {string[]}
 */
const ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['https://graph.facebook.com']; // WhatsApp webhook por defecto

/**
 * Headers de seguridad estandar (similar a Helmet.js)
 */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

/**
 * Aplica headers de seguridad a la respuesta
 * @param {Object} context - Contexto de Azure Functions
 * @returns {Object} - Headers combinados con los de seguridad
 */
function applySecurityHeaders(existingHeaders = {}) {
  return {
    ...SECURITY_HEADERS,
    ...existingHeaders,
  };
}

/**
 * Valida que el Content-Type del request sea el esperado
 * @param {Object} req - Request de Azure Functions
 * @param {string[]} allowedTypes - Content-Types permitidos
 * @returns {{ valid: boolean, error?: string }}
 */
function validateContentType(req, allowedTypes = ['application/json']) {
  // GET requests no necesitan Content-Type
  if (req.method === 'GET') {
    return { valid: true };
  }

  const contentType = req.headers['content-type'] || '';

  // Verificar si el Content-Type coincide con alguno permitido
  const isValid = allowedTypes.some((allowed) =>
    contentType.toLowerCase().includes(allowed.toLowerCase())
  );

  if (!isValid && req.body) {
    logger.security('Content-Type invalido en request', {
      received: contentType,
      expected: allowedTypes.join(' | '),
      method: req.method,
    });
    return {
      valid: false,
      error: `Content-Type invalido. Esperado: ${allowedTypes.join(' | ')}`,
    };
  }

  return { valid: true };
}

/**
 * Valida el Content-Length del request para prevenir DoS
 * @param {Object} req - Request de Azure Functions
 * @param {number} maxLength - Tamaño máximo permitido en bytes (default: 10MB)
 * @returns {{ valid: boolean, error?: string }}
 */
function validateContentLength(req, maxLength = MAX_CONTENT_LENGTH) {
  // GET/HEAD requests no necesitan validación de Content-Length
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return { valid: true };
  }

  const contentLength = parseInt(req.headers['content-length'], 10);

  // Si no hay Content-Length pero hay body, usar el tamaño del body
  if (isNaN(contentLength)) {
    if (req.body && typeof req.body === 'string' && req.body.length > maxLength) {
      logger.security('Request body excede tamaño máximo (sin Content-Length)', {
        bodySize: req.body.length,
        maxLength,
      });
      return {
        valid: false,
        error: `Request body excede tamaño máximo de ${Math.round(maxLength / 1024 / 1024)}MB`,
      };
    }
    return { valid: true };
  }

  if (contentLength > maxLength) {
    logger.security('Content-Length excede tamaño máximo', {
      contentLength,
      maxLength,
    });
    return {
      valid: false,
      error: `Content-Length excede tamaño máximo de ${Math.round(maxLength / 1024 / 1024)}MB`,
    };
  }

  return { valid: true };
}

/**
 * Genera headers CORS basados en el origin del request
 * @param {Object} req - Request de Azure Functions
 * @returns {Object} - Headers CORS a agregar a la respuesta
 */
function getCorsHeaders(req) {
  const origin = req.headers['origin'];
  const headers = {};

  // Si no hay origin, no agregar CORS headers
  if (!origin) {
    return headers;
  }

  // Verificar si el origin está permitido
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*');

  if (isAllowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] =
      'Content-Type, X-Hub-Signature-256, x-functions-key, X-API-Key';
    headers['Access-Control-Max-Age'] = '86400'; // 24 horas
  } else {
    logger.security('Origin no permitido en CORS', { origin, allowed: ALLOWED_ORIGINS });
  }

  return headers;
}

/**
 * Crea una respuesta de error con headers de seguridad
 * @param {number} status - Codigo de estado HTTP
 * @param {string} error - Mensaje de error
 * @param {Object} extraData - Datos adicionales
 * @returns {Object} - Objeto de respuesta para Azure Functions
 */
function secureErrorResponse(status, error, extraData = {}) {
  return {
    status,
    headers: applySecurityHeaders({ 'Content-Type': 'application/json' }),
    body: {
      success: false,
      error,
      timestamp: new Date().toISOString(),
      ...extraData,
    },
  };
}

/**
 * Crea una respuesta exitosa con headers de seguridad
 * @param {number} status - Codigo de estado HTTP
 * @param {Object} body - Cuerpo de la respuesta
 * @param {Object} extraHeaders - Headers adicionales
 * @returns {Object} - Objeto de respuesta para Azure Functions
 */
function secureSuccessResponse(status, body, extraHeaders = {}) {
  return {
    status,
    headers: applySecurityHeaders({
      'Content-Type': 'application/json',
      ...extraHeaders,
    }),
    body,
  };
}

module.exports = {
  SECURITY_HEADERS,
  MAX_CONTENT_LENGTH,
  ALLOWED_ORIGINS,
  applySecurityHeaders,
  validateContentType,
  validateContentLength,
  getCorsHeaders,
  secureErrorResponse,
  secureSuccessResponse,
};
