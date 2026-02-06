/**
 * AC FIXBOT - Security Service
 * Manejo centralizado de seguridad: firmas, autenticacion, validacion
 */

const crypto = require('crypto');
const { logger } = require('./errorHandler');

/**
 * Verifica la firma X-Hub-Signature-256 de Meta/WhatsApp
 * @param {string} payload - Body raw del request
 * @param {string} signature - Header X-Hub-Signature-256
 * @returns {boolean} - true si la firma es valida
 */
function verifyWebhookSignature(payload, signature) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  // Si no hay secret configurado, solo permitir en desarrollo
  if (!appSecret) {
    const isProduction =
      process.env.NODE_ENV === 'production' ||
      process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Production';

    if (isProduction) {
      logger.error('CRÍTICO: WHATSAPP_APP_SECRET requerido en producción - rechazando request');
      return false;
    }

    logger.warn(
      'WHATSAPP_APP_SECRET no configurado - verificacion de firma deshabilitada (solo desarrollo)'
    );
    return true;
  }

  // Si no hay firma en el request, rechazar
  if (!signature) {
    logger.security('Request sin firma X-Hub-Signature-256');
    return false;
  }

  // Formato esperado: "sha256=<hash>"
  const expectedPrefix = 'sha256=';
  if (!signature.startsWith(expectedPrefix)) {
    logger.security('Formato de firma invalido');
    return false;
  }

  const receivedHash = signature.slice(expectedPrefix.length);

  // Calcular hash esperado
  const expectedHash = crypto.createHmac('sha256', appSecret).update(payload, 'utf8').digest('hex');

  // Comparacion segura contra timing attacks
  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(receivedHash, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );

    if (!isValid) {
      logger.security('Firma del webhook no coincide');
    }

    return isValid;
  } catch (error) {
    // Si los buffers tienen diferente longitud, timingSafeEqual lanza error
    logger.security('Error comparando firmas', { error: error.message });
    return false;
  }
}

/**
 * Valida formato de ticketId
 * Formato esperado: TKT-XXXXXXXX (8 caracteres hexadecimales)
 * @param {string} ticketId
 * @returns {{ valid: boolean, error?: string }}
 */
function validateTicketId(ticketId) {
  if (!ticketId || typeof ticketId !== 'string') {
    return { valid: false, error: 'ticketId debe ser una cadena de texto' };
  }

  // Formato: TKT- + 8 caracteres hex (generado por helpers.generateTicketNumber)
  const ticketPattern = /^TKT-[A-F0-9]{8}$/i;

  if (!ticketPattern.test(ticketId)) {
    return {
      valid: false,
      error: 'Formato de ticketId invalido. Formato esperado: TKT-XXXXXXXX (8 caracteres hex)',
    };
  }

  return { valid: true };
}

/**
 * Valida coordenadas de ubicacion
 * @param {object} location - { latitude, longitude }
 * @returns {{ valid: boolean, error?: string, sanitized?: object }}
 */
function validateLocation(location) {
  if (!location || typeof location !== 'object') {
    return { valid: false, error: 'Ubicacion debe ser un objeto' };
  }

  const { latitude, longitude } = location;

  // Validar que sean numeros
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);

  if (isNaN(lat) || isNaN(lng)) {
    return { valid: false, error: 'Latitud y longitud deben ser numeros' };
  }

  // Validar rangos validos
  if (lat < -90 || lat > 90) {
    return { valid: false, error: 'Latitud debe estar entre -90 y 90' };
  }

  if (lng < -180 || lng > 180) {
    return { valid: false, error: 'Longitud debe estar entre -180 y 180' };
  }

  // Retornar valores sanitizados (precision de 6 decimales)
  return {
    valid: true,
    sanitized: {
      latitude: Math.round(lat * 1000000) / 1000000,
      longitude: Math.round(lng * 1000000) / 1000000,
    },
  };
}

/**
 * Valida numero de telefono (formato E.164)
 * @param {string} phoneNumber
 * @returns {{ valid: boolean, error?: string, sanitized?: string }}
 */
function validatePhoneNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return { valid: false, error: 'Numero de telefono requerido' };
  }

  // Remover caracteres no numericos
  const cleaned = phoneNumber.replace(/\D/g, '');

  // Validar longitud (10-15 digitos para E.164)
  if (cleaned.length < 10 || cleaned.length > 15) {
    return { valid: false, error: 'Numero de telefono debe tener entre 10 y 15 digitos' };
  }

  return { valid: true, sanitized: cleaned };
}

/**
 * Rate limiter por IP para proteccion contra abuso
 * Incluye proteccion contra memory exhaustion con limite maximo de entries
 */
const ipRequestCounts = new Map();
const IP_RATE_LIMIT = parseInt(process.env.IP_RATE_LIMIT) || 100; // requests
const IP_RATE_WINDOW_MS = parseInt(process.env.IP_RATE_WINDOW_MS) || 60000; // 1 minuto
const IP_MAX_ENTRIES = 10000; // Maximo de IPs a trackear para prevenir memory exhaustion

/**
 * Verifica rate limit por IP
 * Incluye proteccion contra memory exhaustion
 * @param {string} ip - IP del cliente
 * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
 */
function checkIpRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - IP_RATE_WINDOW_MS;

  // Obtener o crear registro para esta IP
  let record = ipRequestCounts.get(ip);

  if (!record || record.windowStart < windowStart) {
    // Proteccion contra memory exhaustion: si hay demasiadas entries, limpiar antes de agregar
    if (ipRequestCounts.size >= IP_MAX_ENTRIES) {
      logger.warn(`Rate limiter alcanzó límite de ${IP_MAX_ENTRIES} IPs, ejecutando limpieza`);
      cleanupIpRateLimits();

      // Si aún está lleno después de limpiar, rechazar nuevas IPs
      if (ipRequestCounts.size >= IP_MAX_ENTRIES) {
        logger.warn('Rate limiter aún lleno después de limpieza, rechazando nueva IP');
        return { allowed: false, remaining: 0, resetMs: IP_RATE_WINDOW_MS };
      }
    }

    // Nueva ventana
    record = { count: 1, windowStart: now };
    ipRequestCounts.set(ip, record);
    return { allowed: true, remaining: IP_RATE_LIMIT - 1, resetMs: IP_RATE_WINDOW_MS };
  }

  // Incrementar contador
  record.count++;

  if (record.count > IP_RATE_LIMIT) {
    const resetMs = record.windowStart + IP_RATE_WINDOW_MS - now;
    return { allowed: false, remaining: 0, resetMs };
  }

  return {
    allowed: true,
    remaining: IP_RATE_LIMIT - record.count,
    resetMs: record.windowStart + IP_RATE_WINDOW_MS - now,
  };
}

/**
 * Limpia registros antiguos de rate limiting (llamar periodicamente)
 */
function cleanupIpRateLimits() {
  const now = Date.now();
  const windowStart = now - IP_RATE_WINDOW_MS;

  for (const [ip, record] of ipRequestCounts.entries()) {
    if (record.windowStart < windowStart) {
      ipRequestCounts.delete(ip);
    }
  }
}

// Limpiar cada minuto
// .unref() permite que el proceso termine sin esperar este timer
setInterval(cleanupIpRateLimits, 60000).unref();

/**
 * Obtiene la IP del cliente desde el request
 * @param {object} req - Request de Azure Functions
 * @returns {string}
 */
function getClientIp(req) {
  // Azure Functions / proxies ponen la IP real en estos headers
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.headers['client-ip'] ||
    'unknown'
  );
}

module.exports = {
  verifyWebhookSignature,
  validateTicketId,
  validateLocation,
  validatePhoneNumber,
  checkIpRateLimit,
  getClientIp,
  cleanupIpRateLimits,
};
