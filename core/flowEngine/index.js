/**
 * AC FIXBOT - FlowEngine
 * Motor de flujos para el bot
 *
 * Uso:
 * ```javascript
 * const { registry, createFlowContext } = require('./core/flowEngine');
 *
 * // Registrar un flujo
 * registry.registrar({
 *   nombre: 'MI_FLUJO',
 *   estados: ['MI_FLUJO_INICIO', 'MI_FLUJO_PASO2'],
 *   botones: {
 *     btn_mi_accion: 'handleMiAccion'
 *   },
 *   async procesar(ctx, mensaje, session) {
 *     await ctx.responder('Hola!');
 *     await ctx.cambiarEstado('MI_FLUJO_PASO2');
 *   },
 *   async handleMiAccion(ctx, session) {
 *     await ctx.responder('Botón presionado');
 *   }
 * });
 *
 * // Procesar mensaje
 * const procesado = await registry.procesarMensaje(from, texto, session, context);
 * ```
 *
 * @module core/flowEngine
 */

const { FlowContext, createFlowContext } = require('./FlowContext');
const { FlowRegistry, registry } = require('./FlowRegistry');

module.exports = {
  // Clases
  FlowContext,
  FlowRegistry,

  // Singleton del registry
  registry,

  // Factory
  createFlowContext,
};
