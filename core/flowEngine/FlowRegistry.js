/**
 * AC FIXBOT - FlowRegistry
 * Registro central de flujos del bot
 * Permite agregar/eliminar flujos sin modificar código core
 *
 * @module core/flowEngine/FlowRegistry
 */

const { createFlowContext } = require('./FlowContext');
const { logger } = require('../services/infrastructure/errorHandler');

/**
 * @typedef {Object} FlowDefinition
 * @property {string} nombre - Nombre único del flujo
 * @property {string[]} estados - Estados que maneja este flujo
 * @property {Object.<string, string>} botones - Mapeo buttonId -> método handler
 * @property {Function} [iniciar] - Método para iniciar el flujo
 * @property {Function} [procesar] - Método para procesar mensajes
 * @property {Object} handlers - Handlers específicos por estado
 */

/**
 * Registro central de flujos
 * Singleton que mantiene todos los flujos registrados
 */
class FlowRegistry {
  constructor() {
    /** @type {Map<string, FlowDefinition>} */
    this.flujos = new Map();

    /** @type {Map<string, string>} Estado -> nombre del flujo */
    this.estadoAFlujo = new Map();

    /** @type {Map<string, {flujo: string, handler: string, params?: any}>} */
    this.botonAHandler = new Map();

    /** @type {boolean} */
    this.inicializado = false;
  }

  /**
   * Registra un nuevo flujo
   * @param {FlowDefinition} flujo - Definición del flujo
   * @returns {FlowRegistry} - this para chaining
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

    logger.info(`[FlowRegistry] Flujo registrado: ${flujo.nombre}`, {
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
    logger.info(`[FlowRegistry] Flujo desregistrado: ${nombre}`);
    return true;
  }

  /**
   * Obtiene un flujo por nombre
   * @param {string} nombre
   * @returns {FlowDefinition|null}
   */
  obtener(nombre) {
    return this.flujos.get(nombre) || null;
  }

  /**
   * Obtiene el flujo que maneja un estado
   * @param {string} estado
   * @returns {FlowDefinition|null}
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
      logger.warn(`[FlowRegistry] Handler no encontrado: ${handlerName} en flujo ${flujo.nombre}`);
      return false;
    }

    // Crear contexto
    const ctx = createFlowContext({
      from,
      session,
      azureContext,
      flujoNombre: flujo.nombre,
    });

    try {
      ctx.iniciarTimer();
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
      logger.warn(`[FlowRegistry] Flujo no encontrado para botón: ${botonId}`);
      return false;
    }

    const handler = flujo[config.handler];
    if (typeof handler !== 'function') {
      logger.warn(`[FlowRegistry] Handler ${config.handler} no encontrado en ${config.flujo}`);
      return false;
    }

    // Crear contexto
    const ctx = createFlowContext({
      from,
      session,
      azureContext,
      flujoNombre: flujo.nombre,
    });

    try {
      ctx.iniciarTimer(`${flujo.nombre}_boton`);
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
}

// Singleton
const registry = new FlowRegistry();

module.exports = {
  FlowRegistry,
  registry,
};
