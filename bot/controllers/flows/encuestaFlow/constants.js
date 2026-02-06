/**
 * AC FIXBOT - Constantes del Flujo de Encuesta
 * Tiempos de cache y otras constantes configurables
 */

// TTL del cache de encuestas activas (30 minutos)
const CACHE_TTL_MS = 30 * 60 * 1000;

// TTL del cache de preguntas por tipo (1 hora)
const PREGUNTAS_CACHE_TTL_MS = 60 * 60 * 1000;

module.exports = {
  CACHE_TTL_MS,
  PREGUNTAS_CACHE_TTL_MS,
};
