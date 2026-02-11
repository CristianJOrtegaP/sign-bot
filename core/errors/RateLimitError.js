/**
 * Sign Bot - Error de Rate Limiting
 */

const AppError = require('./AppError');

class RateLimitError extends AppError {
  constructor(telefono, reason) {
    super(reason, 'RATE_LIMIT_ERROR', 429);
    this.telefono = telefono;
  }
}

module.exports = RateLimitError;
