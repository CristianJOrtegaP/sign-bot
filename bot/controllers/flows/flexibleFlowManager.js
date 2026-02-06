/**
 * AC FIXBOT - Flexible Flow Manager (FASE 2b)
 *
 * Orquesta el flujo flexible de reporte de problemas.
 * Permite al usuario proporcionar datos en cualquier orden.
 *
 * Estados simplificados:
 * - REFRIGERADOR_ACTIVO: Estado único para todo el flujo de refrigerador
 * - VEHICULO_ACTIVO: Estado único para todo el flujo de vehículo
 *
 * Flujo:
 * 1. Usuario inicia flujo → se crea DatosTemp con camposRequeridos
 * 2. Cada mensaje se procesa con fieldExtractor
 * 3. Campos extraídos se mergean con fieldManager
 * 4. Si faltan campos → preguntar siguiente campo
 * 5. Si está completo → crear reporte
 *
 * ============================================================================
 * ARQUITECTURA MODULAR
 * ============================================================================
 * Este archivo es un wrapper que re-exporta los módulos internos.
 * La lógica está dividida en módulos para mejor mantenibilidad:
 *
 * - modules/constants.js         - ESTADO_FLEXIBLE
 * - modules/utils.js             - esEstadoFlexible, getTipoReportePorEstado
 * - modules/flowInit.js          - iniciarFlujo, iniciarFlujoConMensaje
 * - modules/processors.js        - procesarMensaje, procesarImagen, procesarUbicacion
 * - modules/fieldHandlers.js     - solicitarSiguienteCampo
 * - modules/reportBuilder.js     - crearReporte
 * - modules/confirmations.js     - confirmarEquipoDetectado, confirmarDatosAI, etc.
 * - modules/buttonHandler.js     - procesarBoton
 * - modules/cancellation.js      - cancelarFlujo
 * - modules/serviceCalculation.js - calcularCentroServicioYETA
 *
 * @module controllers/flows/flexibleFlowManager
 */

// Re-exportar todo desde los módulos internos
module.exports = require('./modules');
