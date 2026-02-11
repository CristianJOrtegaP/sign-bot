/**
 * Sign Bot - API Response Utilities
 * Utilidades para respuestas HTTP estandarizadas
 *
 * @module utils/apiResponse
 */

const { applySecurityHeaders } = require('../middleware/securityHeaders');

/**
 * Códigos de error estándar de la aplicación
 */
const ErrorCodes = {
  // Errores de validación (400)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_FIELD: 'MISSING_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',

  // Errores de autenticación (401)
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  EXPIRED_TOKEN: 'EXPIRED_TOKEN',

  // Errores de autorización (403)
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',

  // Errores de recursos (404)
  NOT_FOUND: 'NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',

  // Errores de conflicto (409)
  CONFLICT: 'CONFLICT',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',

  // Errores de rate limiting (429)
  RATE_LIMITED: 'RATE_LIMITED',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',

  // Errores de servidor (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',

  // Errores de servicio no disponible (503)
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  MAINTENANCE_MODE: 'MAINTENANCE_MODE',
};

/**
 * Crea una respuesta exitosa estandarizada
 * @param {Object} data - Datos a incluir en la respuesta
 * @param {Object} options - Opciones adicionales
 * @returns {Object} - Objeto de respuesta para Azure Functions
 */
function success(data = {}, options = {}) {
  const { status = 200, message = null, meta = null, headers = {} } = options;

  const body = {
    success: true,
    ...(message && { message }),
    data,
    ...(meta && { meta }),
    timestamp: new Date().toISOString(),
  };

  return {
    status,
    headers: applySecurityHeaders({
      'Content-Type': 'application/json',
      ...headers,
    }),
    body,
  };
}

/**
 * Crea una respuesta de error estandarizada
 * @param {string} message - Mensaje de error para el usuario
 * @param {Object} options - Opciones adicionales
 * @returns {Object} - Objeto de respuesta para Azure Functions
 */
function error(message, options = {}) {
  const {
    status = 500,
    code = ErrorCodes.INTERNAL_ERROR,
    details = null,
    headers = {},
    correlationId = null,
  } = options;

  const body = {
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
    },
    ...(correlationId && { correlationId }),
    timestamp: new Date().toISOString(),
  };

  return {
    status,
    headers: applySecurityHeaders({
      'Content-Type': 'application/json',
      ...headers,
    }),
    body,
  };
}

/**
 * Respuesta de validación fallida (400)
 * @param {string} message - Mensaje de error
 * @param {Object} validationErrors - Errores de validación por campo
 * @returns {Object}
 */
function validationError(message, validationErrors = null) {
  return error(message, {
    status: 400,
    code: ErrorCodes.VALIDATION_ERROR,
    details: validationErrors,
  });
}

/**
 * Respuesta de no autorizado (401)
 * @param {string} message - Mensaje de error
 * @returns {Object}
 */
function unauthorized(message = 'Autenticación requerida') {
  return error(message, {
    status: 401,
    code: ErrorCodes.UNAUTHORIZED,
  });
}

/**
 * Respuesta de prohibido (403)
 * @param {string} message - Mensaje de error
 * @returns {Object}
 */
function forbidden(message = 'No tienes permisos para esta operación') {
  return error(message, {
    status: 403,
    code: ErrorCodes.FORBIDDEN,
  });
}

/**
 * Respuesta de no encontrado (404)
 * @param {string} resource - Nombre del recurso no encontrado
 * @returns {Object}
 */
function notFound(resource = 'Recurso') {
  return error(`${resource} no encontrado`, {
    status: 404,
    code: ErrorCodes.NOT_FOUND,
  });
}

/**
 * Respuesta de rate limiting (429)
 * @param {number} retryAfter - Segundos para reintentar
 * @returns {Object}
 */
function rateLimited(retryAfter = 60) {
  return error('Demasiadas solicitudes. Por favor espera antes de reintentar.', {
    status: 429,
    code: ErrorCodes.RATE_LIMITED,
    headers: {
      'Retry-After': retryAfter.toString(),
    },
    details: { retryAfter },
  });
}

/**
 * Respuesta de error interno (500)
 * @param {string} message - Mensaje de error
 * @param {string} correlationId - ID de correlación para soporte
 * @returns {Object}
 */
function internalError(message = 'Error interno del servidor', correlationId = null) {
  return error(message, {
    status: 500,
    code: ErrorCodes.INTERNAL_ERROR,
    correlationId,
  });
}

/**
 * Respuesta de servicio no disponible (503)
 * @param {string} message - Mensaje de error
 * @param {number} retryAfter - Segundos para reintentar
 * @returns {Object}
 */
function serviceUnavailable(message = 'Servicio temporalmente no disponible', retryAfter = 300) {
  return error(message, {
    status: 503,
    code: ErrorCodes.SERVICE_UNAVAILABLE,
    headers: {
      'Retry-After': retryAfter.toString(),
    },
  });
}

/**
 * Convierte un error de la aplicación a una respuesta HTTP apropiada
 * @param {Error} err - Error a convertir
 * @param {string} correlationId - ID de correlación
 * @returns {Object}
 */
function fromError(err, correlationId = null) {
  // Importar clases de error
  const {
    ValidationError,
    RateLimitError,
    EquipoNotFoundError,
    DatabaseError,
    ExternalServiceError,
  } = require('../services/infrastructure/errorHandler');

  if (err instanceof ValidationError) {
    return validationError(err.message);
  }

  if (err instanceof RateLimitError) {
    return rateLimited(err.retryAfter || 60);
  }

  if (err instanceof EquipoNotFoundError) {
    return notFound('Equipo');
  }

  if (err instanceof DatabaseError) {
    return error('Error de base de datos', {
      status: 503,
      code: ErrorCodes.DATABASE_ERROR,
      correlationId,
    });
  }

  if (err instanceof ExternalServiceError) {
    return error('Error en servicio externo', {
      status: 502,
      code: ErrorCodes.EXTERNAL_SERVICE_ERROR,
      correlationId,
    });
  }

  // Error genérico
  return internalError(
    process.env.NODE_ENV === 'production' ? 'Error interno del servidor' : err.message,
    correlationId
  );
}

/**
 * Crea una respuesta con paginación
 * @param {Array} items - Items de la página actual
 * @param {Object} pagination - Información de paginación
 * @returns {Object}
 */
function paginated(items, pagination) {
  const { page, pageSize, total } = pagination;
  const totalPages = Math.ceil(total / pageSize);

  return success(items, {
    meta: {
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    },
  });
}

module.exports = {
  ErrorCodes,
  success,
  error,
  validationError,
  unauthorized,
  forbidden,
  notFound,
  rateLimited,
  internalError,
  serviceUnavailable,
  fromError,
  paginated,
};
