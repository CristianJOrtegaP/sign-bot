/**
 * AC FIXBOT - Rate Limiter Inteligente
 * Previene spam, protege APIs externas y deduplica mensajes
 */

const metrics = require('./metricsService');
const config = require('../../config');

// Registro de solicitudes por usuario
const userRequests = new Map();

// Deduplicación: messageIds procesados recientemente (TTL: 30 minutos)
// Nota: Este caché es por instancia de Azure Function, no se comparte entre instancias
const processedMessageIds = new Map();
const MESSAGE_ID_TTL = 30 * 60 * 1000; // 30 minutos (aumentado para cubrir reintentos tardíos)

// Configuración de límites desde config centralizado
const LIMITS = {
    messages: {
        maxPerMinute: config.rateLimiting.messages.maxPerMinute,
        maxPerHour: config.rateLimiting.messages.maxPerHour,
        windowMinute: config.rateLimiting.messages.windowMinuteMs,
        windowHour: config.rateLimiting.messages.windowHourMs
    },
    images: {
        maxPerMinute: config.rateLimiting.images.maxPerMinute,
        maxPerHour: config.rateLimiting.images.maxPerHour,
        windowMinute: config.rateLimiting.images.windowMinuteMs,
        windowHour: config.rateLimiting.images.windowHourMs
    },
    audios: {
        maxPerMinute: config.rateLimiting.audios.maxPerMinute,
        maxPerHour: config.rateLimiting.audios.maxPerHour,
        windowMinute: config.rateLimiting.audios.windowMinuteMs,
        windowHour: config.rateLimiting.audios.windowHourMs
    }
};

/**
 * Limpia entradas antiguas del registro de solicitudes
 */
function cleanOldEntries() {
    const now = Date.now();
    const oneHourAgo = now - LIMITS.messages.windowHour;

    for (const [userId, data] of userRequests.entries()) {
        // Limpiar mensajes antiguos (más de 1 hora)
        data.messages = data.messages.filter(timestamp => timestamp > oneHourAgo);
        data.images = data.images.filter(timestamp => timestamp > oneHourAgo);
        data.audios = (data.audios || []).filter(timestamp => timestamp > oneHourAgo);

        // Si el usuario no tiene actividad reciente, eliminar entrada
        if (data.messages.length === 0 && data.images.length === 0 && (data.audios || []).length === 0) {
            userRequests.delete(userId);
        }
    }

    // Limpiar messageIds expirados
    const messageIdExpiry = now - MESSAGE_ID_TTL;
    for (const [messageId, timestamp] of processedMessageIds.entries()) {
        if (timestamp < messageIdExpiry) {
            processedMessageIds.delete(messageId);
        }
    }
}

/**
 * Verifica si un mensaje ya fue procesado (deduplicación)
 * @param {string} messageId - ID único del mensaje de WhatsApp
 * @returns {boolean} - true si es duplicado (ya fue procesado)
 */
function isDuplicateMessage(messageId) {
    if (!messageId) {return false;}

    if (processedMessageIds.has(messageId)) {
        metrics.recordError('duplicate_message', messageId);
        return true;
    }

    // Registrar este messageId como procesado
    processedMessageIds.set(messageId, Date.now());
    return false;
}

// Limpiar periódicamente
// .unref() permite que el proceso termine sin esperar este timer
setInterval(cleanOldEntries, config.rateLimiting.cleanupIntervalMs).unref();

/**
 * Obtiene o crea el registro de un usuario
 */
function getUserRecord(userId) {
    if (!userRequests.has(userId)) {
        userRequests.set(userId, {
            messages: [],
            images: [],
            audios: [],
            warnings: 0
        });
    }
    // Asegurar que audios existe (para registros existentes)
    const record = userRequests.get(userId);
    if (!record.audios) {
        record.audios = [];
    }
    return record;
}

/**
 * Verifica si un usuario puede enviar un mensaje
 * @param {string} userId - Identificador del usuario
 * @param {string} type - Tipo de solicitud ('message', 'image' o 'audio')
 * @returns {Object} - { allowed: boolean, reason: string, waitTime: number }
 */
function checkRateLimit(userId, type = 'message') {
    const now = Date.now();
    const record = getUserRecord(userId);

    // Determinar qué límites y array usar según el tipo
    let requests, limits, typeLabel;
    if (type === 'image') {
        requests = record.images;
        limits = LIMITS.images;
        typeLabel = 'imágenes';
    } else if (type === 'audio') {
        requests = record.audios;
        limits = LIMITS.audios;
        typeLabel = 'audios';
    } else {
        requests = record.messages;
        limits = LIMITS.messages;
        typeLabel = 'mensajes';
    }

    // Contar solicitudes en la última hora
    const oneHourAgo = now - limits.windowHour;
    const requestsLastHour = requests.filter(timestamp => timestamp > oneHourAgo).length;

    // Contar solicitudes en el último minuto
    const oneMinuteAgo = now - limits.windowMinute;
    const requestsLastMinute = requests.filter(timestamp => timestamp > oneMinuteAgo).length;

    // Verificar límite por minuto
    if (requestsLastMinute >= limits.maxPerMinute) {
        const oldestInWindow = requests.filter(t => t > oneMinuteAgo).sort()[0];
        const waitTime = Math.ceil((oldestInWindow + limits.windowMinute - now) / 1000);

        metrics.recordError('rate_limit_exceeded', `${userId} - ${type} - per minute`);

        return {
            allowed: false,
            reason: `Has alcanzado el límite de ${limits.maxPerMinute} ${typeLabel} por minuto. Por favor espera ${waitTime} segundos.`,
            waitTime
        };
    }

    // Verificar límite por hora
    if (requestsLastHour >= limits.maxPerHour) {
        const oldestInWindow = requests.filter(t => t > oneHourAgo).sort()[0];
        const waitTime = Math.ceil((oldestInWindow + limits.windowHour - now) / 1000);

        metrics.recordError('rate_limit_exceeded', `${userId} - ${type} - per hour`);

        return {
            allowed: false,
            reason: `Has alcanzado el límite de ${limits.maxPerHour} ${typeLabel} por hora. Por favor espera ${Math.ceil(waitTime / 60)} minutos.`,
            waitTime
        };
    }

    // Permitir solicitud
    return { allowed: true };
}

/**
 * Registra una solicitud exitosa
 */
function recordRequest(userId, type = 'message') {
    const record = getUserRecord(userId);
    const now = Date.now();

    if (type === 'image') {
        record.images.push(now);
    } else if (type === 'audio') {
        record.audios.push(now);
    } else {
        record.messages.push(now);
    }
}

/**
 * Obtiene estadísticas de uso de un usuario
 */
function getUserStats(userId) {
    const record = getUserRecord(userId);
    const now = Date.now();
    const oneMinuteAgo = now - LIMITS.messages.windowMinute;
    const oneHourAgo = now - LIMITS.messages.windowHour;

    return {
        messages: {
            lastMinute: record.messages.filter(t => t > oneMinuteAgo).length,
            lastHour: record.messages.filter(t => t > oneHourAgo).length,
            maxPerMinute: LIMITS.messages.maxPerMinute,
            maxPerHour: LIMITS.messages.maxPerHour
        },
        images: {
            lastMinute: record.images.filter(t => t > oneMinuteAgo).length,
            lastHour: record.images.filter(t => t > oneHourAgo).length,
            maxPerMinute: LIMITS.images.maxPerMinute,
            maxPerHour: LIMITS.images.maxPerHour
        },
        audios: {
            lastMinute: record.audios.filter(t => t > oneMinuteAgo).length,
            lastHour: record.audios.filter(t => t > oneHourAgo).length,
            maxPerMinute: LIMITS.audios.maxPerMinute,
            maxPerHour: LIMITS.audios.maxPerHour
        }
    };
}

/**
 * Verifica si un usuario está haciendo spam excesivo
 * (más estricto que el rate limit normal)
 */
function isSpamming(userId) {
    const record = getUserRecord(userId);
    const now = Date.now();
    const spamWindowStart = now - config.rateLimiting.spam.windowMs;

    // Si envía más de N mensajes en la ventana de tiempo, probablemente es spam
    const recentMessages = record.messages.filter(t => t > spamWindowStart).length;
    return recentMessages > config.rateLimiting.spam.maxMessagesInWindow;
}

/**
 * Limpia todo el estado del rate limiter (solo para tests)
 */
function clearState() {
    userRequests.clear();
    processedMessageIds.clear();
}

module.exports = {
    checkRateLimit,
    recordRequest,
    getUserStats,
    isSpamming,
    isDuplicateMessage,
    clearState
};
