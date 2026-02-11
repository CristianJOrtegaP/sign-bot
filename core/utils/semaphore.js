/**
 * Sign Bot - Semáforo de concurrencia
 * Limita la cantidad de operaciones asíncronas ejecutándose simultáneamente
 */

const { logger } = require('../services/infrastructure/errorHandler');

class Semaphore {
  /**
   * @param {number} maxConcurrent - Máximo de operaciones concurrentes
   * @param {string} name - Nombre para logging
   */
  constructor(maxConcurrent, name = 'Semaphore') {
    this._max = maxConcurrent;
    this._active = 0;
    this._queue = [];
    this._name = name;
    this._rejected = 0;
  }

  get active() {
    return this._active;
  }

  get queued() {
    return this._queue.length;
  }

  /**
   * Ejecuta fn respetando el límite de concurrencia.
   * Si el límite está alcanzado, espera en cola.
   * @param {Function} fn - Función async a ejecutar
   * @returns {Promise<any>}
   */
  async run(fn) {
    await this._acquire();
    try {
      return await fn();
    } finally {
      this._release();
    }
  }

  /**
   * Intenta ejecutar inmediatamente. Si no hay capacidad, retorna null.
   * @param {Function} fn - Función async a ejecutar
   * @returns {Promise<any>|null}
   */
  tryRun(fn) {
    if (this._active >= this._max) {
      this._rejected++;
      logger.warn(`[${this._name}] Capacidad alcanzada, operación rechazada`, {
        active: this._active,
        max: this._max,
        rejected: this._rejected,
      });
      return null;
    }
    return this.run(fn);
  }

  /** @private */
  _acquire() {
    if (this._active < this._max) {
      this._active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._queue.push(resolve);
    });
  }

  /** @private */
  _release() {
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      next();
    } else {
      this._active--;
    }
  }

  stats() {
    return {
      active: this._active,
      queued: this._queue.length,
      max: this._max,
      totalRejected: this._rejected,
    };
  }
}

module.exports = { Semaphore };
