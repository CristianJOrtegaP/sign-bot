/**
 * AC FIXBOT - Módulos del Flujo Flexible
 * Exporta todas las funciones de los módulos internos
 * @module flows/modules
 */

// Constantes
const { ESTADO_FLEXIBLE } = require('./constants');

// Utilidades
const {
  esEstadoFlexible,
  getTipoReportePorEstado,
  getMensajeProblema,
  getTituloFlujo,
} = require('./utils');

// Inicialización de flujo
const { iniciarFlujo, iniciarFlujoConMensaje } = require('./flowInit');

// Procesadores
const { procesarMensaje, procesarImagen, procesarUbicacion } = require('./processors');

// Manejadores de campos
const { solicitarSiguienteCampo } = require('./fieldHandlers');

// Creación de reportes
const { crearReporte, crearReporteRefrigerador, crearReporteVehiculo } = require('./reportBuilder');

// Confirmaciones
const {
  procesarRespuestaConfirmacion,
  confirmarEquipoDetectado,
  rechazarEquipoDetectado,
  confirmarDatosAI,
  rechazarDatosAI,
} = require('./confirmations');

// Botones
const { procesarBoton } = require('./buttonHandler');

// Cancelación
const { esCancelacion, cancelarFlujo } = require('./cancellation');

// Cálculo de servicio
const { calcularCentroServicioYETA } = require('./serviceCalculation');

// Adapter para FlexibleFlowContext (migración gradual)
const {
  crearContexto,
  withContext,
  useFlexibleContext,
  ejecutarConContexto,
  createFlexibleFlowContext,
} = require('./FlexibleFlowAdapter');

module.exports = {
  // ============================================================
  // NUEVA API - FlexibleFlowContext
  // ============================================================
  crearContexto,
  withContext,
  useFlexibleContext,
  ejecutarConContexto,
  createFlexibleFlowContext,

  // ============================================================
  // LEGACY API - Funciones existentes
  // ============================================================

  // Constantes
  ESTADO_FLEXIBLE,

  // Inicialización
  iniciarFlujo,
  iniciarFlujoConMensaje,

  // Procesamiento
  procesarMensaje,
  procesarImagen,
  procesarUbicacion,
  procesarBoton,

  // Creación de reportes
  crearReporte,
  crearReporteRefrigerador,
  crearReporteVehiculo,

  // Confirmaciones
  procesarRespuestaConfirmacion,
  confirmarEquipoDetectado,
  rechazarEquipoDetectado,
  confirmarDatosAI,
  rechazarDatosAI,

  // Campos
  solicitarSiguienteCampo,
  getMensajeProblema,
  getTituloFlujo,

  // Utilidades
  esEstadoFlexible,
  getTipoReportePorEstado,

  // Cancelación
  esCancelacion,
  cancelarFlujo,

  // Cálculo de servicio
  calcularCentroServicioYETA,
};
