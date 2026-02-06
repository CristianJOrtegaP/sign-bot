/**
 * AC FIXBOT - Utilidades y Helpers
 * Funciones auxiliares reutilizables
 */

const crypto = require('crypto');
const { logger } = require('../services/infrastructure/errorHandler');

/**
 * Genera un número de ticket único usando UUID v4
 * Formato: TKT-XXXXXXXX (8 caracteres alfanuméricos)
 * @returns {string} - Número de ticket único
 */
function generateTicketNumber() {
  const uuid = crypto.randomUUID();
  // Tomar los primeros 8 caracteres del UUID (sin guiones)
  const shortId = uuid.replace(/-/g, '').substring(0, 8).toUpperCase();
  return `TKT-${shortId}`;
}

/**
 * Parsea JSON de forma segura, devolviendo un objeto vacío si falla
 * @param {string|null} jsonString - String JSON a parsear
 * @param {Object} defaultValue - Valor por defecto si falla el parseo
 * @returns {Object} - Objeto parseado o valor por defecto
 */
function safeParseJSON(jsonString, defaultValue = {}) {
  if (!jsonString || jsonString === 'null' || jsonString === 'undefined') {
    return defaultValue;
  }

  try {
    const parsed = JSON.parse(jsonString);
    if (parsed === null) {
      return defaultValue;
    }

    // Detectar datos corruptos (objeto con claves numéricas consecutivas)
    // Esto ocurre cuando se hace spread de un string: {...'{"foo":"bar"}'} -> {"0":"{","1":"\"","2":"f",...}
    if (isCorruptedObject(parsed)) {
      logger.warn('Datos corruptos detectados, reseteando a valor por defecto', {
        preview: JSON.stringify(parsed).substring(0, 100),
      });
      return defaultValue;
    }

    return parsed;
  } catch (error) {
    logger.warn('Error parseando JSON, usando valor por defecto', {
      error: error.message,
      jsonStringPreview: jsonString.substring(0, 100),
    });
    return defaultValue;
  }
}

/**
 * Detecta si un objeto está corrupto (resultado de spread de string)
 * Un objeto corrupto tiene claves numéricas consecutivas empezando por "0"
 * @param {Object} obj - Objeto a verificar
 * @returns {boolean} - true si el objeto está corrupto
 */
function isCorruptedObject(obj) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return false;
  }

  const keys = Object.keys(obj);

  // Si tiene menos de 10 claves, probablemente no es corrupto
  if (keys.length < 10) {
    return false;
  }

  // Verificar si las primeras 5 claves son "0", "1", "2", "3", "4"
  const firstFiveNumeric = ['0', '1', '2', '3', '4'].every((k) => keys.includes(k));

  // Si tiene claves numéricas consecutivas y los valores son caracteres individuales
  if (firstFiveNumeric) {
    const valuesAreChars = ['0', '1', '2', '3', '4'].every(
      (k) => typeof obj[k] === 'string' && obj[k].length === 1
    );
    return valuesAreChars;
  }

  return false;
}

/**
 * Valida que un código SAP tenga el formato correcto
 * @param {string} codigo - Código SAP a validar
 * @returns {Object} - { valid: boolean, cleaned: string, error?: string }
 */
function validateSAPCode(codigo) {
  if (!codigo || typeof codigo !== 'string') {
    return {
      valid: false,
      cleaned: '',
      error: 'El código SAP es requerido',
    };
  }

  // Limpiar: remover todo excepto dígitos
  const cleaned = codigo.replace(/\D/g, '');

  // Validar longitud mínima (5 dígitos)
  if (cleaned.length < 5) {
    return {
      valid: false,
      cleaned,
      error: 'El código SAP debe tener al menos 5 dígitos',
    };
  }

  // Validar longitud máxima (10 dígitos para flexibilidad)
  if (cleaned.length > 10) {
    return {
      valid: false,
      cleaned,
      error: 'El código SAP no debe exceder 10 dígitos',
    };
  }

  return {
    valid: true,
    cleaned,
    error: null,
  };
}

/**
 * Valida que un número de empleado tenga el formato correcto
 * @param {string} numero - Número de empleado a validar
 * @returns {Object} - { valid: boolean, cleaned: string, error?: string }
 */
function validateEmployeeNumber(numero) {
  if (!numero || typeof numero !== 'string') {
    return {
      valid: false,
      cleaned: '',
      error: 'El número de empleado es requerido',
    };
  }

  const cleaned = numero.trim();

  if (cleaned.length < 3) {
    return {
      valid: false,
      cleaned,
      error: 'El número de empleado debe tener al menos 3 caracteres',
    };
  }

  if (cleaned.length > 20) {
    return {
      valid: false,
      cleaned,
      error: 'El número de empleado no debe exceder 20 caracteres',
    };
  }

  return {
    valid: true,
    cleaned,
    error: null,
  };
}

/**
 * Valida formato de teléfono E.164 (formato de WhatsApp)
 * Ejemplo válido: 521234567890 (código país + número)
 * @param {string} telefono - Número de teléfono a validar
 * @returns {Object} - { valid: boolean, cleaned: string, error?: string }
 */
function validatePhoneE164(telefono) {
  if (!telefono || typeof telefono !== 'string') {
    return {
      valid: false,
      cleaned: '',
      error: 'El número de teléfono es requerido',
    };
  }

  // Limpiar: remover todo excepto dígitos
  const cleaned = telefono.replace(/\D/g, '');

  // E.164: mínimo 10 dígitos (algunos países), máximo 15
  if (cleaned.length < 10) {
    return {
      valid: false,
      cleaned,
      error: 'El número de teléfono debe tener al menos 10 dígitos',
    };
  }

  if (cleaned.length > 15) {
    return {
      valid: false,
      cleaned,
      error: 'El número de teléfono no debe exceder 15 dígitos',
    };
  }

  // Validar que empiece con código de país válido (1-3 dígitos)
  // Los códigos de país no empiezan con 0
  if (cleaned.startsWith('0')) {
    return {
      valid: false,
      cleaned,
      error: 'El número de teléfono debe incluir código de país válido',
    };
  }

  return {
    valid: true,
    cleaned,
    error: null,
  };
}

/**
 * Escapa caracteres HTML para prevenir XSS
 * @param {string} str - String a escapar
 * @returns {string} - String con caracteres HTML escapados
 */
function escapeHtml(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }
  const htmlEntities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;',
  };
  return str.replace(/[&<>"'`=/]/g, (char) => htmlEntities[char]);
}

/**
 * Remueve tags HTML/script potencialmente peligrosos
 * @param {string} str - String a limpiar
 * @returns {string} - String sin tags peligrosos
 */
function stripDangerousTags(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }
  // Remover tags de script, style, iframe, object, embed, form
  /* eslint-disable security/detect-unsafe-regex -- Patterns for HTML sanitization, input is validated */
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<iframe\b[^>]*>.*?<\/iframe>/gi, '')
    .replace(/<object\b[^>]*>.*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<form\b[^>]*>.*?<\/form>/gi, '')
    .replace(/on\w+\s*=/gi, 'data-blocked=') // Bloquear event handlers
    .replace(/javascript:/gi, 'blocked:')
    .replace(/data:/gi, 'blocked:');
  /* eslint-enable security/detect-unsafe-regex */
}

/**
 * Sanitiza texto de entrada para prevenir inyeccion SQL y XSS
 * @param {string} input - Texto a sanitizar
 * @param {Object} options - Opciones de sanitizacion
 * @param {number} options.maxLength - Longitud maxima permitida (default: 1000)
 * @param {boolean} options.allowNewlines - Permitir saltos de linea (default: true)
 * @param {boolean} options.escapeHtml - Escapar caracteres HTML (default: false)
 * @param {boolean} options.stripTags - Remover tags HTML peligrosos (default: true)
 * @returns {string} - Texto sanitizado
 */
function sanitizeInput(input, options = {}) {
  const {
    maxLength = 1000,
    allowNewlines = true,
    escapeHtml: shouldEscape = false,
    stripTags = true,
  } = options;

  if (!input || typeof input !== 'string') {
    return '';
  }

  let sanitized = input;

  // Truncar a longitud maxima
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // Remover o escapar contenido HTML peligroso
  if (stripTags) {
    sanitized = stripDangerousTags(sanitized);
  }
  if (shouldEscape) {
    sanitized = escapeHtml(sanitized);
  }

  // Remover caracteres de control (excepto newlines si estan permitidos)
  if (allowNewlines) {
    // Mantener \n y \r, remover otros caracteres de control
    // eslint-disable-next-line no-control-regex
    sanitized = sanitized.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');
  } else {
    // Remover todos los caracteres de control
    // eslint-disable-next-line no-control-regex
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, ' ');
  }

  // Detectar patrones SQL sospechosos (logging, no bloqueo)
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE)\b)/gi,
    /(--|;|\/\*|\*\/)/g,
    /(\bOR\b\s+\d+\s*=\s*\d+)/gi,
    /(\bAND\b\s+\d+\s*=\s*\d+)/gi,
  ];

  for (const pattern of sqlPatterns) {
    if (pattern.test(sanitized)) {
      logger.warn('Patron SQL sospechoso detectado en entrada', {
        pattern: pattern.toString(),
        inputPreview: sanitized.substring(0, 50),
      });
      break;
    }
  }

  // Normalizar espacios multiples
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  return sanitized;
}

/**
 * Sanitiza descripción de problema (texto largo)
 * @param {string} descripcion - Descripción a sanitizar
 * @returns {string} - Descripción sanitizada
 */
function sanitizeDescription(descripcion) {
  return sanitizeInput(descripcion, {
    maxLength: 2000,
    allowNewlines: true,
  });
}

/**
 * Sanitiza mensaje de chat (texto corto/medio)
 * @param {string} mensaje - Mensaje a sanitizar
 * @returns {string} - Mensaje sanitizado
 */
function sanitizeMessage(mensaje) {
  return sanitizeInput(mensaje, {
    maxLength: 500,
    allowNewlines: false,
  });
}

/**
 * Sanitiza texto antes de enviarlo a un LLM como mensaje de usuario.
 * Previene prompt injection eliminando caracteres de control, zero-width,
 * fences de código y tags XML, y envuelve en delimitadores seguros.
 * @param {string} text - Texto a sanitizar
 * @param {Object} options
 * @param {number} options.maxLength - Longitud máxima (default 1000)
 * @param {boolean} options.wrapInDelimiters - Envolver en <user_input> (default true)
 * @returns {string}
 */
function sanitizeForLLM(text, options = {}) {
  const { maxLength = 1000, wrapInDelimiters = true } = options;
  if (!text || typeof text !== 'string') {
    return wrapInDelimiters ? '<user_input></user_input>' : '';
  }

  let s = text;
  if (s.length > maxLength) {
    s = s.substring(0, maxLength);
  }
  s = s.replace(/[\u200B-\u200D\uFEFF\u2060\u00AD]/g, ''); // zero-width chars
  // eslint-disable-next-line no-control-regex -- Stripping control chars is intentional for input sanitization
  s = s.replace(/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g, ''); // control chars (preserva \n)
  s = s.replace(/`{3,}/g, "'''"); // backtick fences
  s = s.replace(/---+/g, '- - -'); // markdown separadores
  s = s.replace(
    /<\/?[a-zA-Z_][a-zA-Z0-9_]*>/g,
    (
      m // XML-like tags
    ) => m.replace(/</g, '\uFF1C').replace(/>/g, '\uFF1E')
  );
  if (wrapInDelimiters) {
    return `<user_input>${s}</user_input>`;
  }
  return s;
}

module.exports = {
  generateTicketNumber,
  safeParseJSON,
  validateSAPCode,
  validateEmployeeNumber,
  validatePhoneE164,
  sanitizeInput,
  sanitizeDescription,
  sanitizeMessage,
  sanitizeForLLM,
  escapeHtml,
  stripDangerousTags,
};
