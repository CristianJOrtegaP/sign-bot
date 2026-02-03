/**
 * AC FIXBOT - Circuit Breaker Pattern
 * Protege contra fallos en cascada de servicios externos
 *
 * Estados:
 * - CLOSED: Funcionando normal, requests pasan
 * - OPEN: Servicio fallando, requests rechazados inmediatamente
 * - HALF_OPEN: Probando si el servicio se recuperó
 */

const { logger } = require('./errorHandler');

const STATES = {
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN'
};

/**
 * Configuración por defecto para circuit breakers
 */
const DEFAULT_CONFIG = {
    failureThreshold: 5,        // Fallos consecutivos para abrir
    successThreshold: 2,        // Éxitos en HALF_OPEN para cerrar
    timeout: 30000,             // ms en OPEN antes de probar HALF_OPEN
    monitorInterval: 10000      // ms entre verificaciones de timeout
};

/**
 * Clase CircuitBreaker individual
 */
class CircuitBreaker {
    constructor(name, config = {}) {
        this.name = name;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.state = STATES.CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = null;
        this.nextAttemptTime = null;

        // Estadísticas
        this.stats = {
            totalCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            rejectedCalls: 0,
            lastStateChange: Date.now()
        };
    }

    /**
     * Verifica si se puede ejecutar una operación
     * @returns {{ allowed: boolean, reason?: string }}
     */
    canExecute() {
        this.stats.totalCalls++;

        if (this.state === STATES.CLOSED) {
            return { allowed: true };
        }

        if (this.state === STATES.OPEN) {
            // Verificar si es tiempo de probar HALF_OPEN
            if (Date.now() >= this.nextAttemptTime) {
                this._transitionTo(STATES.HALF_OPEN);
                return { allowed: true };
            }

            this.stats.rejectedCalls++;
            const remainingMs = this.nextAttemptTime - Date.now();
            return {
                allowed: false,
                reason: `Circuit open for ${this.name}. Retry in ${Math.ceil(remainingMs / 1000)}s`
            };
        }

        // HALF_OPEN: permitir una prueba
        return { allowed: true };
    }

    /**
     * Registra un resultado exitoso
     */
    recordSuccess() {
        this.stats.successfulCalls++;

        if (this.state === STATES.HALF_OPEN) {
            this.successes++;
            logger.debug(`[CircuitBreaker:${this.name}] Success in HALF_OPEN (${this.successes}/${this.config.successThreshold})`);

            if (this.successes >= this.config.successThreshold) {
                logger.info(`[CircuitBreaker:${this.name}] HALF_OPEN -> CLOSED (${this.successes} successes)`);
                this._transitionTo(STATES.CLOSED);
            }
        } else if (this.state === STATES.CLOSED) {
            // Reset contador de fallos en éxito
            this.failures = 0;
        }
    }

    /**
     * Registra un resultado fallido
     * @param {Error} error - El error que ocurrió
     */
    recordFailure(error) {
        this.stats.failedCalls++;
        this.lastFailureTime = Date.now();

        if (this.state === STATES.HALF_OPEN) {
            // Un fallo en HALF_OPEN reabre el circuit
            // CRÍTICO: Resetear failures para evitar acumulación incorrecta
            logger.warn(`[CircuitBreaker:${this.name}] Failure in HALF_OPEN, going back to OPEN`, {
                error: error?.message
            });
            this.failures = 0; // Reset antes de transicionar
            this._transitionTo(STATES.OPEN);
        } else if (this.state === STATES.CLOSED) {
            this.failures++;
            logger.debug(`[CircuitBreaker:${this.name}] Failure in CLOSED (${this.failures}/${this.config.failureThreshold})`, {
                error: error?.message
            });

            if (this.failures >= this.config.failureThreshold) {
                logger.warn(`[CircuitBreaker:${this.name}] Threshold reached, CLOSED -> OPEN`);
                this._transitionTo(STATES.OPEN);
            }
        } else if (this.state === STATES.OPEN) {
            // Ya está abierto, no hacer nada
            logger.debug(`[CircuitBreaker:${this.name}] Failure in OPEN (ignored)`, {
                error: error?.message
            });
        }
    }

    /**
     * Ejecuta una función protegida por el circuit breaker
     * @param {Function} fn - Función async a ejecutar
     * @param {Function} fallback - Función fallback opcional
     * @returns {Promise<any>}
     */
    async execute(fn, fallback = null) {
        const check = this.canExecute();

        if (!check.allowed) {
            if (fallback) {
                logger.debug(`[CircuitBreaker:${this.name}] Using fallback: ${check.reason}`);
                return fallback();
            }
            throw new CircuitBreakerOpenError(check.reason, this.name);
        }

        try {
            const result = await fn();
            this.recordSuccess();
            return result;
        } catch (error) {
            this.recordFailure(error);
            if (fallback) {
                logger.debug(`[CircuitBreaker:${this.name}] Using fallback after error`);
                return fallback();
            }
            throw error;
        }
    }

    /**
     * Transiciona a un nuevo estado
     */
    _transitionTo(newState) {
        const oldState = this.state;
        this.state = newState;
        this.stats.lastStateChange = Date.now();

        if (newState === STATES.OPEN) {
            this.nextAttemptTime = Date.now() + this.config.timeout;
            this.successes = 0;
        } else if (newState === STATES.CLOSED) {
            this.failures = 0;
            this.successes = 0;
            this.nextAttemptTime = null;
        } else if (newState === STATES.HALF_OPEN) {
            this.successes = 0;
        }

        logger.info(`[CircuitBreaker:${this.name}] State changed: ${oldState} -> ${newState}`);
    }

    /**
     * Obtiene el estado actual del circuit breaker
     * @returns {string} - Estado actual (CLOSED, OPEN, HALF_OPEN)
     */
    getState() {
        return this.state;
    }

    /**
     * Obtiene estadísticas completas del circuit breaker
     */
    getStats() {
        return {
            name: this.name,
            state: this.state,
            failures: this.failures,
            successes: this.successes,
            nextAttemptTime: this.nextAttemptTime,
            lastFailureTime: this.lastFailureTime,
            ...this.stats,
            config: this.config
        };
    }

    /**
     * Fuerza el reset del circuit breaker (para admin/testing)
     */
    reset() {
        this._transitionTo(STATES.CLOSED);
        this.stats = {
            totalCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            rejectedCalls: 0,
            lastStateChange: Date.now()
        };
        logger.info(`[CircuitBreaker:${this.name}] Manually reset`);
    }
}

/**
 * Error específico de circuit breaker abierto
 */
class CircuitBreakerOpenError extends Error {
    constructor(message, serviceName) {
        super(message);
        this.name = 'CircuitBreakerOpenError';
        this.serviceName = serviceName;
        this.isCircuitBreakerError = true;
    }
}

/**
 * Registry de circuit breakers
 */
const breakers = new Map();

/**
 * Obtiene o crea un circuit breaker para un servicio
 * @param {string} name - Nombre del servicio
 * @param {Object} config - Configuración opcional
 * @returns {CircuitBreaker}
 */
function getBreaker(name, config = {}) {
    if (!breakers.has(name)) {
        breakers.set(name, new CircuitBreaker(name, config));
    }
    return breakers.get(name);
}

/**
 * Obtiene estadísticas de todos los circuit breakers
 */
function getAllStats() {
    const stats = {};
    for (const [name, breaker] of breakers.entries()) {
        stats[name] = breaker.getStats();
    }
    return stats;
}

/**
 * Resetea todos los circuit breakers (para testing)
 */
function resetAll() {
    for (const breaker of breakers.values()) {
        breaker.reset();
    }
}

// Pre-configurar breakers para servicios conocidos
const SERVICES = {
    WHATSAPP: 'whatsapp',
    GEMINI: 'gemini',
    AZURE_OPENAI: 'azure-openai',
    AZURE_VISION: 'azure-vision',
    DATABASE: 'database'
};

// Configuraciones específicas por servicio
const SERVICE_CONFIGS = {
    [SERVICES.WHATSAPP]: {
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 60000  // WhatsApp es crítico, esperar más
    },
    [SERVICES.GEMINI]: {
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 30000
    },
    [SERVICES.AZURE_OPENAI]: {
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 30000
    },
    [SERVICES.AZURE_VISION]: {
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 30000
    },
    [SERVICES.DATABASE]: {
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 35000  // Debe ser > requestTimeout (30s) para evitar falsos positivos
    }
};

// Inicializar breakers con configuraciones específicas
Object.entries(SERVICE_CONFIGS).forEach(([service, config]) => {
    getBreaker(service, config);
});

module.exports = {
    CircuitBreaker,
    CircuitBreakerOpenError,
    getBreaker,
    getAllStats,
    resetAll,
    SERVICES,
    STATES
};
