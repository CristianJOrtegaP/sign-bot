/**
 * AC FIXBOT - Métricas: Estado y Configuración
 * Contiene el objeto metrics en memoria y constantes de configuración
 */

// Métricas acumuladas en memoria
const metrics = {
  operations: new Map(), // Contador de operaciones por tipo
  timings: new Map(), // Tiempos promedio por operación
  errors: new Map(), // Contadores de errores por tipo
  cache: {
    hits: 0,
    misses: 0,
  },
  // FASE 2: Enhanced Metrics
  latencyHistograms: new Map(), // Histogramas de latencia por operación
  rawTimings: new Map(), // Timings raw para cálculo de percentiles (últimos N)
  slaTracking: new Map(), // Tracking de SLA compliance
  errorRates: new Map(), // Error rates por operación
};

// Configuración para enhanced metrics
const MAX_RAW_TIMINGS = 1000; // Mantener últimos 1000 timings para percentiles
const LATENCY_BUCKETS = [50, 100, 200, 500, 1000, 2000, 5000]; // ms
const SLA_TARGETS = {
  'webhook.process': 1000, // 1s SLA para procesamiento de webhook
  'ai.generateResponse': 3000, // 3s SLA para respuesta de AI
  'db.query': 500, // 500ms SLA para queries DB
  'whatsapp.sendMessage': 2000, // 2s SLA para envío WhatsApp
  default: 2000, // 2s SLA default
};

// Nombres de tablas de Azure Storage
const TABLE_NAMES = {
  METRICS: 'ACFixBotMetrics',
  ERRORS: 'ACFixBotErrors',
};

module.exports = {
  metrics,
  MAX_RAW_TIMINGS,
  LATENCY_BUCKETS,
  SLA_TARGETS,
  TABLE_NAMES,
};
