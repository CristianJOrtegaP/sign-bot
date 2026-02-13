/**
 * Sign Bot - Audit Service
 * Logging de auditoria para operaciones administrativas y de seguridad
 * FASE 3: Persistencia en SQL para compliance y análisis
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger } = require('./errorHandler');
const correlation = require('./correlationService');

// Lazy load de database service para evitar dependencias circulares
let dbService = null;
function getDbService() {
  if (!dbService) {
    try {
      dbService = require('../storage/databaseService');
    } catch {
      dbService = null;
    }
  }
  return dbService;
}

// In-memory buffer for audit events that fail to persist
const MAX_BUFFER_SIZE = 500;
const auditBuffer = [];

// Ruta del archivo de respaldo para buffer ante reciclaje de proceso
const BUFFER_BACKUP_PATH = path.join(os.tmpdir(), 'signbot-audit-buffer.json');

/**
 * Respalda el buffer de auditoria a disco (ante shutdown)
 * Evita perder eventos cuando el proceso se recicla
 */
function flushBufferToDisk() {
  if (auditBuffer.length === 0) {
    return;
  }
  try {
    // Leer eventos previos del archivo (si existen)
    let existing = [];
    try {
      const data = fs.readFileSync(BUFFER_BACKUP_PATH, 'utf8');
      existing = JSON.parse(data);
    } catch {
      // No file or invalid JSON, start fresh
    }

    const combined = [...existing, ...auditBuffer].slice(-MAX_BUFFER_SIZE);
    fs.writeFileSync(BUFFER_BACKUP_PATH, JSON.stringify(combined), 'utf8');
    logger.debug(`[Audit] Buffer respaldado a disco: ${auditBuffer.length} eventos`);
  } catch (err) {
    logger.warn('[Audit] Error respaldando buffer a disco', { error: err.message });
  }
}

/**
 * Restaura el buffer de auditoria desde disco (al iniciar)
 */
function restoreBufferFromDisk() {
  try {
    if (!fs.existsSync(BUFFER_BACKUP_PATH)) {
      return;
    }
    const data = fs.readFileSync(BUFFER_BACKUP_PATH, 'utf8');
    const events = JSON.parse(data);
    if (Array.isArray(events) && events.length > 0) {
      auditBuffer.push(...events.slice(0, MAX_BUFFER_SIZE - auditBuffer.length));
      // Limpiar archivo despues de restaurar
      fs.unlinkSync(BUFFER_BACKUP_PATH);
      logger.info(`[Audit] Buffer restaurado desde disco: ${events.length} eventos`);
    }
  } catch (err) {
    logger.debug('[Audit] No se pudo restaurar buffer desde disco', { error: err.message });
  }
}

// Restaurar buffer al cargar el modulo
restoreBufferFromDisk();

// Respaldar buffer ante senales de terminacion
process.on('SIGTERM', flushBufferToDisk);
process.on('SIGINT', flushBufferToDisk);

/**
 * Drains buffered audit events to SQL (called on next successful persist)
 */
async function drainAuditBuffer() {
  if (auditBuffer.length === 0) {
    return;
  }

  const batch = auditBuffer.splice(0, 50); // Process 50 at a time
  for (const entry of batch) {
    try {
      await persistAuditEventDirect(entry);
    } catch (_e) {
      // If still failing, re-buffer (at the end)
      if (auditBuffer.length < MAX_BUFFER_SIZE) {
        auditBuffer.push(entry);
      }
      break; // Stop trying if DB is still down
    }
  }
}

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
  SESSION_REACTIVATED: 'SESSION_REACTIVATED',
};

/**
 * Niveles de severidad
 */
const SEVERITY = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
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
      ...details,
    },
  };

  // Agregar informacion del request si esta disponible
  if (req) {
    auditEntry.request = {
      method: req.method,
      url: req.url,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || 'unknown',
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

  // FASE 3: Persistir en SQL (async, no bloqueante) with buffer fallback
  persistAuditEvent(auditEntry).catch((err) => {
    // Buffer failed events for retry
    if (auditBuffer.length < MAX_BUFFER_SIZE) {
      auditBuffer.push(auditEntry);
    }
    logger.debug('Error persistiendo audit event (buffered)', { error: err.message });
  });

  return auditEntry;
}

/**
 * Persiste evento de auditoría en tabla SQL directamente (sin buffer)
 * @param {Object} auditEntry - Entrada de auditoría
 */
async function persistAuditEventDirect(auditEntry) {
  const db = getDbService();
  if (!db) {
    return;
  }

  const pool = await db.getPool();
  if (!pool) {
    return;
  }

  await pool
    .request()
    .input('EventType', auditEntry.eventType)
    .input('Severity', auditEntry.severity)
    .input('CorrelationId', auditEntry.correlationId || null)
    .input('Details', JSON.stringify(auditEntry.details || {}))
    .input('RequestInfo', auditEntry.request ? JSON.stringify(auditEntry.request) : null)
    .input('Timestamp', auditEntry.timestamp).query(`
      INSERT INTO AuditEvents
      (EventType, Severity, CorrelationId, Details, RequestInfo, Timestamp)
      VALUES
      (@EventType, @Severity, @CorrelationId, @Details, @RequestInfo, @Timestamp)
    `);
}

/**
 * Persiste evento de auditoría en tabla SQL
 * FASE 3: Compliance y análisis de seguridad
 * @param {Object} auditEntry - Entrada de auditoría
 */
async function persistAuditEvent(auditEntry) {
  try {
    await persistAuditEventDirect(auditEntry);

    // On success, try to drain any buffered events
    if (auditBuffer.length > 0) {
      drainAuditBuffer().catch(() => {});
    }
  } catch (error) {
    // No propagar errores de auditoría para no afectar flujo principal
    // Si la tabla no existe, ignorar silenciosamente
    if (!error.message?.includes('Invalid object name')) {
      logger.debug('Error persistiendo audit event en SQL', { error: error.message });
    }
    throw error; // Re-throw so caller can buffer
  }
}

/**
 * Obtiene la IP del cliente
 */
function getClientIp(req) {
  if (!req || !req.headers) {
    return 'unknown';
  }
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.headers['client-ip'] ||
    'unknown'
  );
}

// ============================================================================
// FUNCIONES DE AUDITORIA ESPECIFICAS
// ============================================================================

/**
 * Registra acceso exitoso a endpoint administrativo
 */
function logAdminAccess(action, details, req) {
  return logAuditEvent(`ADMIN_${action.toUpperCase()}`, details, SEVERITY.INFO, req);
}

/**
 * Registra intento de acceso fallido
 */
function logAuthFailure(reason, req) {
  return logAuditEvent(AUDIT_EVENTS.AUTH_FAILURE, { reason }, SEVERITY.WARNING, req);
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
    { ticketId, telefono: `${telefono.substring(0, 6)}****`, tipoReporte },
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
      telefono: `${telefono.substring(0, 6)}****`,
      lastActivity,
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
  logSessionTimeout,
};
