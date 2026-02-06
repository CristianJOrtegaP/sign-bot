/**
 * AC FIXBOT - StaticFlowRegistry
 * Registro central de flujos estáticos/secuenciales
 * Permite agregar/eliminar flujos sin modificar código core
 *
 * @module core/flowEngine/StaticFlowRegistry
 */

const { createStaticFlowContext } = require('./contexts/StaticFlowContext');
const { logger } = require('../services/infrastructure/errorHandler');

/**
 * @typedef {Object} StaticFlowDefinition
 * @property {string} nombre - Nombre único del flujo
 * @property {string[]} estados - Estados que maneja este flujo
 * @property {Object.<string, string|{handler: string, params?: *}>} botones - Mapeo buttonId -> handler name o config
 * @property {Function} [iniciar] - Método para iniciar el flujo
 * @property {Function} [procesar] - Método para procesar mensajes
 * @property {Object} handlers - Handlers específicos por estado
 */

/**
 * Registro central de flujos estáticos
 * Singleton que mantiene todos los flujos registrados
 */
class StaticFlowRegistry {
  constructor() {
    /** @type {Map<string, StaticFlowDefinition>} */
    this.flujos = new Map();

    /** @type {Map<string, string>} Estado -> nombre del flujo */
    this.estadoAFlujo = new Map();

    /** @type {Map<string, {flujo: string, handler: string, params?: any}>} */
    this.botonAHandler = new Map();

    /** @type {boolean} */
    this.inicializado = false;
  }

  /**
   * Registra un nuevo flujo estático
   * @param {StaticFlowDefinition} flujo - Definición del flujo
   * @returns {StaticFlowRegistry} - this para chaining
   */
  registrar(flujo) {
    if (!flujo.nombre) {
      throw new Error('El flujo debe tener un nombre');
    }

    // Guardar flujo
    this.flujos.set(flujo.nombre, flujo);

    // Indexar estados
    if (flujo.estados && Array.isArray(flujo.estados)) {
      for (const estado of flujo.estados) {
        this.estadoAFlujo.set(estado, flujo.nombre);
      }
    }

    // Indexar botones
    if (flujo.botones && typeof flujo.botones === 'object') {
      for (const [botonId, config] of Object.entries(flujo.botones)) {
        if (typeof config === 'string') {
          // Formato simple: { btn_id: 'handlerName' }
          this.botonAHandler.set(botonId, { flujo: flujo.nombre, handler: config });
        } else {
          // Formato extendido: { btn_id: { handler: 'name', params: {...} } }
          this.botonAHandler.set(botonId, { flujo: flujo.nombre, ...config });
        }
      }
    }

    logger.info(`[StaticFlowRegistry] Flujo registrado: ${flujo.nombre}`, {
      estados: flujo.estados?.length || 0,
      botones: Object.keys(flujo.botones || {}).length,
    });

    return this;
  }

  /**
   * Desregistra un flujo
   * @param {string} nombre - Nombre del flujo a remover
   * @returns {boolean} - true si se removió
   */
  desregistrar(nombre) {
    const flujo = this.flujos.get(nombre);
    if (!flujo) {
      return false;
    }

    // Remover de índice de estados
    if (flujo.estados) {
      for (const estado of flujo.estados) {
        this.estadoAFlujo.delete(estado);
      }
    }

    // Remover de índice de botones
    if (flujo.botones) {
      for (const botonId of Object.keys(flujo.botones)) {
        this.botonAHandler.delete(botonId);
      }
    }

    this.flujos.delete(nombre);
    logger.info(`[StaticFlowRegistry] Flujo desregistrado: ${nombre}`);
    return true;
  }

  /**
   * Obtiene un flujo por nombre
   * @param {string} nombre
   * @returns {StaticFlowDefinition|null}
   */
  obtener(nombre) {
    return this.flujos.get(nombre) || null;
  }

  /**
   * Obtiene el flujo que maneja un estado
   * @param {string} estado
   * @returns {StaticFlowDefinition|null}
   */
  obtenerPorEstado(estado) {
    const nombreFlujo = this.estadoAFlujo.get(estado);
    if (!nombreFlujo) {
      return null;
    }
    return this.flujos.get(nombreFlujo) || null;
  }

  /**
   * Verifica si hay un flujo para un estado
   * @param {string} estado
   * @returns {boolean}
   */
  tieneHandlerParaEstado(estado) {
    return this.estadoAFlujo.has(estado);
  }

  /**
   * Obtiene la configuración de handler para un botón
   * @param {string} botonId
   * @returns {{flujo: string, handler: string, params?: any}|null}
   */
  obtenerHandlerBoton(botonId) {
    return this.botonAHandler.get(botonId) || null;
  }

  /**
   * Procesa un mensaje para un estado dado
   * @param {string} from - Teléfono del usuario
   * @param {string} mensaje - Mensaje del usuario
   * @param {Object} session - Sesión actual
   * @param {Object} azureContext - Contexto de Azure
   * @returns {Promise<boolean>} - true si se procesó
   */
  async procesarMensaje(from, mensaje, session, azureContext) {
    const flujo = this.obtenerPorEstado(session.Estado);
    if (!flujo) {
      return false;
    }

    // Determinar qué handler usar
    const handlerName = flujo.handlers?.[session.Estado] || 'procesar';
    const handler = flujo[handlerName];

    if (typeof handler !== 'function') {
      logger.warn(
        `[StaticFlowRegistry] Handler no encontrado: ${handlerName} en flujo ${flujo.nombre}`
      );
      return false;
    }

    // Crear contexto estático
    const ctx = createStaticFlowContext(from, session, azureContext, {
      flowName: flujo.nombre,
    });

    try {
      ctx.iniciarTimer('procesar');
      await handler.call(flujo, ctx, mensaje, session);
      ctx.terminarTimer({ resultado: 'ok' });
      return true;
    } catch (error) {
      ctx.registrarError('Error procesando mensaje', error);
      ctx.terminarTimer({ resultado: 'error' });
      throw error;
    }
  }

  /**
   * Procesa un botón presionado
   * @param {string} from - Teléfono del usuario
   * @param {string} botonId - ID del botón presionado
   * @param {Object} session - Sesión actual
   * @param {Object} azureContext - Contexto de Azure
   * @returns {Promise<boolean>} - true si se procesó
   */
  async procesarBoton(from, botonId, session, azureContext) {
    const config = this.botonAHandler.get(botonId);
    if (!config) {
      return false;
    }

    const flujo = this.flujos.get(config.flujo);
    if (!flujo) {
      logger.warn(`[StaticFlowRegistry] Flujo no encontrado para botón: ${botonId}`);
      return false;
    }

    const handler = flujo[config.handler];
    if (typeof handler !== 'function') {
      logger.warn(
        `[StaticFlowRegistry] Handler ${config.handler} no encontrado en ${config.flujo}`
      );
      return false;
    }

    // Crear contexto estático
    const ctx = createStaticFlowContext(from, session, azureContext, {
      flowName: flujo.nombre,
    });

    try {
      ctx.iniciarTimer(`boton_${botonId}`);
      // Pasar params si existen (ej: rating value)
      if (config.params !== undefined) {
        await handler.call(flujo, ctx, config.params, session);
      } else {
        await handler.call(flujo, ctx, session);
      }
      ctx.terminarTimer({ resultado: 'ok', boton: botonId });
      return true;
    } catch (error) {
      ctx.registrarError(`Error procesando botón ${botonId}`, error);
      ctx.terminarTimer({ resultado: 'error', boton: botonId });
      throw error;
    }
  }

  /**
   * Lista todos los flujos registrados
   * @returns {string[]}
   */
  listarFlujos() {
    return Array.from(this.flujos.keys());
  }

  /**
   * Obtiene estadísticas del registry
   * @returns {Object}
   */
  getStats() {
    return {
      totalFlujos: this.flujos.size,
      totalEstados: this.estadoAFlujo.size,
      totalBotones: this.botonAHandler.size,
      flujos: this.listarFlujos(),
    };
  }

  /**
   * Limpia todos los flujos registrados
   * Útil para testing
   */
  limpiar() {
    this.flujos.clear();
    this.estadoAFlujo.clear();
    this.botonAHandler.clear();
    this.inicializado = false;
  }
}

// Singleton
const staticRegistry = new StaticFlowRegistry();

module.exports = {
  StaticFlowRegistry,
  staticRegistry,
  // Alias para compatibilidad
  FlowRegistry: StaticFlowRegistry,
  registry: staticRegistry,
};
