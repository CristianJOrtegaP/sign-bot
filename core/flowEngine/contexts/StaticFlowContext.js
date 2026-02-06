/**
 * AC FIXBOT - StaticFlowContext
 * Contexto para flujos estáticos/secuenciales (encuesta, consulta)
 *
 * Extiende BaseContext con métodos específicos para flujos
 * que siguen una secuencia predefinida de pasos.
 *
 * @module core/flowEngine/contexts/StaticFlowContext
 */

const BaseContext = require('./BaseContext');

/**
 * Contexto para flujos estáticos/secuenciales
 * Usado para: consultaFlow, encuestaFlow
 */
class StaticFlowContext extends BaseContext {
  /**
   * @param {string} from - Número de teléfono del usuario
   * @param {Object} session - Sesión actual del usuario
   * @param {Object} context - Contexto de Azure Functions
   * @param {Object} options - Opciones adicionales
   * @param {string} options.flowName - Nombre del flujo
   * @param {number} options.pasoActual - Paso actual (opcional)
   */
  constructor(from, session, context, options = {}) {
    super(from, session, context, options);
    this.pasoActual = options.pasoActual || 0;
    this.totalPasos = options.totalPasos || 0;
  }

  // ==============================================================
  // MÉTODOS ESPECÍFICOS DE FLUJOS ESTÁTICOS
  // ==============================================================

  /**
   * Avanza al siguiente paso del flujo
   * @param {string} nuevoEstado - Estado del siguiente paso
   * @param {Object} datos - Datos a guardar
   */
  async avanzarPaso(nuevoEstado, datos = null) {
    this.pasoActual++;
    await this.cambiarEstado(nuevoEstado, datos, `Avance a paso ${this.pasoActual}`);
    this.log(`Avanzando a paso ${this.pasoActual}: ${nuevoEstado}`);
  }

  /**
   * Retrocede al paso anterior
   * @param {string} estadoAnterior - Estado del paso anterior
   */
  async retrocederPaso(estadoAnterior) {
    if (this.pasoActual > 0) {
      this.pasoActual--;
      await this.cambiarEstado(estadoAnterior, null, `Retroceso a paso ${this.pasoActual}`);
      this.log(`Retrocediendo a paso ${this.pasoActual}: ${estadoAnterior}`);
    }
  }

  /**
   * Obtiene el progreso actual del flujo
   * @returns {Object} { paso, total, porcentaje }
   */
  getProgreso() {
    const porcentaje =
      this.totalPasos > 0 ? Math.round((this.pasoActual / this.totalPasos) * 100) : 0;
    return {
      paso: this.pasoActual,
      total: this.totalPasos,
      porcentaje,
    };
  }

  /**
   * Verifica si el flujo está completo
   * @returns {boolean}
   */
  estaCompleto() {
    return this.totalPasos > 0 && this.pasoActual >= this.totalPasos;
  }

  /**
   * Completa el flujo exitosamente
   * @param {string} motivo - Motivo de completación
   */
  async completar(motivo = 'Flujo completado exitosamente') {
    await this.finalizar(motivo);
    this.terminarTimer({ resultado: 'completado' });
    this.log(`Flujo completado: ${motivo}`);
  }

  /**
   * Aborta el flujo por error o timeout
   * @param {string} motivo - Motivo de aborto
   */
  async abortar(motivo = 'Flujo abortado') {
    await this.cancelar(motivo);
    this.terminarTimer({ resultado: 'abortado' });
    this.warn(`Flujo abortado: ${motivo}`);
  }
}

/**
 * Factory function para crear StaticFlowContext
 * @param {string} from - Número de teléfono
 * @param {Object} session - Sesión del usuario
 * @param {Object} context - Contexto de Azure
 * @param {Object} options - Opciones adicionales
 * @returns {StaticFlowContext}
 */
function createStaticFlowContext(from, session, context, options = {}) {
  return new StaticFlowContext(from, session, context, options);
}

module.exports = StaticFlowContext;
module.exports.createStaticFlowContext = createStaticFlowContext;
