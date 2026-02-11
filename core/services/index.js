/**
 * SIGN BOT - Servicios (Barrel File)
 * Exporta todos los servicios desde un unico punto
 *
 * Uso:
 * const { docusignService, whatsappService, rateLimiter, logger } = require('./services');
 */

// Infrastructure Services
const rateLimiter = require('./infrastructure/rateLimiter');
const { logger, handleError, withErrorHandling } = require('./infrastructure/errorHandler');
const metricsService = require('./infrastructure/metricsService');
const correlationService = require('./infrastructure/correlationService');
const deadLetterService = require('./infrastructure/deadLetterService');
const circuitBreaker = require('./infrastructure/circuitBreaker');

// External Services
const whatsappService = require('./external/whatsappService');
const docusignService = require('./external/docusignService');
const teamsService = require('./external/teamsService');

// Storage Services
const databaseService = require('./storage/databaseService');
const connectionPool = require('./storage/connectionPool');
const blobService = require('./storage/blobService');

// Processing Services
const backgroundProcessor = require('./processing/backgroundProcessor');
const sessionTimeoutService = require('./processing/sessionTimeoutService');

module.exports = {
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
  docusignService,
  teamsService,

  // Storage
  databaseService,
  db: databaseService, // Alias corto
  connectionPool,
  blobService,

  // Processing
  backgroundProcessor,
  sessionTimeoutService,
};
