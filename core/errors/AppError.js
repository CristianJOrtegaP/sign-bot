/**
 * AC FIXBOT - Error Base
 * Todos los errores personalizados heredan de esta clase
 */

class AppError extends Error {
    constructor(message, code = 'UNKNOWN_ERROR', statusCode = 500, isOperational = true) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.statusCode = statusCode;
        this.isOperational = isOperational; // Errores operacionales vs errores de programacion
        this.timestamp = new Date().toISOString();
        Error.captureStackTrace(this, this.constructor);
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            statusCode: this.statusCode,
            timestamp: this.timestamp
        };
    }
}

module.exports = AppError;
