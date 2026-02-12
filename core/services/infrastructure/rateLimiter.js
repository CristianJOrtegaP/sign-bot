/**
 * Sign Bot - Rate Limiter Inteligente
 * Previene spam, protege APIs externas y deduplica mensajes
 * FASE 3: Soporte para rate limiting distribuido con Redis
 */

const metrics = require('./metricsService');
const config = require('../../config');

// Lazy load de Redis service para evitar dependencias circulares
let redisService = null;
function getRedisService() {
  if (redisService === null) {
    try {
      redisService = require('../cache/redisService');
    } catch {
      redisService = false; // Marcar como no disponible
    }
  }
  return redisService || null;
}

// Registro de solicitudes por usuario
const userRequests = new Map();

// Deduplicación: messageIds procesados recientemente (TTL: 30 minutos)
// Nota: Este caché es por instancia de Azure Function, no se comparte entre instancias
const processedMessageIds = new Map();
const MESSAGE_ID_TTL = 30 * 60 * 1000; // 30 minutos (aumentado para cubrir reintentos tardíos)

// Configuración de límites desde config centralizado
// Sign Bot solo maneja texto y botones interactivos (no images/audios)
const LIMITS = {
  messages: {
    maxPerMinute: config.rateLimiting.messages.maxPerMinute,
    maxPerHour: config.rateLimiting.messages.maxPerHour,
    windowMinute: config.rateLimiting.messages.windowMinuteMs,
    windowHour: config.rateLimiting.messages.windowHourMs,
  },
};

/**
 * Limpia entradas antiguas del registro de solicitudes
 */
function cleanOldEntries() {
  const now = Date.now();
  const oneHourAgo = now - LIMITS.messages.windowHour;

  for (const [userId, data] of userRequests.entries()) {
    data.messages = data.messages.filter((timestamp) => timestamp > oneHourAgo);

    if (data.messages.length === 0) {
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
  if (!messageId) {
    return false;
  }

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
      warnings: 0,
    });
  }
  return userRequests.get(userId);
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

  // Sign Bot solo maneja mensajes de texto y botones
  const requests = record.messages;
  const limits = LIMITS.messages;
  const typeLabel = 'mensajes';

  // Contar solicitudes en la última hora
  const oneHourAgo = now - limits.windowHour;
  const requestsLastHour = requests.filter((timestamp) => timestamp > oneHourAgo).length;

  // Contar solicitudes en el último minuto
  const oneMinuteAgo = now - limits.windowMinute;
  const requestsLastMinute = requests.filter((timestamp) => timestamp > oneMinuteAgo).length;

  // Verificar límite por minuto
  if (requestsLastMinute >= limits.maxPerMinute) {
    const oldestInWindow = requests.filter((t) => t > oneMinuteAgo).sort()[0];
    const waitTime = Math.ceil((oldestInWindow + limits.windowMinute - now) / 1000);

    metrics.recordError('rate_limit_exceeded', `${userId} - ${type} - per minute`);

    return {
      allowed: false,
      reason: `Has alcanzado el límite de ${limits.maxPerMinute} ${typeLabel} por minuto. Por favor espera ${waitTime} segundos.`,
      waitTime,
    };
  }

  // Verificar límite por hora
  if (requestsLastHour >= limits.maxPerHour) {
    const oldestInWindow = requests.filter((t) => t > oneHourAgo).sort()[0];
    const waitTime = Math.ceil((oldestInWindow + limits.windowHour - now) / 1000);

    metrics.recordError('rate_limit_exceeded', `${userId} - ${type} - per hour`);

    return {
      allowed: false,
      reason: `Has alcanzado el límite de ${limits.maxPerHour} ${typeLabel} por hora. Por favor espera ${Math.ceil(waitTime / 60)} minutos.`,
      waitTime,
    };
  }

  // Permitir solicitud
  return { allowed: true };
}

/**
 * Registra una solicitud exitosa
 */
function recordRequest(userId, _type = 'message') {
  const record = getUserRecord(userId);
  record.messages.push(Date.now());
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
      lastMinute: record.messages.filter((t) => t > oneMinuteAgo).length,
      lastHour: record.messages.filter((t) => t > oneHourAgo).length,
      maxPerMinute: LIMITS.messages.maxPerMinute,
      maxPerHour: LIMITS.messages.maxPerHour,
    },
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
  const recentMessages = record.messages.filter((t) => t > spamWindowStart).length;
  return recentMessages > config.rateLimiting.spam.maxMessagesInWindow;
}

/**
 * Limpia todo el estado del rate limiter (solo para tests)
 */
function clearState() {
  userRequests.clear();
  processedMessageIds.clear();
}

// ============================================================================
// FASE 3: RATE LIMITING DISTRIBUIDO CON REDIS
// ============================================================================

/**
 * Verifica rate limit usando Redis (distribuido) o memoria (local)
 * FASE 3: Escalabilidad para múltiples instancias de Azure Functions
 *
 * @param {string} userId - Identificador del usuario
 * @param {string} type - Tipo de solicitud ('message', 'image' o 'audio')
 * @returns {Promise<Object>} - { allowed: boolean, reason?: string, waitTime?: number }
 */
async function checkRateLimitDistributed(userId, type = 'message') {
  const redis = getRedisService();

  // Si Redis está habilitado y no está en modo fallback, usar rate limiting distribuido
  if (redis && typeof redis.isUsingFallback === 'function' && !redis.isUsingFallback()) {
    try {
      return await checkRateLimitRedis(userId, type);
    } catch (error) {
      // Si Redis falla, usar rate limiting local como fallback
      metrics.recordError('redis_rate_limit_error', error.message);
    }
  }

  // Fallback a rate limiting local
  return checkRateLimit(userId, type);
}

/**
 * Rate limiting con Redis usando sliding window
 * @private
 */
async function checkRateLimitRedis(userId, type) {
  const redis = getRedisService();
  const _now = Date.now();

  const limits = LIMITS.messages;
  const typeLabel = 'mensajes';

  const keyMinute = `ratelimit:${type}:${userId}:minute`;
  const keyHour = `ratelimit:${type}:${userId}:hour`;

  try {
    // Obtener contadores actuales
    const [minuteCount, hourCount] = await Promise.all([redis.get(keyMinute), redis.get(keyHour)]);

    const currentMinute = parseInt(minuteCount || '0', 10) + 1;
    const currentHour = parseInt(hourCount || '0', 10) + 1;

    // Verificar límite por minuto
    if (currentMinute > limits.maxPerMinute) {
      return {
        allowed: false,
        reason: `Has alcanzado el límite de ${limits.maxPerMinute} ${typeLabel} por minuto. Por favor espera unos segundos.`,
        waitTime: 60,
      };
    }

    // Verificar límite por hora
    if (currentHour > limits.maxPerHour) {
      return {
        allowed: false,
        reason: `Has alcanzado el límite de ${limits.maxPerHour} ${typeLabel} por hora. Por favor espera unos minutos.`,
        waitTime: 3600,
      };
    }

    // Incrementar contadores con TTL apropiado
    await Promise.all([
      redis.set(keyMinute, currentMinute.toString(), 60), // TTL 1 minuto
      redis.set(keyHour, currentHour.toString(), 3600), // TTL 1 hora
    ]);

    return { allowed: true };
  } catch (error) {
    // En caso de error, permitir la solicitud pero loguear
    metrics.recordError('redis_rate_limit_fallback', error.message);
    return { allowed: true };
  }
}

/**
 * Verifica si un mensaje ya fue procesado usando Redis (distribuido)
 * FASE 3: Deduplicación distribuida
 *
 * @param {string} messageId - ID único del mensaje de WhatsApp
 * @returns {Promise<boolean>} - true si es duplicado
 */
async function isDuplicateMessageDistributed(messageId) {
  if (!messageId) {
    return false;
  }

  const redis = getRedisService();

  // Si Redis está disponible, verificar deduplicación distribuida
  if (redis && typeof redis.isUsingFallback === 'function' && !redis.isUsingFallback()) {
    try {
      const key = `dedup:msg:${messageId}`;
      const exists = await redis.get(key);

      if (exists) {
        metrics.recordError('duplicate_message_redis', messageId);
        return true;
      }

      // Registrar el messageId con TTL de 30 minutos
      await redis.set(key, '1', MESSAGE_ID_TTL / 1000);
      return false;
    } catch (error) {
      // Fallback a verificación local
      metrics.recordError('redis_dedup_error', error.message);
    }
  }

  // Fallback a deduplicación local
  return isDuplicateMessage(messageId);
}

module.exports = {
  checkRateLimit,
  recordRequest,
  getUserStats,
  isSpamming,
  isDuplicateMessage,
  clearState,
  // FASE 3: Funciones distribuidas
  checkRateLimitDistributed,
  isDuplicateMessageDistributed,
};
