/**
 * AC FIXBOT - Constantes del Flujo Flexible
 * @module flows/modules/constants
 */

const { TIPO_REPORTE } = require('../../../constants/sessionStates');

// ==============================================================
// MAPEO DE ESTADOS FLEXIBLES
// ==============================================================

const ESTADO_FLEXIBLE = {
  [TIPO_REPORTE.REFRIGERADOR]: 'REFRIGERADOR_ACTIVO',
  [TIPO_REPORTE.VEHICULO]: 'VEHICULO_ACTIVO',
};

module.exports = {
  ESTADO_FLEXIBLE,
};
