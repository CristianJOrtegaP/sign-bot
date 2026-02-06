/**
 * AC FIXBOT - Utilidades del Flujo Flexible
 * Funciones puras sin dependencias de otros módulos del flujo
 * @module flows/modules/utils
 */

const MSG = require('../../../constants/messages');
const { TIPO_REPORTE } = require('../../../constants/sessionStates');
const { ESTADO_FLEXIBLE } = require('./constants');

/**
 * Verifica si un estado pertenece al flujo flexible
 * @param {string} estado - Estado a verificar
 * @returns {boolean}
 */
function esEstadoFlexible(estado) {
  // Estados flexibles principales
  const estadosFlexibles = Object.values(ESTADO_FLEXIBLE);

  // Estados de confirmación también son parte del flujo flexible
  const estadosConfirmacion = [
    'REFRIGERADOR_CONFIRMAR_EQUIPO',
    'REFRIGERADOR_CONFIRMAR_DATOS_AI',
    'VEHICULO_CONFIRMAR_DATOS_AI',
  ];

  return estadosFlexibles.includes(estado) || estadosConfirmacion.includes(estado);
}

/**
 * Obtiene el tipo de reporte a partir del estado
 * @param {string} estado - Estado de la sesión
 * @returns {string|null} - REFRIGERADOR | VEHICULO | null
 */
function getTipoReportePorEstado(estado) {
  if (estado === 'REFRIGERADOR_ACTIVO') {
    return TIPO_REPORTE.REFRIGERADOR;
  }
  if (estado === 'VEHICULO_ACTIVO') {
    return TIPO_REPORTE.VEHICULO;
  }
  return null;
}

/**
 * Obtiene el mensaje de descripción del problema según el tipo de reporte
 * @param {Object} datosTemp - DatosTemp con tipoReporte
 * @returns {string}
 */
function getMensajeProblema(datosTemp) {
  if (datosTemp.tipoReporte === TIPO_REPORTE.REFRIGERADOR) {
    return (
      MSG.REFRIGERADOR?.REQUEST_PROBLEMA ||
      '📝 Por favor, describe el problema que presenta el refrigerador:'
    );
  }
  if (datosTemp.tipoReporte === TIPO_REPORTE.VEHICULO) {
    return (
      MSG.VEHICULO?.REQUEST_PROBLEMA ||
      '📝 Por favor, describe el problema que presenta el vehículo:'
    );
  }
  return '📝 Por favor, describe el problema:';
}

/**
 * Obtiene el título del flujo según el tipo de reporte
 * @param {string} tipoReporte - REFRIGERADOR | VEHICULO
 * @returns {string}
 */
function getTituloFlujo(tipoReporte) {
  return tipoReporte === TIPO_REPORTE.REFRIGERADOR
    ? MSG.REFRIGERADOR.TITLE
    : MSG.VEHICULO?.TITLE || '🚗 Reporte de Vehículo';
}

module.exports = {
  esEstadoFlexible,
  getTipoReportePorEstado,
  getMensajeProblema,
  getTituloFlujo,
};
