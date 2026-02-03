/**
 * AC FIXBOT - Error de Configuracion
 */

const AppError = require('./AppError');

class ConfigurationError extends AppError {
    constructor(message, configKey = null) {
        super(message, 'CONFIGURATION_ERROR', 500, false); // No es operacional
        this.configKey = configKey;
    }
}

module.exports = ConfigurationError;
