/**
 * AC FIXBOT - Servicios (Barrel File)
 * Exporta todos los servicios desde un unico punto
 *
 * Uso:
 * const { aiService, whatsappService, rateLimiter, logger } = require('./services');
 */

// AI Services
const aiService = require('./ai/aiService');
const intentService = require('./ai/intentService');
const visionService = require('./ai/visionService');

// Infrastructure Services
const rateLimiter = require('./infrastructure/rateLimiter');
const { logger, handleError, withErrorHandling } = require('./infrastructure/errorHandler');
const metricsService = require('./infrastructure/metricsService');
const correlationService = require('./infrastructure/correlationService');
const deadLetterService = require('./infrastructure/deadLetterService');
const circuitBreaker = require('./infrastructure/circuitBreaker');

// External Services
const whatsappService = require('./external/whatsappService');

// Storage Services
const databaseService = require('./storage/databaseService');
const connectionPool = require('./storage/connectionPool');
const blobService = require('./storage/blobService');

// Processing Services
const backgroundProcessor = require('./processing/backgroundProcessor');
const sessionTimeoutService = require('./processing/sessionTimeoutService');
const imageProcessor = require('./processing/imageProcessor');

module.exports = {
    // AI
    aiService,
    intentService,
    visionService,
    detectIntent: intentService.detectIntent,

    // Core
    rateLimiter,
    logger,
    handleError,
    withErrorHandling,
    metricsService,
    correlationService,
    deadLetterService,
    circuitBreaker,

    // External
    whatsappService,

    // Storage
    databaseService,
    db: databaseService, // Alias corto
    connectionPool,
    blobService,

    // Processing
    backgroundProcessor,
    sessionTimeoutService,
    imageProcessor
};
