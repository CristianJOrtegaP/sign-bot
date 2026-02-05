/**
 * AC FIXBOT - Proveedor de Transcripción: Azure Speech Services
 *
 * Azure Cognitive Services Speech-to-Text
 * - 5 horas gratis por mes (tier F0)
 * - Excelente soporte para español mexicano
 * - Integración nativa con Azure
 *
 * Crear recurso: https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices
 */

const axios = require('axios');
const { logger } = require('../../infrastructure/errorHandler');

/**
 * Transcribe audio usando Azure Speech Services
 * @param {Buffer} audioBuffer - Buffer con el audio (WAV preferido, o se convierte)
 * @param {Object} options - Opciones de configuración
 * @param {string} options.apiKey - API Key de Azure Speech
 * @param {string} options.region - Región de Azure (ej: eastus, westus2)
 * @param {string} options.mimeType - Tipo MIME del audio
 * @returns {Promise<Object>} - Resultado de la transcripción
 */
async function transcribe(audioBuffer, options = {}) {
  const { apiKey, region, mimeType = 'audio/ogg' } = options;

  if (!apiKey || !region) {
    throw new Error('Azure Speech: API Key y Region son requeridos');
  }

  const startTime = Date.now();

  try {
    // Azure Speech REST API endpoint
    const endpoint = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`;

    // Determinar content-type según el formato de audio
    let contentType = 'audio/ogg; codecs=opus';

    if (mimeType.includes('wav')) {
      contentType = 'audio/wav';
    } else if (mimeType.includes('mp3') || mimeType.includes('mpeg')) {
      contentType = 'audio/mpeg';
    } else if (mimeType.includes('ogg') || mimeType.includes('opus')) {
      // Azure Speech soporta OGG/Opus directamente
      contentType = 'audio/ogg; codecs=opus';
    }

    const response = await axios.post(endpoint, audioBuffer, {
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Type': contentType,
        Accept: 'application/json',
      },
      params: {
        language: 'es-MX', // Español mexicano
        format: 'detailed', // Respuesta detallada con confianza
        profanity: 'raw', // No censurar
      },
      timeout: 30000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const duration = Date.now() - startTime;

    // Extraer transcripción de la respuesta
    const result = response.data;

    if (result.RecognitionStatus === 'Success') {
      const transcript = result.DisplayText || result.NBest?.[0]?.Display || '';
      const confidence = result.NBest?.[0]?.Confidence || 0;

      logger.debug('Azure Speech transcripción completada', {
        textLength: transcript.length,
        confidence: `${(confidence * 100).toFixed(1)}%`,
        durationMs: duration,
      });

      return {
        success: true,
        text: transcript.trim(),
        confidence,
        duration,
        provider: 'azure-speech',
        model: 'speech-to-text',
      };
    }
    if (result.RecognitionStatus === 'NoMatch') {
      return {
        success: false,
        text: null,
        error: 'No se detectó voz en el audio',
        errorCode: 'NO_SPEECH',
        duration,
        provider: 'azure-speech',
      };
    }
    return {
      success: false,
      text: null,
      error: `Estado de reconocimiento: ${result.RecognitionStatus}`,
      errorCode: 'RECOGNITION_FAILED',
      duration,
      provider: 'azure-speech',
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    let errorMessage = 'Error en Azure Speech';
    let errorCode = 'AZURE_SPEECH_ERROR';

    if (error.response) {
      const status = error.response.status;

      if (status === 401 || status === 403) {
        errorMessage = 'API Key de Azure Speech inválida o sin permisos';
        errorCode = 'AUTH_ERROR';
      } else if (status === 429) {
        errorMessage = 'Cuota de Azure Speech agotada (5 hrs/mes gratis)';
        errorCode = 'QUOTA_EXCEEDED';
      } else if (status === 400) {
        errorMessage = 'Audio inválido para Azure Speech';
        errorCode = 'INVALID_AUDIO';
      } else if (status === 404) {
        errorMessage = 'Región de Azure Speech no válida';
        errorCode = 'INVALID_REGION';
      }

      logger.error('Error Azure Speech', error, {
        status,
        errorCode,
        response: JSON.stringify(error.response.data).substring(0, 200),
      });
    } else {
      logger.error('Error de red Azure Speech', error);
      errorCode = 'NETWORK_ERROR';
      errorMessage = 'Error de conexión con Azure Speech';
    }

    return {
      success: false,
      text: null,
      error: errorMessage,
      errorCode,
      duration,
      provider: 'azure-speech',
    };
  }
}

/**
 * Verifica si Azure Speech está configurado
 * @param {Object} config - Configuración
 * @returns {boolean}
 */
function isConfigured(config) {
  return Boolean(config?.audio?.azureSpeechKey && config?.audio?.azureSpeechRegion);
}

/**
 * Obtiene información del proveedor
 * @returns {Object}
 */
function getInfo() {
  return {
    name: 'Azure Speech Services',
    description: 'Azure Cognitive Services con 5 horas/mes gratis',
    website: 'https://azure.microsoft.com/services/cognitive-services/speech-to-text/',
    pricing: '$1/hora después de 5 hrs/mes gratis',
    features: [
      'Español mexicano nativo (es-MX)',
      '5 horas gratis por mes',
      'Soporta OGG/Opus directamente',
      'Integración nativa con Azure',
      'Alta precisión',
    ],
  };
}

module.exports = {
  transcribe,
  isConfigured,
  getInfo,
};
