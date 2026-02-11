/**
 * Sign Bot - Error de Sesion de Usuario
 */

const AppError = require('./AppError');

class SessionError extends AppError {
  constructor(message, telefono = null) {
    super(message, 'SESSION_ERROR', 400);
    this.telefono = telefono;
  }
}

module.exports = SessionError;
