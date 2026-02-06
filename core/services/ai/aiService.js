/**
 * AC FIXBOT - Servicio de IA Configurable
 * Factory/Selector de proveedores de IA (Gemini / Azure OpenAI)
 * Con Circuit Breaker para protección contra fallos en cascada
 *
 * Uso:
 *   - POC: AI_PROVIDER=gemini (default)
 *   - PROD: AI_PROVIDER=azure-openai
 */

const config = require('../../config');
const { logger } = require('../infrastructure/errorHandler');
const providers = require('./providers');
const { getBreaker, SERVICES } = require('../infrastructure/circuitBreaker');

// Provider activo
let activeProvider = null;
let providerConfig = null;

/**
 * Inicializa el servicio de IA con el provider configurado
 */
function initializeProvider() {
  const providerName = config.ai.provider;

  // Validar que el provider existe
  if (!providers[providerName]) {
    const availableProviders = Object.keys(providers).join(', ');
    throw new Error(
      `Provider de IA '${providerName}' no reconocido. Disponibles: ${availableProviders}`
    );
  }

  activeProvider = providers[providerName];

  // Configurar según el provider
  if (providerName === 'gemini') {
    providerConfig = {
      apiKey: config.ai.gemini.apiKey,
      model: config.ai.gemini.model,
    };
  } else if (providerName === 'azure-openai') {
    providerConfig = {
      endpoint: config.ai.azureOpenAI.endpoint,
      apiKey: config.ai.azureOpenAI.apiKey,
      deploymentName: config.ai.azureOpenAI.deploymentName,
    };
  }

  // Inicializar el provider
  activeProvider.initialize(providerConfig);

  logger.ai(`Provider inicializado: ${providerName}`);
}

/**
 * Obtiene el provider activo, inicializándolo si es necesario
 */
function getProvider() {
  if (!activeProvider) {
    initializeProvider();
  }
  return activeProvider;
}

/**
 * Obtiene el circuit breaker apropiado según el provider
 */
function getCircuitBreaker() {
  const providerName = config.ai.provider;
  if (providerName === 'azure-openai') {
    return getBreaker(SERVICES.AZURE_OPENAI);
  }
  return getBreaker(SERVICES.GEMINI);
}

/**
 * Ejecuta una operación de IA con circuit breaker y fallback
 * @param {Function} operation - Función async a ejecutar
 * @param {any} fallbackValue - Valor a retornar si el circuit está abierto
 * @param {string} operationName - Nombre de la operación (para logs)
 */
async function executeWithCircuitBreaker(operation, fallbackValue, operationName) {
  const breaker = getCircuitBreaker();
  const check = breaker.canExecute();

  if (!check.allowed) {
    logger.warn(`[AI] Circuit breaker open for ${operationName}: ${check.reason}`);
    return fallbackValue;
  }

  try {
    const result = await operation();
    breaker.recordSuccess();
    return result;
  } catch (error) {
    breaker.recordFailure(error);
    logger.error(`[AI] Error in ${operationName}`, error);
    return fallbackValue;
  }
}

/**
 * Detecta la intención del usuario en un mensaje
 * @param {string} userMessage - Mensaje del usuario
 * @returns {Object} - Objeto con la intención detectada
 */
async function detectIntent(userMessage) {
  const fallback = { intencion: 'DESCONOCIDO', confianza: 0, metodo: 'circuit_breaker_fallback' };

  return executeWithCircuitBreaker(
    () => {
      const provider = getProvider();
      return provider.detectIntent(userMessage, config.ai);
    },
    fallback,
    'detectIntent'
  );
}

/**
 * Interpreta términos ambiguos o sinónimos
 * @param {string} userText - Texto del usuario
 * @returns {Object} - Intención interpretada con confianza
 */
async function interpretTerm(userText) {
  const fallback = { intencion: 'DESCONOCIDO', confianza: 0, metodo: 'circuit_breaker_fallback' };

  return executeWithCircuitBreaker(
    () => {
      const provider = getProvider();
      return provider.interpretTerm(userText, config.ai);
    },
    fallback,
    'interpretTerm'
  );
}

/**
 * Extrae datos estructurados de mensajes largos
 * @param {string} userMessage - Mensaje del usuario
 * @returns {Object} - Datos estructurados extraídos
 */
async function extractStructuredData(userMessage) {
  const fallback = { confianza: 0, datos_encontrados: [], metodo: 'circuit_breaker_fallback' };

  return executeWithCircuitBreaker(
    () => {
      const provider = getProvider();
      return provider.extractStructuredData(userMessage, config.ai);
    },
    fallback,
    'extractStructuredData'
  );
}

/**
 * Extrae TODA la información posible de un mensaje
 * Incluye: tipo equipo, código SAP, número empleado, problema
 * @param {string} userMessage - Mensaje del usuario
 * @param {string} contextoActual - Estado actual del flujo (opcional)
 * @returns {Object} - Todos los datos extraídos
 */
async function extractAllData(userMessage, contextoActual = null) {
  const fallback = { confianza: 0, datos_encontrados: [], metodo: 'circuit_breaker_fallback' };

  return executeWithCircuitBreaker(
    () => {
      const provider = getProvider();
      return provider.extractAllData(userMessage, config.ai, contextoActual);
    },
    fallback,
    'extractAllData'
  );
}

/**
 * Obtiene el nombre del provider activo
 * @returns {string} - Nombre del provider
 */
function getProviderName() {
  const provider = getProvider();
  return provider.getName();
}

/**
 * Analiza una imagen con AI Vision y extrae información
 * @param {Buffer} imageBuffer - Buffer de la imagen
 * @param {string} userText - Texto opcional del usuario (caption)
 * @returns {Object} - Datos extraídos de la imagen
 */
async function analyzeImageWithVision(imageBuffer, userText = '') {
  const fallback = {
    tipo_equipo: null,
    codigo_sap: null,
    numero_empleado: null,
    problema: null,
    informacion_visual: '',
    codigos_visibles: [],
    confianza: 0,
    calidad_imagen: null,
    datos_encontrados: [],
  };

  return executeWithCircuitBreaker(
    () => {
      const provider = getProvider();
      return provider.analyzeImageWithVision(imageBuffer, userText, config.ai);
    },
    fallback,
    'analyzeImageWithVision'
  );
}

/**
 * Verifica si el servicio de IA está habilitado
 * @returns {boolean}
 */
function isEnabled() {
  return config.ai.enabled;
}

module.exports = {
  detectIntent,
  interpretTerm,
  extractStructuredData,
  extractAllData,
  analyzeImageWithVision,
  getProviderName,
  isEnabled,
  initializeProvider,
};
