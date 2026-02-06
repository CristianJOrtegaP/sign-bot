/**
 * AC FIXBOT - FlexibleFlowAdapter
 * Adapter para transición gradual a FlexibleFlowContext
 *
 * Uso:
 * ```javascript
 * const { withContext } = require('./FlexibleFlowAdapter');
 *
 * // ANTES (sin contexto):
 * async function procesarMensaje(from, texto, session, context) {
 *   await whatsapp.sendText(from, 'Mensaje');
 *   await db.updateSession(from, estado, datos, null, ORIGEN_ACCION.BOT, 'motivo');
 * }
 *
 * // DESPUÉS (con contexto):
 * async function procesarMensajeV2(ctx, texto) {
 *   await ctx.responder('Mensaje');
 *   await ctx.cambiarEstado(estado, datos, 'motivo');
 * }
 *
 * // Wrapper para compatibilidad:
 * const procesarMensaje = withContext(procesarMensajeV2);
 * ```
 *
 * @module flows/modules/FlexibleFlowAdapter
 */

const {
  createFlexibleFlowContext,
} = require('../../../../core/flowEngine/contexts/FlexibleFlowContext');
const fieldManager = require('../../../services/fieldManager');

/**
 * Crea un FlexibleFlowContext a partir de los parámetros legacy
 * @param {string} from - Teléfono del usuario
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto de Azure Functions
 * @param {Object} options - Opciones adicionales
 * @returns {FlexibleFlowContext}
 */
function crearContexto(from, session, context, options = {}) {
  const datos = fieldManager.parseDatosTemp(session.DatosTemp);

  return createFlexibleFlowContext(from, session, context, {
    flowName: options.flowName || datos.tipoReporte || 'FLEXIBLE',
    tipoReporte: datos.tipoReporte,
    ...options,
  });
}

/**
 * Wrapper que convierte una función con FlexibleFlowContext
 * a la firma legacy (from, texto, session, context)
 *
 * @param {Function} fn - Función que recibe (ctx, mensaje, ...args)
 * @param {Object} options - Opciones para el contexto
 * @returns {Function} - Función con firma legacy
 */
function withContext(fn, options = {}) {
  return async function (from, mensaje, session, context, ...extraArgs) {
    const ctx = crearContexto(from, session, context, options);

    try {
      return await fn(ctx, mensaje, ...extraArgs);
    } catch (error) {
      ctx.registrarError('Error en handler con contexto', error);
      throw error;
    }
  };
}

/**
 * Decorator para métodos de clase que usan FlexibleFlowContext
 * Convierte automáticamente los parámetros legacy a contexto
 *
 * @param {Object} options - Opciones para el contexto
 * @returns {Function} - Decorator
 */
function useFlexibleContext(options = {}) {
  return function (_target, _propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (from, mensaje, session, context, ...extraArgs) {
      const ctx = crearContexto(from, session, context, options);
      return originalMethod.call(this, ctx, mensaje, ...extraArgs);
    };

    return descriptor;
  };
}

/**
 * Ejecuta una función con FlexibleFlowContext de forma inline
 * Útil para migrar funciones individuales sin modificar la firma
 *
 * @param {string} from - Teléfono del usuario
 * @param {Object} session - Sesión actual
 * @param {Object} context - Contexto de Azure Functions
 * @param {Function} fn - Función que recibe el contexto
 * @returns {Promise<*>} - Resultado de la función
 */
async function ejecutarConContexto(from, session, context, fn) {
  const ctx = crearContexto(from, session, context);
  return fn(ctx);
}

module.exports = {
  crearContexto,
  withContext,
  useFlexibleContext,
  ejecutarConContexto,
  // Re-exportar para conveniencia
  createFlexibleFlowContext,
};
