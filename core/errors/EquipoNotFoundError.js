/**
 * Sign Bot - Error de Equipo No Encontrado
 */

const AppError = require('./AppError');

class EquipoNotFoundError extends AppError {
  constructor(codigoSAP) {
    super(`Equipo con codigo SAP ${codigoSAP} no encontrado`, 'EQUIPO_NOT_FOUND', 404);
    this.codigoSAP = codigoSAP;
  }
}

module.exports = EquipoNotFoundError;
