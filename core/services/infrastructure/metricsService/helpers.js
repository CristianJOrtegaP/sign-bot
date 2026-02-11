/**
 * Sign Bot - Métricas: Funciones Helper
 * Funciones auxiliares para cálculos de métricas avanzadas
 */

const { metrics, MAX_RAW_TIMINGS, LATENCY_BUCKETS, SLA_TARGETS } = require('./state');

/**
 * Calcula percentiles de un array de valores
 */
function calculatePercentiles(values, percentiles = [50, 75, 95, 99]) {
  if (values.length === 0) {
    return {};
  }

  const sorted = [...values].sort((a, b) => a - b);
  const result = {};

  for (const p of percentiles) {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    result[`p${p}`] = sorted[Math.max(0, index)];
  }

  return result;
}

/**
 * Actualiza histograma de latencia
 */
function updateLatencyHistogram(operationName, duration) {
  let histogram = metrics.latencyHistograms.get(operationName);
  if (!histogram) {
    histogram = {};
    for (const bucket of LATENCY_BUCKETS) {
      histogram[`<${bucket}ms`] = 0;
    }
    histogram[`>${LATENCY_BUCKETS[LATENCY_BUCKETS.length - 1]}ms`] = 0;
    metrics.latencyHistograms.set(operationName, histogram);
  }

  let bucketFound = false;
  for (const bucket of LATENCY_BUCKETS) {
    if (duration < bucket) {
      histogram[`<${bucket}ms`]++;
      bucketFound = true;
      break;
    }
  }

  if (!bucketFound) {
    histogram[`>${LATENCY_BUCKETS[LATENCY_BUCKETS.length - 1]}ms`]++;
  }
}

/**
 * Actualiza tracking de SLA compliance
 */
function updateSlaTracking(operationName, duration, success = true) {
  let sla = metrics.slaTracking.get(operationName);
  if (!sla) {
    const target = SLA_TARGETS[operationName] || SLA_TARGETS.default;
    sla = {
      target,
      within: 0,
      exceeded: 0,
      successCount: 0,
      errorCount: 0,
    };
    metrics.slaTracking.set(operationName, sla);
  }

  if (duration <= sla.target) {
    sla.within++;
  } else {
    sla.exceeded++;
  }

  if (success) {
    sla.successCount++;
  } else {
    sla.errorCount++;
  }
}

/**
 * Actualiza raw timings para cálculo de percentiles
 */
function updateRawTimings(operationName, duration) {
  let timings = metrics.rawTimings.get(operationName);
  if (!timings) {
    timings = [];
    metrics.rawTimings.set(operationName, timings);
  }

  timings.push(duration);

  // Mantener solo los últimos MAX_RAW_TIMINGS
  if (timings.length > MAX_RAW_TIMINGS) {
    timings.shift();
  }
}

/**
 * Actualiza error rate
 */
function updateErrorRate(operationName, isError = false) {
  let errorRate = metrics.errorRates.get(operationName);
  if (!errorRate) {
    errorRate = { total: 0, errors: 0 };
    metrics.errorRates.set(operationName, errorRate);
  }

  errorRate.total++;
  if (isError) {
    errorRate.errors++;
  }
}

module.exports = {
  calculatePercentiles,
  updateLatencyHistogram,
  updateSlaTracking,
  updateRawTimings,
  updateErrorRate,
};
