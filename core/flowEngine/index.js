/**
 * Sign Bot - FlowEngine
 * Motor de flujos para el bot
 *
 * ## Arquitectura de Contextos
 *
 * ```
 * BaseContext (métodos comunes)
 *     ├── StaticFlowContext  (flujos secuenciales: encuesta, consulta)
 *     └── FlexibleFlowContext (flujos dinámicos: refrigerador, vehículo)
 * ```
 *
 * ## Uso - Flujos Estáticos (secuenciales)
 *
 * ```javascript
 * const { staticRegistry, createStaticFlowContext } = require('./core/flowEngine');
 *
 * // Registrar un flujo estático
 * staticRegistry.registrar({
 *   nombre: 'MI_FLUJO',
 *   estados: ['MI_FLUJO_INICIO', 'MI_FLUJO_PASO2'],
 *   botones: { btn_mi_accion: 'handleMiAccion' },
 *   async procesar(ctx, mensaje) {
 *     await ctx.responder('Hola!');
 *     await ctx.avanzarPaso('MI_FLUJO_PASO2');
 *   }
 * });
 * ```
 *
 * ## Uso - Flujos Flexibles (dinámicos)
 *
 * ```javascript
 * const { createFlexibleFlowContext } = require('./core/flowEngine');
 *
 * // Crear contexto flexible
 * const ctx = createFlexibleFlowContext(from, session, context, {
 *   flowName: 'REFRIGERADOR',
 *   tipoReporte: 'REFRIGERADOR'
 * });
 *
 * await ctx.actualizarCampo('codigoSAP', '123456', { fuente: 'ocr' });
 * if (ctx.todosLosCamposCompletos()) {
 *   await ctx.responder('Reporte completo!');
 * }
 * ```
 *
 * @module core/flowEngine
 */

// Contextos
const {
  BaseContext,
  StaticFlowContext,
  FlexibleFlowContext,
  createStaticFlowContext,
  createFlexibleFlowContext,
} = require('./contexts');

// Registries
const {
  StaticFlowRegistry,
  staticRegistry,
  // Aliases para compatibilidad
  FlowRegistry,
  registry,
} = require('./StaticFlowRegistry');

module.exports = {
  // ============================================================
  // NUEVA API (recomendada)
  // ============================================================

  // Contextos
  BaseContext,
  StaticFlowContext,
  FlexibleFlowContext,

  // Factory functions
  createStaticFlowContext,
  createFlexibleFlowContext,

  // Registry para flujos estáticos
  StaticFlowRegistry,
  staticRegistry,

  // ============================================================
  // LEGACY API (compatibilidad hacia atrás)
  // ============================================================

  // Alias - usar staticRegistry en nuevo código
  FlowRegistry,
  registry,

  // Alias - usar createStaticFlowContext en nuevo código
  FlowContext: StaticFlowContext,
  createFlowContext: createStaticFlowContext,
};
