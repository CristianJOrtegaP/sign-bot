/**
 * AC FIXBOT - Concurrency Error
 * Lanzado cuando optimistic locking detecta una race condition
 * El caller debe reintentar la operación
 */

const AppError = require('./AppError');

class ConcurrencyError extends AppError {
    /**
     * @param {string} telefono - Número de teléfono afectado
     * @param {number} expectedVersion - Versión esperada
     * @param {string} operation - Operación que falló (ej: 'updateSession')
     */
    constructor(telefono, expectedVersion, operation = 'unknown') {
        super(
            `Concurrency conflict detected for ${telefono}. Expected version: ${expectedVersion}. Another process modified the session.`,
            'CONCURRENCY_CONFLICT',
            409, // HTTP 409 Conflict
            true  // Es operacional, se puede recuperar con retry
        );

        this.telefono = telefono;
        this.expectedVersion = expectedVersion;
        this.operation = operation;
        this.retryable = true; // Indica que la operación puede reintentar
    }

    toJSON() {
        return {
            ...super.toJSON(),
            telefono: this.telefono,
            expectedVersion: this.expectedVersion,
            operation: this.operation,
            retryable: this.retryable
        };
    }
}

module.exports = ConcurrencyError;
