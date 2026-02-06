/**
 * AC FIXBOT - Middleware de Rate Limiting
 * Controla la frecuencia de mensajes por usuario y APIs
 */

const rateLimiter = require('../services/infrastructure/rateLimiter');

// ============================================
// RATE LIMITING POR IP (para APIs admin)
// ============================================

/**
 * Rate limiting por IP para APIs administrativas
 * @type {Map<string, {count: number, resetAt: number}>}
 */
const ipRateLimitMap = new Map();

const IP_RATE_LIMIT_CONFIG = {
  windowMs: 60 * 1000, // 1 minuto
  maxRequests: parseInt(process.env.ADMIN_RATE_LIMIT_MAX || '60', 10),
};

/**
 * Verifica rate limiting por IP
 * @param {string} ipAddress - Dirección IP del cliente
 * @returns {{allowed: boolean, remaining: number, resetIn: number}}
 */
function checkIpRateLimit(ipAddress) {
  const now = Date.now();
  const record = ipRateLimitMap.get(ipAddress);

  // Limpiar registros expirados periódicamente
  if (ipRateLimitMap.size > 1000) {
    for (const [key, val] of ipRateLimitMap.entries()) {
      if (now > val.resetAt) {
        ipRateLimitMap.delete(key);
      }
    }
  }

  if (!record || now > record.resetAt) {
    // Nuevo período
    ipRateLimitMap.set(ipAddress, {
      count: 1,
      resetAt: now + IP_RATE_LIMIT_CONFIG.windowMs,
    });
    return {
      allowed: true,
      remaining: IP_RATE_LIMIT_CONFIG.maxRequests - 1,
      resetIn: IP_RATE_LIMIT_CONFIG.windowMs,
    };
  }

  if (record.count >= IP_RATE_LIMIT_CONFIG.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: record.resetAt - now,
    };
  }

  record.count++;
  return {
    allowed: true,
    remaining: IP_RATE_LIMIT_CONFIG.maxRequests - record.count,
    resetIn: record.resetAt - now,
  };
}

// ============================================
// RATE LIMITING POR USUARIO (para WhatsApp)
// ============================================

/**
 * Verifica rate limit para un usuario
 * @param {string} telefono - Numero de telefono del usuario
 * @param {string} type - Tipo de solicitud ('message' o 'image')
 * @returns {Object} - { allowed: boolean, reason?: string, waitTime?: number }
 */
function checkRateLimit(telefono, type = 'message') {
  return rateLimiter.checkRateLimit(telefono, type);
}

/**
 * Registra una solicitud exitosa
 * @param {string} telefono - Numero de telefono del usuario
 * @param {string} type - Tipo de solicitud ('message' o 'image')
 */
function recordRequest(telefono, type = 'message') {
  rateLimiter.recordRequest(telefono, type);
}

/**
 * Verifica si un usuario esta haciendo spam
 * @param {string} telefono - Numero de telefono del usuario
 * @returns {boolean} - true si esta haciendo spam
 */
function isSpamming(telefono) {
  return rateLimiter.isSpamming(telefono);
}

/**
 * Obtiene estadisticas de uso de un usuario
 * @param {string} telefono - Numero de telefono del usuario
 * @returns {Object} - Estadisticas de uso
 */
function getUserStats(telefono) {
  return rateLimiter.getUserStats(telefono);
}

/**
 * Middleware completo de rate limiting
 * @param {string} telefono - Numero de telefono
 * @param {string} type - Tipo de solicitud
 * @returns {Object} - { allowed: boolean, isSpam: boolean, reason?: string }
 */
function checkUserLimits(telefono, type = 'message') {
  // Primero verificar spam
  if (isSpamming(telefono)) {
    return {
      allowed: false,
      isSpam: true,
      reason: 'Detectamos actividad inusual. Por favor espera un momento.',
    };
  }

  // Luego verificar rate limit normal
  const rateLimitResult = checkRateLimit(telefono, type);

  return {
    allowed: rateLimitResult.allowed,
    isSpam: false,
    reason: rateLimitResult.reason,
    waitTime: rateLimitResult.waitTime,
  };
}

module.exports = {
  // Por usuario (WhatsApp)
  checkRateLimit,
  recordRequest,
  isSpamming,
  getUserStats,
  checkUserLimits,
  // Por IP (APIs admin)
  checkIpRateLimit,
  IP_RATE_LIMIT_CONFIG,
};
