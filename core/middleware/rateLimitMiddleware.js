/**
 * AC FIXBOT - Middleware de Rate Limiting
 * Controla la frecuencia de mensajes por usuario
 */

const rateLimiter = require('../services/infrastructure/rateLimiter');

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
            reason: 'Detectamos actividad inusual. Por favor espera un momento.'
        };
    }

    // Luego verificar rate limit normal
    const rateLimitResult = checkRateLimit(telefono, type);

    return {
        allowed: rateLimitResult.allowed,
        isSpam: false,
        reason: rateLimitResult.reason,
        waitTime: rateLimitResult.waitTime
    };
}

module.exports = {
    checkRateLimit,
    recordRequest,
    isSpamming,
    getUserStats,
    checkUserLimits
};
