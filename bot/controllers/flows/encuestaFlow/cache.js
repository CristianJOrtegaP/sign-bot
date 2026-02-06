/**
 * AC FIXBOT - Sistema de Cache del Flujo de Encuesta
 * Cache en memoria para encuestas activas y preguntas
 */

const EncuestaRepository = require('../../../repositories/EncuestaRepository');
const { CACHE_TTL_MS, PREGUNTAS_CACHE_TTL_MS } = require('./constants');

// ============================================
// CACHE EN MEMORIA PARA ENCUESTAS ACTIVAS
// Incluye PreguntaActual, TipoEncuestaId, NumeroPreguntas y Preguntas
// ============================================
const encuestaCache = new Map();

// Cache de preguntas por tipo (estático, no cambia frecuentemente)
const preguntasCache = new Map();

/**
 * Obtiene las preguntas de un tipo de encuesta (con cache)
 * @param {number} tipoEncuestaId - ID del tipo de encuesta
 * @returns {Promise<Array>}
 */
async function getPreguntasCached(tipoEncuestaId) {
  const cacheKey = `tipo_${tipoEncuestaId}`;
  const cached = preguntasCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < PREGUNTAS_CACHE_TTL_MS) {
    return cached.preguntas;
  }

  const preguntas = await EncuestaRepository.getPreguntasByTipo(tipoEncuestaId);
  preguntasCache.set(cacheKey, { preguntas, timestamp: Date.now() });
  return preguntas;
}

/**
 * Obtiene datos de encuesta del cache o BD (query optimizada)
 * Incluye: encuestaId, reporteId, numeroTicket, preguntaActual, tipoEncuestaId, numeroPreguntas, preguntas
 * @param {string} telefono - Teléfono del usuario
 * @param {Object} context - Contexto con función log
 * @returns {Promise<Object|null>}
 */
async function getEncuestaCached(telefono, context) {
  const cached = encuestaCache.get(telefono);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    context?.log(
      `[Cache] encuesta hit: ${cached.encuestaId}, preguntaActual: ${cached.preguntaActual}`
    );
    return cached;
  }

  // Query optimizada: obtiene TODO en una sola llamada (incluye info de tipo)
  const encuesta = await EncuestaRepository.getEncuestaCompletaByTelefono(telefono, false);
  if (encuesta) {
    // Obtener preguntas del tipo de encuesta
    const preguntas = encuesta.TipoEncuestaId
      ? await getPreguntasCached(encuesta.TipoEncuestaId)
      : [];

    const data = {
      encuestaId: encuesta.EncuestaId,
      reporteId: encuesta.ReporteId,
      numeroTicket: encuesta.NumeroTicket,
      preguntaActual: encuesta.PreguntaActual ?? 0,
      estado: encuesta.Estado,
      tipoEncuestaId: encuesta.TipoEncuestaId,
      tipoEncuestaCodigo: encuesta.TipoEncuestaCodigo,
      numeroPreguntas: encuesta.NumeroPreguntas || 6,
      tienePasoComentario: encuesta.TienePasoComentario ?? true,
      mensajeAgradecimiento: encuesta.MensajeAgradecimiento,
      preguntas: preguntas,
      timestamp: Date.now(),
    };
    encuestaCache.set(telefono, data);
    context?.log(
      `[Cache] encuesta set: ${data.encuestaId}, preguntaActual: ${data.preguntaActual}, numPreguntas: ${data.numeroPreguntas}`
    );
    return data;
  }

  return null;
}

/**
 * Actualiza el cache local con nueva preguntaActual
 * @param {string} telefono - Teléfono del usuario
 * @param {number} nuevaPreguntaActual - Nueva pregunta actual
 */
function updateCachePregunta(telefono, nuevaPreguntaActual) {
  const cached = encuestaCache.get(telefono);
  if (cached) {
    cached.preguntaActual = nuevaPreguntaActual;
    cached.timestamp = Date.now();
  }
}

/**
 * Guarda encuestaId en cache con datos del tipo de encuesta
 * @param {string} telefono
 * @param {number} encuestaId
 * @param {number} reporteId
 * @param {string} numeroTicket
 * @param {Object} tipoEncuesta - Datos del tipo de encuesta (opcional)
 * @param {Array} preguntas - Preguntas de la encuesta (opcional)
 */
function setEncuestaCache(
  telefono,
  encuestaId,
  reporteId,
  numeroTicket,
  tipoEncuesta = null,
  preguntas = []
) {
  encuestaCache.set(telefono, {
    encuestaId,
    reporteId,
    numeroTicket,
    preguntaActual: 0,
    estado: 'ENVIADA',
    tipoEncuestaId: tipoEncuesta?.TipoEncuestaId || null,
    tipoEncuestaCodigo: tipoEncuesta?.Codigo || 'SATISFACCION_SERVICIO',
    numeroPreguntas: tipoEncuesta?.NumeroPreguntas || 6,
    tienePasoComentario: tipoEncuesta?.TienePasoComentario ?? true,
    mensajeAgradecimiento: tipoEncuesta?.MensajeAgradecimiento || null,
    preguntas: preguntas,
    timestamp: Date.now(),
  });
}

/**
 * Limpia cache para un teléfono
 * @param {string} telefono - Teléfono del usuario
 */
function clearEncuestaCache(telefono) {
  encuestaCache.delete(telefono);
}

/**
 * Obtiene el cache raw de encuesta (para acceso directo sin async)
 * @param {string} telefono - Teléfono del usuario
 * @returns {Object|undefined}
 */
function getEncuestaCacheRaw(telefono) {
  return encuestaCache.get(telefono);
}

// Limpieza periódica del cache (cada 10 minutos)
// .unref() permite que el proceso termine sin esperar este timer
setInterval(
  () => {
    const now = Date.now();
    for (const [telefono, data] of encuestaCache.entries()) {
      if (now - data.timestamp > CACHE_TTL_MS) {
        encuestaCache.delete(telefono);
      }
    }
  },
  10 * 60 * 1000
).unref();

module.exports = {
  encuestaCache,
  preguntasCache,
  getEncuestaCached,
  setEncuestaCache,
  clearEncuestaCache,
  updateCachePregunta,
  getPreguntasCached,
  getEncuestaCacheRaw,
};
