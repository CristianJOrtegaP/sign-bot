/**
 * AC FIXBOT - Servicio de Azure AI Vision
 * Extrae texto de imágenes (OCR) para leer códigos de barras
 */

const { ComputerVisionClient } = require('@azure/cognitiveservices-computervision');
const { ApiKeyCredentials } = require('@azure/ms-rest-js');
const config = require('../../config');
const metrics = require('../infrastructure/metricsService');
const { logger } = require('../infrastructure/errorHandler');
const { sleep } = require('../../utils/promises');

// Configuración del cliente desde config centralizado
const endpoint = config.vision.endpoint;
const key = config.vision.apiKey;

const credentials = new ApiKeyCredentials({
  inHeader: { 'Ocp-Apim-Subscription-Key': key },
});
const client = new ComputerVisionClient(credentials, endpoint);

/**
 * Tipos de error de OCR con mensajes específicos
 */
const OCR_ERROR_TYPES = {
  TIMEOUT: 'TIMEOUT',
  INVALID_IMAGE: 'INVALID_IMAGE',
  IMAGE_TOO_SMALL: 'IMAGE_TOO_SMALL',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  LOW_QUALITY: 'LOW_QUALITY',
  NO_TEXT_FOUND: 'NO_TEXT_FOUND',
  SERVICE_ERROR: 'SERVICE_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
};

/**
 * Mensajes de error específicos para el usuario
 */
const OCR_ERROR_MESSAGES = {
  [OCR_ERROR_TYPES.TIMEOUT]: {
    message: '⏱️ El análisis de la imagen tomó demasiado tiempo.',
    suggestions: [
      'La imagen puede ser muy grande o compleja',
      'Intenta con una imagen más pequeña',
      'Asegúrate de tener buena conexión a internet',
    ],
  },
  [OCR_ERROR_TYPES.INVALID_IMAGE]: {
    message: '❌ No pude procesar esta imagen.',
    suggestions: [
      'Verifica que el archivo sea una imagen válida',
      'Intenta enviar la imagen nuevamente',
      'Toma una nueva foto del código',
    ],
  },
  [OCR_ERROR_TYPES.IMAGE_TOO_SMALL]: {
    message: '🔍 La imagen es demasiado pequeña para leer el código.',
    suggestions: [
      'Acércate más al código de barras',
      'Asegúrate de que el código ocupe al menos un tercio de la imagen',
      'Intenta con mejor resolución',
    ],
  },
  [OCR_ERROR_TYPES.IMAGE_TOO_LARGE]: {
    message: '📐 La imagen es demasiado grande.',
    suggestions: [
      'Recorta la imagen para mostrar solo el código',
      'Reduce el tamaño o resolución de la imagen',
    ],
  },
  [OCR_ERROR_TYPES.UNSUPPORTED_FORMAT]: {
    message: '📁 Formato de imagen no soportado.',
    suggestions: ['Usa formatos JPG, PNG o WEBP', 'Evita formatos como GIF animado o HEIC'],
  },
  [OCR_ERROR_TYPES.LOW_QUALITY]: {
    message: '📷 La calidad de la imagen es muy baja.',
    suggestions: [
      'Asegúrate de que la imagen esté enfocada',
      'Mejora la iluminación (evita sombras sobre el código)',
      'Mantén la cámara estable al tomar la foto',
      'El código de barras debe ser claramente visible',
    ],
  },
  [OCR_ERROR_TYPES.NO_TEXT_FOUND]: {
    message: '🔎 No encontré texto legible en la imagen.',
    suggestions: [
      'Verifica que el código de barras sea visible',
      'El código debe tener 7 dígitos debajo de las barras',
      'Intenta centrar el código en la imagen',
    ],
  },
  [OCR_ERROR_TYPES.SERVICE_ERROR]: {
    message: '⚠️ El servicio de análisis no está disponible.',
    suggestions: [
      'Intenta nuevamente en unos segundos',
      'Si el problema persiste, ingresa el código manualmente',
    ],
  },
  [OCR_ERROR_TYPES.NETWORK_ERROR]: {
    message: '🌐 Error de conexión al servicio.',
    suggestions: ['Verifica tu conexión a internet', 'Intenta nuevamente en unos segundos'],
  },
};

/**
 * Clase de error personalizada para OCR
 */
class OCRError extends Error {
  constructor(type, originalError = null) {
    const errorInfo = OCR_ERROR_MESSAGES[type] || OCR_ERROR_MESSAGES[OCR_ERROR_TYPES.SERVICE_ERROR];
    super(errorInfo.message);
    this.name = 'OCRError';
    this.type = type;
    this.suggestions = errorInfo.suggestions;
    this.originalError = originalError;
  }

  /**
   * Genera mensaje formateado para el usuario
   */
  getUserMessage() {
    let message = `${this.message}\n\n*Sugerencias:*\n`;
    this.suggestions.forEach((suggestion) => {
      message += `• ${suggestion}\n`;
    });
    message += '\nTambién puedes ingresar el código SAP manualmente (7 dígitos).';
    return message;
  }
}

/**
 * Extrae texto de una imagen usando OCR
 * @param {Buffer} imageBuffer - Buffer de la imagen
 * @returns {Object} - Objeto con lines (array de texto) y metadata
 * @throws {OCRError} - Error tipado con contexto específico
 */
async function extractTextFromImage(imageBuffer) {
  const timer = metrics.startTimer('ocr_extraction');

  try {
    logger.vision('Iniciando OCR en imagen');

    // Validar tamaño de imagen
    const imageSizeKB = imageBuffer.length / 1024;
    logger.debug('Tamaño de imagen', { sizeKB: imageSizeKB.toFixed(2) });

    if (imageSizeKB < 1) {
      throw new OCRError(OCR_ERROR_TYPES.IMAGE_TOO_SMALL);
    }

    if (imageSizeKB > 20480) {
      // 20MB límite de Azure Vision
      throw new OCRError(OCR_ERROR_TYPES.IMAGE_TOO_LARGE);
    }

    // Iniciar operación de lectura
    let result;
    try {
      result = await client.readInStream(imageBuffer, {
        language: config.vision.ocr.language,
      });
    } catch (apiError) {
      throw classifyApiError(apiError);
    }

    // Obtener ID de la operación
    const operationLocation = result.operationLocation;
    const operationId = operationLocation.split('/').pop();

    logger.debug('Operación OCR iniciada', { operationId });

    // Esperar a que termine el análisis (polling con timeout configurable)
    let readResult;
    let attempts = 0;
    const maxAttempts = config.vision.ocr.maxAttempts;

    do {
      await sleep(config.vision.ocr.pollingIntervalMs);
      try {
        readResult = await client.getReadResult(operationId);
      } catch (pollError) {
        throw classifyApiError(pollError);
      }
      logger.debug('Estado OCR', { status: readResult.status, attempt: attempts });
      attempts++;
    } while (
      (readResult.status === 'running' || readResult.status === 'notStarted') &&
      attempts < maxAttempts
    );

    // Si se agotó el tiempo, lanzar error tipado
    if (attempts >= maxAttempts && readResult.status !== 'succeeded') {
      metrics.recordError('ocr_timeout', `Timeout después de ${attempts} intentos`);
      throw new OCRError(OCR_ERROR_TYPES.TIMEOUT);
    }

    // Verificar si el análisis falló
    if (readResult.status === 'failed') {
      metrics.recordError('ocr_failed', 'Análisis falló');
      throw new OCRError(OCR_ERROR_TYPES.LOW_QUALITY);
    }

    // Extraer texto de los resultados
    const lines = [];
    const metadata = {
      totalPages: 0,
      totalLines: 0,
      confidence: null,
    };

    if (readResult.status === 'succeeded' && readResult.analyzeResult) {
      metadata.totalPages = readResult.analyzeResult.readResults.length;

      for (const page of readResult.analyzeResult.readResults) {
        // Analizar calidad basada en dimensiones
        if (page.width < 50 || page.height < 50) {
          logger.warn('Imagen con dimensiones muy pequeñas', {
            width: page.width,
            height: page.height,
          });
        }

        for (const line of page.lines) {
          lines.push(line.text);
          logger.debug('Línea encontrada', { text: line.text });
        }
      }
      metadata.totalLines = lines.length;
    }

    logger.vision('OCR completado', { linesFound: lines.length });

    // Si no se encontró texto, podría ser imagen borrosa o sin código
    if (lines.length === 0) {
      timer.end({ result: 'no_text', attempts });
      throw new OCRError(OCR_ERROR_TYPES.NO_TEXT_FOUND);
    }

    timer.end({ result: 'success', lines: lines.length, attempts });
    return { lines, metadata };
  } catch (error) {
    // Si ya es un OCRError, propagarlo
    if (error instanceof OCRError) {
      timer.end({ result: 'error', type: error.type });
      throw error;
    }

    // Clasificar errores desconocidos
    logger.error('Error en Vision OCR', error);
    metrics.recordError('ocr_unknown', error.message);
    timer.end({ result: 'error', type: 'unknown' });
    throw new OCRError(OCR_ERROR_TYPES.SERVICE_ERROR, error);
  }
}

/**
 * Clasifica errores de la API en tipos específicos
 * @param {Error} error - Error original de la API
 * @returns {OCRError} - Error tipado
 */
function classifyApiError(error) {
  const statusCode = error.statusCode || error.status;
  const message = error.message || '';

  // Errores de red
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    metrics.recordError('ocr_network', error.code);
    return new OCRError(OCR_ERROR_TYPES.NETWORK_ERROR, error);
  }

  // Errores por código HTTP
  if (statusCode === 400) {
    if (message.includes('image') && message.includes('small')) {
      return new OCRError(OCR_ERROR_TYPES.IMAGE_TOO_SMALL, error);
    }
    if (message.includes('format') || message.includes('type')) {
      return new OCRError(OCR_ERROR_TYPES.UNSUPPORTED_FORMAT, error);
    }
    return new OCRError(OCR_ERROR_TYPES.INVALID_IMAGE, error);
  }

  if (statusCode === 413) {
    return new OCRError(OCR_ERROR_TYPES.IMAGE_TOO_LARGE, error);
  }

  if (statusCode === 415) {
    return new OCRError(OCR_ERROR_TYPES.UNSUPPORTED_FORMAT, error);
  }

  if (statusCode >= 500) {
    metrics.recordError('ocr_service_error', `HTTP ${statusCode}`);
    return new OCRError(OCR_ERROR_TYPES.SERVICE_ERROR, error);
  }

  // Error genérico
  return new OCRError(OCR_ERROR_TYPES.SERVICE_ERROR, error);
}

/**
 * Busca un código SAP en las líneas de texto extraídas
 * @param {Array<string>} textLines - Líneas de texto
 * @returns {string|null} - Código SAP encontrado o null
 */
function findSAPCode(textLines) {
  const sapPattern = config.vision.sapCodePattern;

  // Soportar tanto array directo como objeto con .lines
  const lines = Array.isArray(textLines) ? textLines : textLines.lines || [];

  for (const line of lines) {
    // Buscar patrón de código SAP (7 dígitos)
    const match = line.match(sapPattern);
    if (match) {
      logger.info('Código SAP encontrado', { code: match[1] });
      return match[1];
    }

    // También buscar en formato con guiones o espacios
    const cleanLine = line.replace(/[\s-]/g, '');
    const matchClean = cleanLine.match(sapPattern);
    if (matchClean) {
      logger.info('Código SAP encontrado (limpio)', { code: matchClean[1] });
      return matchClean[1];
    }
  }
  return null;
}

module.exports = {
  extractTextFromImage,
  findSAPCode,
  OCRError,
  OCR_ERROR_TYPES,
};
