/**
 * AC FIXBOT - Health Check Endpoint
 * Verifica el estado de los servicios principales
 *
 * Endpoint:
 * - GET /api/health
 */

const connectionPool = require('../core/services/storage/connectionPool');
const security = require('../core/services/infrastructure/securityService');
const { applySecurityHeaders } = require('../core/middleware/securityHeaders');
const { getBreaker, SERVICES } = require('../core/services/infrastructure/circuitBreaker');
const deadLetterService = require('../core/services/infrastructure/deadLetterService');
const config = require('../core/config');

// ==============================================================
// HELPER FUNCTIONS - Cada check es una función separada
// ==============================================================

/**
 * Check 1: Database connection (FASE 2: Enhanced con verificación de tablas)
 */
async function checkDatabase(startTime) {
  try {
    const pool = await connectionPool.getPool();

    // Check 1a: Conexión básica
    await pool.request().query('SELECT 1 as test');

    // Check 1b: Verificar tablas críticas existen
    const tables = await pool.request().query(`
            SELECT TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_NAME IN ('SesionesChat', 'MensajesProcessados', 'DeadLetterMessages', 'Reportes')
        `);

    const expectedTables = [
      'SesionesChat',
      'MensajesProcessados',
      'DeadLetterMessages',
      'Reportes',
    ];
    const foundTables = tables.recordset.map((t) => t.TABLE_NAME);
    const missingTables = expectedTables.filter((t) => !foundTables.includes(t));

    // Check 1c: Verificar performance de pool
    const poolStats = {
      size: pool.size,
      available: pool.available,
      pending: pool.pending,
      borrowed: pool.borrowed,
    };

    const isHealthy = missingTables.length === 0;

    return {
      status: isHealthy ? 'healthy' : 'degraded',
      message: isHealthy ? 'Connection successful' : `Missing tables: ${missingTables.join(', ')}`,
      responseTimeMs: Date.now() - startTime,
      details: {
        tablesFound: foundTables.length,
        tablesExpected: expectedTables.length,
        missingTables: missingTables.length > 0 ? missingTables : undefined,
        poolStats,
      },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      message: error.message,
      responseTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Check 2: Required environment variables
 */
function checkConfiguration() {
  const requiredEnvVars = [
    'SQL_CONNECTION_STRING',
    'WHATSAPP_TOKEN',
    'WHATSAPP_PHONE_ID',
    'WHATSAPP_VERIFY_TOKEN',
  ];

  const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
  const isHealthy = missingVars.length === 0;

  return {
    status: isHealthy ? 'healthy' : 'unhealthy',
    message: isHealthy
      ? 'All required environment variables are set'
      : 'Some required environment variables are missing',
    servicesConfigured: isHealthy,
  };
}

/**
 * Check 3: Memory usage
 */
function checkMemory() {
  const memoryUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
  const heapPercentage = Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100);

  return {
    status: heapPercentage < 90 ? 'healthy' : 'warning',
    heapUsedMB,
    heapTotalMB,
    heapPercentage,
  };
}

/**
 * Check 4: Uptime
 */
function checkUptime() {
  return {
    status: 'healthy',
    uptimeSeconds: Math.round(process.uptime()),
  };
}

/**
 * Check 5: Circuit Breakers status
 */
function checkCircuitBreakers() {
  try {
    const aiBreaker = getBreaker(
      config.ai.provider === 'azure-openai' ? SERVICES.AZURE_OPENAI : SERVICES.GEMINI
    );
    const waBreaker = getBreaker(SERVICES.WHATSAPP);

    const circuitBreakers = {
      ai: {
        status: aiBreaker.canExecute().allowed ? 'closed' : 'open',
        provider: config.ai.provider,
        enabled: config.ai.enabled,
      },
      whatsapp: {
        status: waBreaker.canExecute().allowed ? 'closed' : 'open',
      },
    };

    const allClosed =
      circuitBreakers.ai.status === 'closed' && circuitBreakers.whatsapp.status === 'closed';

    return {
      status: allClosed ? 'healthy' : 'degraded',
      services: circuitBreakers,
    };
  } catch (_error) {
    return {
      status: 'unknown',
      message: 'Could not check circuit breakers',
    };
  }
}

/**
 * Check 6: Dead Letter Queue stats
 */
async function checkDeadLetter() {
  try {
    const stats = await deadLetterService.getStats();
    const pendingCount = stats.byStatus?.PENDING?.count || 0;
    const failedCount = stats.byStatus?.FAILED?.count || 0;

    return {
      status: failedCount > 10 ? 'warning' : 'healthy',
      total: stats.total,
      pending: pendingCount,
      failed: failedCount,
      message: stats.error || 'OK',
    };
  } catch (_error) {
    return {
      status: 'unknown',
      message: 'Could not check dead letter queue',
    };
  }
}

/**
 * Check 7: External services configuration
 */
function checkExternalServices() {
  const aiConfigured =
    config.ai.enabled &&
    ((config.ai.provider === 'gemini' && Boolean(config.ai.gemini.apiKey)) ||
      (config.ai.provider === 'azure-openai' && Boolean(config.ai.azureOpenAI.endpoint)));

  const services = {
    ai: {
      configured: aiConfigured,
      provider: config.ai.provider,
      enabled: config.ai.enabled,
    },
    vision: {
      configured: Boolean(config.vision.endpoint) && Boolean(config.vision.apiKey),
    },
    whatsapp: {
      configured: Boolean(config.whatsapp.accessToken) && Boolean(config.whatsapp.phoneNumberId),
    },
  };

  return {
    status: services.whatsapp.configured ? 'healthy' : 'degraded',
    services,
  };
}

/**
 * Check 8: WhatsApp API Active Health Check (FASE 2)
 * Verifica que el API de WhatsApp responda correctamente
 */
async function checkWhatsAppApiActive() {
  if (!config.whatsapp.accessToken || !config.whatsapp.phoneNumberId) {
    return {
      status: 'skipped',
      message: 'WhatsApp not configured',
    };
  }

  try {
    const axios = require('axios');
    const url = `https://graph.facebook.com/v21.0/${config.whatsapp.phoneNumberId}`;

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${config.whatsapp.accessToken}`,
      },
      timeout: 5000,
    });

    return {
      status: response.status === 200 ? 'healthy' : 'degraded',
      message: 'WhatsApp API responding',
      details: {
        phoneNumber: response.data?.display_phone_number,
        verifiedName: response.data?.verified_name,
        qualityRating: response.data?.quality_rating,
      },
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      message: error.response?.data?.error?.message || error.message,
      errorCode: error.response?.status,
    };
  }
}

/**
 * Check 9: AI Provider Active Health Check (FASE 2)
 * Verifica que el proveedor de AI responda
 */
async function checkAiProviderActive() {
  if (!config.ai.enabled) {
    return {
      status: 'skipped',
      message: 'AI not enabled',
    };
  }

  try {
    const axios = require('axios');
    let response;

    if (config.ai.provider === 'gemini') {
      // Test simple request a Gemini
      const model = config.ai.gemini.model || 'gemini-1.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.ai.gemini.apiKey}`;
      response = await axios.post(
        url,
        {
          contents: [
            {
              parts: [{ text: 'test' }],
            },
          ],
        },
        {
          timeout: 5000,
        }
      );

      return {
        status: response.status === 200 ? 'healthy' : 'degraded',
        message: 'Gemini API responding',
        provider: 'gemini',
      };
    }
    if (config.ai.provider === 'azure-openai') {
      // Test Azure OpenAI with a minimal chat completion
      const url = config.ai.azureOpenAI.endpoint;
      const deployment = config.ai.azureOpenAI.deployment || 'gpt-4o-mini';
      response = await axios.post(
        `${url}openai/deployments/${deployment}/chat/completions?api-version=2024-02-01`,
        {
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1,
        },
        {
          headers: {
            'api-key': config.ai.azureOpenAI.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      return {
        status: response.status === 200 ? 'healthy' : 'degraded',
        message: 'Azure OpenAI responding',
        provider: 'azure-openai',
        details: {
          model: response.data?.model,
          deployment: deployment,
        },
      };
    }

    return {
      status: 'unknown',
      message: `Unknown AI provider: ${config.ai.provider}`,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      message: error.response?.data?.error?.message || error.message,
      errorCode: error.response?.status,
      provider: config.ai.provider,
    };
  }
}

/**
 * Check 10: Metrics Service Health (FASE 2)
 */
function checkMetricsService() {
  try {
    const metricsService = require('../core/services/infrastructure/metricsService');
    const summary = metricsService.getMetricsSummary();

    const totalOps = Object.values(summary.operations).reduce((sum, count) => sum + count, 0);

    return {
      status: 'healthy',
      message: 'Metrics service operational',
      details: {
        totalOperations: totalOps,
        operationTypes: Object.keys(summary.operations).length,
        storageEnabled: metricsService.isStorageEnabled(),
        cacheHitRate: summary.cache.hitRate,
      },
    };
  } catch (error) {
    return {
      status: 'degraded',
      message: 'Metrics service unavailable',
      error: error.message,
    };
  }
}

/**
 * Check 11: Redis Cache
 */
function checkRedis() {
  try {
    const redisService = require('../core/services/cache/redisService');
    const stats = redisService.getStats();

    if (!config.redis?.enabled) {
      return { status: 'skipped', message: 'Redis disabled' };
    }

    if (redisService.isUsingFallback()) {
      return {
        status: 'degraded',
        message: 'Using local memory fallback',
        details: stats,
      };
    }

    return {
      status: 'healthy',
      message: 'Redis connected',
      details: stats,
    };
  } catch (error) {
    return { status: 'degraded', message: error.message };
  }
}

/**
 * Check 12: Service Bus
 */
function checkServiceBus() {
  if (!config.isServiceBusEnabled) {
    return { status: 'skipped', message: 'Service Bus disabled' };
  }

  try {
    const serviceBusService = require('../core/services/messaging/serviceBusService');
    const stats = serviceBusService.getStats();

    if (serviceBusService.isUsingFallback()) {
      return {
        status: 'degraded',
        message: 'Using synchronous fallback',
        details: stats,
      };
    }

    return {
      status: 'healthy',
      message: 'Service Bus connected',
      details: stats,
    };
  } catch (error) {
    return { status: 'degraded', message: error.message };
  }
}

/**
 * Check 13: Background Processor
 */
function checkBackgroundProcessor() {
  try {
    const backgroundProcessor = require('../core/services/processing/backgroundProcessor');
    const stats = backgroundProcessor.getProcessingStats();
    const utilization = stats.max > 0 ? stats.active / stats.max : 0;

    return {
      status: utilization >= 0.9 ? 'warning' : 'healthy',
      message: utilization >= 0.9 ? 'Near capacity' : 'OK',
      details: stats,
    };
  } catch (error) {
    return { status: 'unknown', message: error.message };
  }
}

/**
 * Handle rate limiting check
 */
function handleRateLimit(context, clientIp, rateLimit) {
  context.log.warn(`Rate limit excedido para IP ${clientIp}`);
  return {
    status: 429,
    headers: applySecurityHeaders({
      'Content-Type': 'application/json',
      'Retry-After': Math.ceil(rateLimit.resetMs / 1000).toString(),
      'X-RateLimit-Remaining': '0',
    }),
    body: {
      status: 'rate_limited',
      message: 'Too many requests',
      retryAfterMs: rateLimit.resetMs,
    },
  };
}

// ==============================================================
// MAIN HANDLER
// ==============================================================

module.exports = async function (context, req) {
  const timestamp = new Date().toISOString();
  const startTime = Date.now();

  // Rate limiting por IP para prevenir abuso
  const clientIp = security.getClientIp(req);
  const rateLimit = security.checkIpRateLimit(clientIp);

  if (!rateLimit.allowed) {
    context.res = handleRateLimit(context, clientIp, rateLimit);
    return;
  }

  // Ejecutar todos los checks (FASE 2: Agregados checks activos)
  const [dbCheck, deadLetterCheck, whatsappCheck, aiCheck] = await Promise.all([
    checkDatabase(startTime),
    checkDeadLetter(),
    checkWhatsAppApiActive(),
    checkAiProviderActive(),
  ]);

  const configCheck = checkConfiguration();
  const memoryCheck = checkMemory();
  const uptimeCheck = checkUptime();
  const circuitBreakerCheck = checkCircuitBreakers();
  const externalServicesCheck = checkExternalServices();
  const metricsCheck = checkMetricsService();
  const redisCheck = checkRedis();
  const serviceBusCheck = checkServiceBus();
  const bgProcessorCheck = checkBackgroundProcessor();

  // Determinar estado global (FASE 2: Considerar checks activos)
  const isUnhealthy =
    dbCheck.status === 'unhealthy' ||
    configCheck.status === 'unhealthy' ||
    whatsappCheck.status === 'unhealthy';

  const isDegraded =
    dbCheck.status === 'degraded' ||
    deadLetterCheck.status === 'warning' ||
    circuitBreakerCheck.status === 'degraded' ||
    aiCheck.status === 'degraded' ||
    redisCheck.status === 'degraded' ||
    serviceBusCheck.status === 'degraded' ||
    bgProcessorCheck.status === 'warning';

  const health = {
    status: isUnhealthy ? 'unhealthy' : isDegraded ? 'degraded' : 'healthy',
    timestamp,
    version: process.env.npm_package_version || '2.0.0',
    environment: process.env.NODE_ENV || 'development',
    responseTimeMs: Date.now() - startTime,
    checks: {
      database: dbCheck,
      configuration: configCheck,
      memory: memoryCheck,
      uptime: uptimeCheck,
      circuitBreakers: circuitBreakerCheck,
      deadLetter: deadLetterCheck,
      externalServices: externalServicesCheck,
      // FASE 2: Enhanced Health Checks
      whatsappApi: whatsappCheck,
      aiProvider: aiCheck,
      metrics: metricsCheck,
      redis: redisCheck,
      serviceBus: serviceBusCheck,
      backgroundProcessor: bgProcessorCheck,
    },
  };

  // FASE 2: Status code más granular
  const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
  context.log(`Health check completed: ${health.status} (${health.responseTimeMs}ms)`);

  context.res = {
    status: statusCode,
    headers: applySecurityHeaders({ 'Content-Type': 'application/json' }),
    body: health,
  };
};
