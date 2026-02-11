/**
 * Sign Bot - Error de Base de Datos
 */

const AppError = require('./AppError');

class DatabaseError extends AppError {
  constructor(message, originalError = null, operation = 'unknown') {
    super(message, 'DATABASE_ERROR', 500);
    this.operation = operation;
    this.originalError = originalError?.message || null;
  }
}

module.exports = DatabaseError;
