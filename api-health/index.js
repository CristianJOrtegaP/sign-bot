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
 * Check 1: Database connection
 */
async function checkDatabase(startTime) {
    try {
        const pool = await connectionPool.getPool();
        await pool.request().query('SELECT 1 as test');
        return {
            status: 'healthy',
            message: 'Connection successful',
            responseTimeMs: Date.now() - startTime
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            message: error.message,
            responseTimeMs: Date.now() - startTime
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
        'WHATSAPP_VERIFY_TOKEN'
    ];

    const missingVars = requiredEnvVars.filter(v => !process.env[v]);
    const isHealthy = missingVars.length === 0;

    return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        message: isHealthy
            ? 'All required environment variables are set'
            : 'Some required environment variables are missing',
        servicesConfigured: isHealthy
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
        heapPercentage
    };
}

/**
 * Check 4: Uptime
 */
function checkUptime() {
    return {
        status: 'healthy',
        uptimeSeconds: Math.round(process.uptime())
    };
}

/**
 * Check 5: Circuit Breakers status
 */
function checkCircuitBreakers() {
    try {
        const aiBreaker = getBreaker(config.ai.provider === 'azure-openai' ? SERVICES.AZURE_OPENAI : SERVICES.GEMINI);
        const waBreaker = getBreaker(SERVICES.WHATSAPP);

        const circuitBreakers = {
            ai: {
                status: aiBreaker.canExecute().allowed ? 'closed' : 'open',
                provider: config.ai.provider,
                enabled: config.ai.enabled
            },
            whatsapp: {
                status: waBreaker.canExecute().allowed ? 'closed' : 'open'
            }
        };

        const allClosed = circuitBreakers.ai.status === 'closed' && circuitBreakers.whatsapp.status === 'closed';

        return {
            status: allClosed ? 'healthy' : 'degraded',
            services: circuitBreakers
        };
    } catch (_error) {
        return {
            status: 'unknown',
            message: 'Could not check circuit breakers'
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
            message: stats.error || 'OK'
        };
    } catch (_error) {
        return {
            status: 'unknown',
            message: 'Could not check dead letter queue'
        };
    }
}

/**
 * Check 7: External services configuration
 */
function checkExternalServices() {
    const aiConfigured = config.ai.enabled && (
        (config.ai.provider === 'gemini' && Boolean(config.ai.gemini.apiKey)) ||
        (config.ai.provider === 'azure-openai' && Boolean(config.ai.azureOpenAI.endpoint))
    );

    const services = {
        ai: {
            configured: aiConfigured,
            provider: config.ai.provider,
            enabled: config.ai.enabled
        },
        vision: {
            configured: Boolean(config.vision.endpoint) && Boolean(config.vision.apiKey)
        },
        whatsapp: {
            configured: Boolean(config.whatsapp.accessToken) && Boolean(config.whatsapp.phoneNumberId)
        }
    };

    return {
        status: services.whatsapp.configured ? 'healthy' : 'degraded',
        services
    };
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
            'X-RateLimit-Remaining': '0'
        }),
        body: {
            status: 'rate_limited',
            message: 'Too many requests',
            retryAfterMs: rateLimit.resetMs
        }
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

    // Ejecutar todos los checks
    const [dbCheck, deadLetterCheck] = await Promise.all([
        checkDatabase(startTime),
        checkDeadLetter()
    ]);

    const configCheck = checkConfiguration();
    const memoryCheck = checkMemory();
    const uptimeCheck = checkUptime();
    const circuitBreakerCheck = checkCircuitBreakers();
    const externalServicesCheck = checkExternalServices();

    // Determinar estado global
    const isUnhealthy = dbCheck.status === 'unhealthy' || configCheck.status === 'unhealthy';

    const health = {
        status: isUnhealthy ? 'unhealthy' : 'healthy',
        timestamp,
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        responseTimeMs: Date.now() - startTime,
        checks: {
            database: dbCheck,
            configuration: configCheck,
            memory: memoryCheck,
            uptime: uptimeCheck,
            circuitBreakers: circuitBreakerCheck,
            deadLetter: deadLetterCheck,
            externalServices: externalServicesCheck
        }
    };

    const statusCode = health.status === 'healthy' ? 200 : 503;
    context.log(`Health check completed: ${health.status} (${health.responseTimeMs}ms)`);

    context.res = {
        status: statusCode,
        headers: applySecurityHeaders({ 'Content-Type': 'application/json' }),
        body: health
    };
};
