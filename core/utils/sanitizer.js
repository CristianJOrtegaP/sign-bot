/**
 * AC FIXBOT - Sanitizer de Logs
 * Elimina datos sensibles antes de loguear para prevenir exposición de credenciales
 */

/**
 * Patrones de datos sensibles a redactar
 * Cada patrón captura el nombre del campo y su valor
 */
const SENSITIVE_PATTERNS = [
  // Tokens y API Keys
  { name: 'token', pattern: /(\btoken\b["\s:=]+["']?)[\w\-_.]+/gi },
  { name: 'apiKey', pattern: /(\bapi[_-]?key\b["\s:=]+["']?)[\w\-_.]+/gi },
  { name: 'accessToken', pattern: /(\baccess[_-]?token\b["\s:=]+["']?)[\w\-_.]+/gi },
  { name: 'bearer', pattern: /(Bearer\s+)[\w\-_.]+/gi },

  // Passwords y Secrets
  { name: 'password', pattern: /(\bpassword\b["\s:=]+["']?)[^"'\s;]+/gi },
  { name: 'pwd', pattern: /(\bpwd\b["\s:=]+["']?)[^"'\s;]+/gi },
  { name: 'secret', pattern: /(\bsecret\b["\s:=]+["']?)[\w\-_.]+/gi },

  // Connection strings (SQL Server, Azure, etc.)
  { name: 'connectionString', pattern: /(Server=)[^;]+/gi },
  { name: 'connectionString', pattern: /(Password=)[^;]+/gi },
  { name: 'connectionString', pattern: /(User Id=)[^;]+/gi },

  // Azure specific
  { name: 'subscriptionKey', pattern: /(\bsubscription[_-]?key\b["\s:=]+["']?)[\w\-_.]+/gi },
  { name: 'sasToken', pattern: /(\bsig=)[\w%]+/gi },

  // WhatsApp
  { name: 'whatsappToken', pattern: /(WHATSAPP_TOKEN["\s:=]+["']?)[\w\-_.]+/gi },
  { name: 'appSecret', pattern: /(APP_SECRET["\s:=]+["']?)[\w\-_.]+/gi },
];

/**
 * Patrones para mascarar datos personales (mostrar parcialmente)
 */
const MASK_PATTERNS = [
  // Números de teléfono: 521234567890 -> 52*******890
  {
    name: 'phone',
    pattern: /\b(\d{2})(\d{7,})(\d{3})\b/g,
    replacement: (_, prefix, middle, suffix) => `${prefix}${'*'.repeat(middle.length)}${suffix}`,
  },
  // Emails: user@domain.com -> u***@domain.com
  {
    name: 'email',
    pattern: /\b([a-zA-Z0-9._%+-])([a-zA-Z0-9._%+-]+)(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
    replacement: (_, first, middle, domain) =>
      `${first}${'*'.repeat(Math.min(middle.length, 5))}${domain}`,
  },
];

/**
 * Sanitiza un string removiendo datos sensibles
 * @param {string|object} data - Datos a sanitizar (string o objeto)
 * @param {object} options - Opciones de sanitización
 * @param {boolean} options.maskPersonalData - Si debe mascarar datos personales (default: false)
 * @returns {string} - String sanitizado
 */
function sanitizeForLogging(data, options = {}) {
  const { maskPersonalData = false } = options;

  // Convertir a string si es objeto
  let sanitized = typeof data === 'string' ? data : JSON.stringify(data);

  // Aplicar patrones de datos sensibles
  for (const { name, pattern } of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, `$1[REDACTED:${name}]`);
  }

  // Opcionalmente mascarar datos personales
  if (maskPersonalData) {
    for (const { pattern, replacement } of MASK_PATTERNS) {
      sanitized = sanitized.replace(pattern, replacement);
    }
  }

  return sanitized;
}

/**
 * Sanitiza un objeto de contexto para logging
 * Crea una copia con valores sensibles redactados
 * @param {object} context - Contexto a sanitizar
 * @returns {object} - Copia sanitizada del contexto
 */
function sanitizeContext(context) {
  if (!context || typeof context !== 'object') {
    return context;
  }

  // Lista de keys que siempre deben ser redactadas
  const sensitiveKeys = [
    'password',
    'pwd',
    'token',
    'secret',
    'key',
    'apiKey',
    'api_key',
    'accessToken',
    'access_token',
    'authorization',
    'bearer',
    'connectionString',
    'connection_string',
    'credentials',
  ];

  const sanitized = {};

  for (const [key, value] of Object.entries(context)) {
    const lowerKey = key.toLowerCase();

    // Si la key es sensible, redactar completamente
    if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Si es un objeto nested, recursar
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeContext(value);
      continue;
    }

    // Si es un string, aplicar sanitización
    if (typeof value === 'string') {
      sanitized[key] = sanitizeForLogging(value);
      continue;
    }

    // Copiar otros valores sin cambios
    sanitized[key] = value;
  }

  return sanitized;
}

/**
 * Verifica si un string contiene datos potencialmente sensibles
 * Útil para validación antes de loguear
 * @param {string} data - Datos a verificar
 * @returns {boolean} - true si contiene datos sensibles
 */
function containsSensitiveData(data) {
  if (typeof data !== 'string') {
    data = JSON.stringify(data);
  }

  for (const { pattern } of SENSITIVE_PATTERNS) {
    // Clonar el regex para resetear lastIndex
    const testPattern = new RegExp(pattern.source, pattern.flags);
    if (testPattern.test(data)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  sanitizeForLogging,
  sanitizeContext,
  containsSensitiveData,
  SENSITIVE_PATTERNS,
  MASK_PATTERNS,
};
