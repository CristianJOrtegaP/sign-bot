/**
 * AC FIXBOT - Sanitization Utilities
 * Funciones para sanitizar inputs y prevenir inyecciones
 *
 * @module utils/sanitization
 */

/**
 * Patrones de secretos conocidos para redacción
 */
const SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey)[=:\s]*['"]?([a-zA-Z0-9_-]{16,})['"]?/gi,
  /(?:password|passwd|pwd)[=:\s]*['"]?([^\s'"]{8,})['"]?/gi,
  /(?:token|bearer)[=:\s]*['"]?([a-zA-Z0-9_.-]{20,})['"]?/gi,
  /(?:secret|private[_-]?key)[=:\s]*['"]?([a-zA-Z0-9_+/=-]{16,})['"]?/gi,
  /(?:connection[_-]?string)[=:\s]*['"]?([^'"]{20,})['"]?/gi,
  /Bearer\s+([a-zA-Z0-9_.-]{20,})/gi,
  /Basic\s+([a-zA-Z0-9+/=]{10,})/gi,
  // Azure connection strings
  /AccountKey=([a-zA-Z0-9+/=]{40,})/gi,
  /SharedAccessKey=([a-zA-Z0-9+/=]{40,})/gi,
  // SQL connection strings
  /Password=([^;]+)/gi,
  /Pwd=([^;]+)/gi,
];

/**
 * Lista de campos sensibles que deben ser redactados
 */
const SENSITIVE_FIELDS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'apikey',
  'authorization',
  'auth',
  'credentials',
  'connectionString',
  'connection_string',
  'accountKey',
  'account_key',
  'privateKey',
  'private_key',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
];

/**
 * Redacta secretos de una cadena de texto
 * @param {string} text - Texto a sanitizar
 * @returns {string} - Texto con secretos redactados
 */
function redactSecrets(text) {
  if (typeof text !== 'string') {
    return text;
  }

  let redacted = text;

  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match, secret) => {
      if (secret && secret.length > 4) {
        return match.replace(secret, `${secret.substring(0, 4)}***REDACTED***`);
      }
      return '***REDACTED***';
    });
  }

  return redacted;
}

/**
 * Redacta campos sensibles de un objeto (recursivo)
 * @param {Object} obj - Objeto a sanitizar
 * @param {number} depth - Profundidad máxima de recursión (default: 5)
 * @returns {Object} - Objeto con campos sensibles redactados
 */
function redactSensitiveFields(obj, depth = 5) {
  if (depth <= 0 || obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveFields(item, depth - 1));
  }

  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    // Verificar si es un campo sensible
    const isSensitive = SENSITIVE_FIELDS.some((field) => lowerKey.includes(field.toLowerCase()));

    if (isSensitive) {
      if (typeof value === 'string' && value.length > 4) {
        result[key] = `${value.substring(0, 4)}***REDACTED***`;
      } else {
        result[key] = '***REDACTED***';
      }
    } else if (typeof value === 'string') {
      result[key] = redactSecrets(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitiveFields(value, depth - 1);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Sanitiza un string para prevenir SQL injection
 * NOTA: Siempre usar queries parametrizadas. Esta función es una capa adicional.
 * @param {string} input - Input a sanitizar
 * @param {Object} options - Opciones de sanitización
 * @returns {string} - Input sanitizado
 */
function sanitizeForSQL(input, options = {}) {
  if (typeof input !== 'string') {
    return input;
  }

  const {
    maxLength = 1000,
    allowNumbers = true,
    allowLetters = true,
    allowSpaces = true,
    extraChars = '',
  } = options;

  // Truncar a longitud máxima
  let sanitized = input.substring(0, maxLength);

  // Construir patrón de caracteres permitidos
  let allowedPattern = '';
  if (allowLetters) {
    allowedPattern += 'a-zA-ZáéíóúñÁÉÍÓÚÑ';
  }
  if (allowNumbers) {
    allowedPattern += '0-9';
  }
  if (allowSpaces) {
    allowedPattern += '\\s';
  }
  if (extraChars) {
    allowedPattern += extraChars.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&');
  }

  // Remover caracteres no permitidos
  const regex = new RegExp(`[^${allowedPattern}]`, 'g');
  sanitized = sanitized.replace(regex, '');

  return sanitized;
}

/**
 * Valida y sanitiza un número de teléfono
 * @param {string} phone - Número de teléfono
 * @returns {{valid: boolean, sanitized?: string, error?: string}}
 */
function sanitizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, error: 'Teléfono requerido' };
  }

  // Remover todo excepto dígitos
  const digitsOnly = phone.replace(/\D/g, '');

  // Validar longitud (10-15 dígitos para números internacionales)
  if (digitsOnly.length < 10 || digitsOnly.length > 15) {
    return {
      valid: false,
      error: `Longitud inválida: ${digitsOnly.length} dígitos (esperado 10-15)`,
    };
  }

  return { valid: true, sanitized: digitsOnly };
}

/**
 * Sanitiza un ID de mensaje de WhatsApp
 * @param {string} messageId - ID del mensaje
 * @returns {{valid: boolean, sanitized?: string, error?: string}}
 */
function sanitizeMessageId(messageId) {
  if (!messageId || typeof messageId !== 'string') {
    return { valid: false, error: 'Message ID requerido' };
  }

  // WhatsApp message IDs: wamid.xxx o similar
  const sanitized = messageId.replace(/[^a-zA-Z0-9_\-.=]/g, '').substring(0, 100);

  if (sanitized.length < 10) {
    return { valid: false, error: 'Message ID muy corto' };
  }

  return { valid: true, sanitized };
}

/**
 * Sanitiza contenido de texto para almacenamiento seguro
 * @param {string} text - Texto a sanitizar
 * @param {number} maxLength - Longitud máxima (default: 4000)
 * @returns {string} - Texto sanitizado
 */
function sanitizeTextContent(text, maxLength = 4000) {
  if (typeof text !== 'string') {
    return '';
  }

  // Truncar a longitud máxima
  let sanitized = text.substring(0, maxLength);

  // Remover caracteres de control excepto newlines y tabs
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Escapar caracteres problemáticos para SQL (capa adicional)
  // NOTA: Las queries parametrizadas ya manejan esto, pero es defensa en profundidad
  sanitized = sanitized.replace(/'/g, "''");

  return sanitized;
}

/**
 * Valida un código SAP
 * @param {string} code - Código SAP
 * @returns {{valid: boolean, sanitized?: string, error?: string}}
 */
function sanitizeSAPCode(code) {
  if (!code || typeof code !== 'string') {
    return { valid: false, error: 'Código SAP requerido' };
  }

  // Solo dígitos, 5-10 caracteres
  const digitsOnly = code.replace(/\D/g, '');

  if (digitsOnly.length < 5 || digitsOnly.length > 10) {
    return {
      valid: false,
      error: `Código SAP inválido: ${digitsOnly.length} dígitos (esperado 5-10)`,
    };
  }

  return { valid: true, sanitized: digitsOnly };
}

module.exports = {
  redactSecrets,
  redactSensitiveFields,
  sanitizeForSQL,
  sanitizePhoneNumber,
  sanitizeMessageId,
  sanitizeTextContent,
  sanitizeSAPCode,
  SECRET_PATTERNS,
  SENSITIVE_FIELDS,
};
