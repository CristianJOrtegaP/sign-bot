/**
 * AC FIXBOT - Audit Service
 * Logging de auditoria para operaciones administrativas y de seguridad
 */

const { logger } = require('./errorHandler');
const correlation = require('./correlationService');

/**
 * Tipos de eventos de auditoria
 */
const AUDIT_EVENTS = {
    // Operaciones administrativas
    ADMIN_CACHE_CLEAR: 'ADMIN_CACHE_CLEAR',
    ADMIN_CACHE_STATS: 'ADMIN_CACHE_STATS',
    ADMIN_TIMEOUT_TRIGGER: 'ADMIN_TIMEOUT_TRIGGER',

    // Tickets
    TICKET_RESOLVED: 'TICKET_RESOLVED',
    TICKET_CREATED: 'TICKET_CREATED',

    // Seguridad
    AUTH_SUCCESS: 'AUTH_SUCCESS',
    AUTH_FAILURE: 'AUTH_FAILURE',
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    SIGNATURE_INVALID: 'SIGNATURE_INVALID',

    // Sesiones
    SESSION_CREATED: 'SESSION_CREATED',
    SESSION_TIMEOUT: 'SESSION_TIMEOUT',
    SESSION_REACTIVATED: 'SESSION_REACTIVATED'
};

/**
 * Niveles de severidad
 */
const SEVERITY = {
    INFO: 'INFO',
    WARNING: 'WARNING',
    ERROR: 'ERROR',
    CRITICAL: 'CRITICAL'
};

/**
 * Registra un evento de auditoria
 * @param {string} eventType - Tipo de evento (de AUDIT_EVENTS)
 * @param {Object} details - Detalles del evento
 * @param {string} severity - Severidad (de SEVERITY)
 * @param {Object} req - Request HTTP (opcional, para extraer IP y headers)
 */
function logAuditEvent(eventType, details = {}, severity = SEVERITY.INFO, req = null) {
    const correlationId = correlation.getCorrelationId();

    const auditEntry = {
        timestamp: new Date().toISOString(),
        eventType,
        severity,
        correlationId,
        details: {
            ...details
        }
    };

    // Agregar informacion del request si esta disponible
    if (req) {
        auditEntry.request = {
            method: req.method,
            url: req.url,
            ip: getClientIp(req),
            userAgent: req.headers['user-agent'] || 'unknown'
        };
    }

    // Log estructurado
    const logMessage = `[AUDIT] ${eventType}`;

    switch (severity) {
        case SEVERITY.ERROR:
        case SEVERITY.CRITICAL:
            logger.error(logMessage, null, auditEntry);
            break;
        case SEVERITY.WARNING:
            logger.warn(logMessage, auditEntry);
            break;
        default:
            logger.info(logMessage, auditEntry);
    }

    return auditEntry;
}

/**
 * Obtiene la IP del cliente
 */
function getClientIp(req) {
    if (!req || !req.headers) {return 'unknown';}
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.headers['client-ip'] ||
           'unknown';
}

// ============================================================================
// FUNCIONES DE AUDITORIA ESPECIFICAS
// ============================================================================

/**
 * Registra acceso exitoso a endpoint administrativo
 */
function logAdminAccess(action, details, req) {
    return logAuditEvent(
        `ADMIN_${action.toUpperCase()}`,
        details,
        SEVERITY.INFO,
        req
    );
}

/**
 * Registra intento de acceso fallido
 */
function logAuthFailure(reason, req) {
    return logAuditEvent(
        AUDIT_EVENTS.AUTH_FAILURE,
        { reason },
        SEVERITY.WARNING,
        req
    );
}

/**
 * Registra firma de webhook invalida
 */
function logInvalidSignature(req) {
    return logAuditEvent(
        AUDIT_EVENTS.SIGNATURE_INVALID,
        { signature: req?.headers?.['x-hub-signature-256'] ? 'present' : 'missing' },
        SEVERITY.WARNING,
        req
    );
}

/**
 * Registra rate limit excedido
 */
function logRateLimitExceeded(ip, limit, window) {
    return logAuditEvent(
        AUDIT_EVENTS.RATE_LIMIT_EXCEEDED,
        { ip, limit, windowMs: window },
        SEVERITY.WARNING
    );
}

/**
 * Registra resolucion de ticket
 */
function logTicketResolved(ticketId, previousState, req) {
    return logAuditEvent(
        AUDIT_EVENTS.TICKET_RESOLVED,
        { ticketId, previousState },
        SEVERITY.INFO,
        req
    );
}

/**
 * Registra creacion de ticket
 */
function logTicketCreated(ticketId, telefono, tipoReporte) {
    return logAuditEvent(
        AUDIT_EVENTS.TICKET_CREATED,
        { ticketId, telefono: `${telefono.substring(0, 6)  }****`, tipoReporte },
        SEVERITY.INFO
    );
}

/**
 * Registra limpieza de cache
 */
function logCacheClear(cacheType, details, req) {
    return logAuditEvent(
        AUDIT_EVENTS.ADMIN_CACHE_CLEAR,
        { cacheType, ...details },
        SEVERITY.INFO,
        req
    );
}

/**
 * Registra timeout de sesion
 */
function logSessionTimeout(telefono, lastActivity) {
    return logAuditEvent(
        AUDIT_EVENTS.SESSION_TIMEOUT,
        {
            telefono: `${telefono.substring(0, 6)  }****`,
            lastActivity
        },
        SEVERITY.INFO
    );
}

module.exports = {
    // Constantes
    AUDIT_EVENTS,
    SEVERITY,

    // Funcion generica
    logAuditEvent,

    // Funciones especificas
    logAdminAccess,
    logAuthFailure,
    logInvalidSignature,
    logRateLimitExceeded,
    logTicketResolved,
    logTicketCreated,
    logCacheClear,
    logSessionTimeout
};
