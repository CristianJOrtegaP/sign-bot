/**
 * AC FIXBOT - Error de Servicio Externo (WhatsApp, Gemini, etc.)
 */

const AppError = require('./AppError');

class ExternalServiceError extends AppError {
    constructor(message, service, originalError = null) {
        super(message, 'EXTERNAL_SERVICE_ERROR', 502);
        this.service = service;
        this.originalError = originalError?.message || null;
        this.responseData = originalError?.response?.data || null;
    }
}

module.exports = ExternalServiceError;
