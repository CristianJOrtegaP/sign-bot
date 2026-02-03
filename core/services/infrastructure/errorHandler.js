/**
 * AC FIXBOT - Manejador Centralizado de Errores
 * Logger unificado y funciones de manejo de errores
 *
 * Las clases de error se importan desde la carpeta errors/ para mejor organizacion
 * Integrado con correlationService para tracing distribuido
 */

const config = require('../../config');

// Importar correlationService de forma lazy para evitar dependencias circulares
let correlationService = null;
function getCorrelationService() {
    if (!correlationService) {
        try {
            correlationService = require('./correlationService');
        } catch {
            // Si no está disponible, usar un stub
            correlationService = {
                getCorrelationId: () => null,
                getContext: () => ({})
            };
        }
    }
    return correlationService;
}

// Importar clases de error desde la carpeta errors/
const {
    AppError,
    DatabaseError,
    ValidationError,
    ExternalServiceError,
    SessionError,
    EquipoNotFoundError,
    RateLimitError,
    ConfigurationError
} = require('../../errors');

// ============================================
// LOGGING UNIFICADO
// ============================================

/**
 * Niveles de log
 */
const LogLevel = {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
};

/**
 * Logger centralizado con formato consistente
 */
const logger = {
    /**
     * Formatea un mensaje de log con correlation ID si está disponible
     */
    _format(level, message, context = {}) {
        const timestamp = new Date().toISOString();
        const correlation = getCorrelationService();
        const correlationId = correlation.getCorrelationId();

        // Incluir correlation ID si está disponible
        const correlationPrefix = correlationId ? `[${correlationId}] ` : '';

        // Agregar correlation ID al contexto si existe
        const enrichedContext = correlationId
            ? { correlationId, ...context }
            : context;

        const contextStr = Object.keys(enrichedContext).length > 0
            ? ` | ${JSON.stringify(enrichedContext)}`
            : '';
        return `[${timestamp}] [${level}] ${correlationPrefix}${message}${contextStr}`;
    },

    /**
     * Log de debug (solo en desarrollo)
     */
    debug(message, context = {}) {
        if (process.env.NODE_ENV !== 'production') {
            console.log(this._format(LogLevel.DEBUG, message, context));
        }
    },

    /**
     * Log informativo
     */
    info(message, context = {}) {
        console.log(this._format(LogLevel.INFO, message, context));
    },

    /**
     * Log de advertencia
     */
    warn(message, context = {}) {
        console.warn(this._format(LogLevel.WARN, `⚠️ ${message}`, context));
    },

    /**
     * Log de error con contexto estructurado
     */
    error(message, error = null, context = {}) {
        const errorContext = {
            ...context,
            ...(error && {
                errorName: error.name,
                errorMessage: error.message,
                errorCode: error.code,
                ...(error instanceof AppError && { isOperational: error.isOperational })
            })
        };
        console.error(this._format(LogLevel.ERROR, `❌ ${message}`, errorContext));
    },

    /**
     * Log específico para operaciones de BD
     */
    database(operation, success, context = {}) {
        const emoji = success ? '✅' : '❌';
        const level = success ? LogLevel.INFO : LogLevel.ERROR;
        console.log(this._format(level, `${emoji} [DB] ${operation}`, context));
    },

    /**
     * Log específico para WhatsApp
     */
    whatsapp(operation, success, context = {}) {
        const emoji = success ? '📤' : '❌';
        const level = success ? LogLevel.INFO : LogLevel.ERROR;
        console.log(this._format(level, `${emoji} [WhatsApp] ${operation}`, context));
    },

    /**
     * Log específico para IA (Gemini)
     */
    ai(operation, context = {}) {
        console.log(this._format(LogLevel.INFO, `🤖 [AI] ${operation}`, context));
    },

    /**
     * Log específico para Vision/OCR
     */
    vision(operation, context = {}) {
        console.log(this._format(LogLevel.INFO, `👁️ [Vision] ${operation}`, context));
    },

    /**
     * Log específico para métricas
     */
    metrics(operation, context = {}) {
        console.log(this._format(LogLevel.INFO, `📊 [Metrics] ${operation}`, context));
    },

    /**
     * Log específico para seguridad
     */
    security(message, context = {}) {
        console.log(this._format(LogLevel.INFO, `🔒 [Security] ${message}`, context));
    },

    /**
     * Crea un logger con prefijo personalizado
     * @param {string} prefix - Prefijo para los logs (ej: 'IntentService')
     * @returns {Object} - Logger con contexto
     */
    withPrefix(prefix) {
        const self = this;
        return {
            debug: (msg, ctx = {}) => self.debug(`[${prefix}] ${msg}`, ctx),
            info: (msg, ctx = {}) => self.info(`[${prefix}] ${msg}`, ctx),
            warn: (msg, ctx = {}) => self.warn(`[${prefix}] ${msg}`, ctx),
            error: (msg, err, ctx = {}) => self.error(`[${prefix}] ${msg}`, err, ctx)
        };
    }
};

// ============================================
// FUNCIONES DE MANEJO DE ERRORES
// ============================================

/**
 * Maneja un error y decide qué hacer con él
 * @param {Error} error - Error a manejar
 * @param {string} operation - Operación que falló
 * @param {Object} context - Contexto adicional
 * @returns {Object} - Resultado del manejo
 */
function handleError(error, operation, context = {}) {
    // Si es un error operacional (esperado), solo logueamos
    if (error instanceof AppError && error.isOperational) {
        logger.error(`Error operacional en ${operation}`, error, context);
        return {
            handled: true,
            shouldRetry: false,
            userMessage: getUserFriendlyMessage(error)
        };
    }

    // Si es un error de conexión a BD, podemos reintentar
    if (config.database.reconnectErrorCodes.includes(error.code)) {
        logger.warn(`Error de conexión en ${operation}, reintentable`, { code: error.code, ...context });
        return {
            handled: true,
            shouldRetry: true,
            userMessage: 'Hubo un problema temporal. Por favor intenta de nuevo.'
        };
    }

    // Para otros errores (de programación), loguear completo
    logger.error(`Error inesperado en ${operation}`, error, {
        stack: error.stack,
        ...context
    });

    return {
        handled: false,
        shouldRetry: false,
        userMessage: 'Ocurrió un error inesperado. Nuestro equipo ha sido notificado.'
    };
}

/**
 * Obtiene un mensaje amigable para el usuario según el tipo de error
 * @param {Error} error - Error
 * @returns {string} - Mensaje amigable
 */
function getUserFriendlyMessage(error) {
    if (error instanceof ValidationError) {
        return error.message;
    }
    if (error instanceof EquipoNotFoundError) {
        return `No encontré un equipo con el código ${error.codigoSAP}. ¿Podrías verificarlo?`;
    }
    if (error instanceof RateLimitError) {
        return error.message;
    }
    if (error instanceof ExternalServiceError) {
        return 'Estamos teniendo problemas técnicos. Por favor intenta en unos minutos.';
    }
    if (error instanceof DatabaseError) {
        return 'No pude completar la operación. Por favor intenta de nuevo.';
    }
    return 'Ocurrió un error. Por favor intenta de nuevo.';
}

/**
 * Wrapper para ejecutar funciones con manejo de errores
 * @param {Function} fn - Función a ejecutar
 * @param {Object} options - Opciones de configuración
 * @returns {Promise<any>} - Resultado o error manejado
 */
async function withErrorHandling(fn, options = {}) {
    const {
        operation = 'operación desconocida',
        context = {},
        defaultValue = null,
        rethrow = false
    } = options;

    try {
        return await fn();
    } catch (error) {
        const _result = handleError(error, operation, context);

        if (rethrow) {
            throw error;
        }

        return defaultValue;
    }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    // Clases de error
    AppError,
    DatabaseError,
    ValidationError,
    ExternalServiceError,
    SessionError,
    EquipoNotFoundError,
    RateLimitError,
    ConfigurationError,

    // Logger
    logger,
    LogLevel,

    // Funciones de manejo
    handleError,
    getUserFriendlyMessage,
    withErrorHandling
};
