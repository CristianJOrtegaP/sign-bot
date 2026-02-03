/**
 * AC FIXBOT - Middleware de Sanitizacion
 * Limpia y valida datos de entrada
 */

/**
 * Sanitiza un mensaje de texto
 * @param {string} message - Mensaje a sanitizar
 * @returns {string} - Mensaje sanitizado
 */
function sanitizeMessage(message) {
    if (!message || typeof message !== 'string') {
        return '';
    }

    return message
        .trim()
        .substring(0, 4096) // Limitar longitud maxima
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Remover caracteres de control
}

/**
 * Valida formato de telefono E.164
 * @param {string} telefono - Numero de telefono
 * @returns {boolean} - true si es valido
 */
function isValidE164Phone(telefono) {
    if (!telefono || typeof telefono !== 'string') {
        return false;
    }

    // E.164: empieza con digito, solo digitos, 7-15 caracteres
    const e164Regex = /^[1-9]\d{6,14}$/;
    return e164Regex.test(telefono);
}

/**
 * Normaliza un numero de telefono mexicano a formato E.164
 * @param {string} telefono - Numero de telefono
 * @returns {string|null} - Telefono normalizado o null si es invalido
 */
function normalizePhoneNumber(telefono) {
    if (!telefono) {
        return null;
    }

    // Remover espacios, guiones y parentesis
    let normalized = telefono.replace(/[\s\-()]/g, '');

    // Si empieza con +, removerlo
    if (normalized.startsWith('+')) {
        normalized = normalized.substring(1);
    }

    // Validar formato E.164
    if (isValidE164Phone(normalized)) {
        return normalized;
    }

    return null;
}

/**
 * Sanitiza un codigo SAP
 * @param {string} codigoSAP - Codigo SAP a sanitizar
 * @returns {string} - Codigo sanitizado
 */
function sanitizeCodigoSAP(codigoSAP) {
    if (!codigoSAP || typeof codigoSAP !== 'string') {
        return '';
    }

    // Solo permitir digitos
    return codigoSAP.replace(/\D/g, '').substring(0, 10);
}

/**
 * Sanitiza un ID de mensaje de WhatsApp
 * @param {string} messageId - ID del mensaje
 * @returns {string} - ID sanitizado
 */
function sanitizeMessageId(messageId) {
    if (!messageId || typeof messageId !== 'string') {
        return '';
    }

    // WhatsApp message IDs son alfanumericos con guiones bajos
    return messageId.replace(/[^a-zA-Z0-9_]/g, '').substring(0, 100);
}

module.exports = {
    sanitizeMessage,
    isValidE164Phone,
    normalizePhoneNumber,
    sanitizeCodigoSAP,
    sanitizeMessageId
};
