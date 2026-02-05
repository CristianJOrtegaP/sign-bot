/**
 * AC FIXBOT - Proveedor de Transcripción: Deepgram
 *
 * Deepgram ofrece $200 en créditos gratis al registrarse
 * - API simple y rápida
 * - Excelente soporte para español
 * - Pay-as-you-go después (~$0.0043/min)
 *
 * Obtener API Key: https://console.deepgram.com/signup
 */

const axios = require('axios');
const { logger } = require('../../infrastructure/errorHandler');

const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';

/**
 * Transcribe audio usando Deepgram API
 * @param {Buffer} audioBuffer - Buffer con el audio
 * @param {Object} options - Opciones de configuración
 * @param {string} options.apiKey - API Key de Deepgram
 * @param {string} options.mimeType - Tipo MIME del audio
 * @returns {Promise<Object>} - Resultado de la transcripción
 */
async function transcribe(audioBuffer, options = {}) {
  const { apiKey, mimeType = 'audio/ogg' } = options;

  if (!apiKey) {
    throw new Error('Deepgram API Key no configurada');
  }

  const startTime = Date.now();

  try {
    // Deepgram acepta audio directamente en el body (no necesita FormData)
    // Soporta múltiples formatos incluyendo OGG/Opus nativo
    const response = await axios.post(DEEPGRAM_API_URL, audioBuffer, {
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': mimeType,
      },
      params: {
        // Modelo nova-2 es el más preciso y económico
        model: 'nova-2',
        // Idioma español
        language: 'es',
        // Puntuación automática
        punctuate: true,
        // Detección de utterances para mejor formato
        utterances: false,
        // Smart formatting para números, fechas, etc.
        smart_format: true,
      },
      timeout: 30000,
    });

    const duration = Date.now() - startTime;

    // Extraer transcripción de la respuesta
    const transcript = response.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    const confidence = response.data?.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0;

    logger.debug('Deepgram transcripción completada', {
      textLength: transcript.length,
      confidence: `${(confidence * 100).toFixed(1)}%`,
      durationMs: duration,
    });

    return {
      success: true,
      text: transcript.trim(),
      confidence,
      duration,
      provider: 'deepgram',
      model: 'nova-2',
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    let errorMessage = 'Error en Deepgram';
    let errorCode = 'DEEPGRAM_ERROR';

    if (error.response) {
      const status = error.response.status;

      if (status === 401 || status === 403) {
        errorMessage = 'API Key de Deepgram inválida';
        errorCode = 'AUTH_ERROR';
      } else if (status === 402) {
        errorMessage = 'Créditos de Deepgram agotados';
        errorCode = 'QUOTA_EXCEEDED';
      } else if (status === 429) {
        errorMessage = 'Límite de tasa de Deepgram excedido';
        errorCode = 'RATE_LIMIT';
      } else if (status === 400) {
        errorMessage = 'Audio inválido para Deepgram';
        errorCode = 'INVALID_AUDIO';
      }

      logger.error('Error Deepgram', error, {
        status,
        errorCode,
        response: JSON.stringify(error.response.data).substring(0, 200),
      });
    } else {
      logger.error('Error de red Deepgram', error);
      errorCode = 'NETWORK_ERROR';
      errorMessage = 'Error de conexión con Deepgram';
    }

    return {
      success: false,
      text: null,
      error: errorMessage,
      errorCode,
      duration,
      provider: 'deepgram',
    };
  }
}

/**
 * Verifica si Deepgram está configurado
 * @param {Object} config - Configuración
 * @returns {boolean}
 */
function isConfigured(config) {
  return Boolean(config?.audio?.deepgramApiKey);
}

/**
 * Obtiene información del proveedor
 * @returns {Object}
 */
function getInfo() {
  return {
    name: 'Deepgram',
    description: 'Servicio de transcripción con $200 gratis',
    website: 'https://deepgram.com',
    pricing: '$0.0043/minuto después del tier gratuito',
    features: [
      'Soporta español nativo',
      '$200 en créditos gratis',
      'Soporta OGG/Opus directamente',
      'Modelo nova-2 de alta precisión',
    ],
  };
}

module.exports = {
  transcribe,
  isConfigured,
  getInfo,
};
