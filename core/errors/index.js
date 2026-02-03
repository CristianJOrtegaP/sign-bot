/**
 * AC FIXBOT - Exportacion centralizada de errores
 */

const AppError = require('./AppError');
const DatabaseError = require('./DatabaseError');
const ValidationError = require('./ValidationError');
const ExternalServiceError = require('./ExternalServiceError');
const SessionError = require('./SessionError');
const EquipoNotFoundError = require('./EquipoNotFoundError');
const RateLimitError = require('./RateLimitError');
const ConfigurationError = require('./ConfigurationError');
const ConcurrencyError = require('./ConcurrencyError');

module.exports = {
    AppError,
    DatabaseError,
    ValidationError,
    ExternalServiceError,
    SessionError,
    EquipoNotFoundError,
    RateLimitError,
    ConfigurationError,
    ConcurrencyError
};
