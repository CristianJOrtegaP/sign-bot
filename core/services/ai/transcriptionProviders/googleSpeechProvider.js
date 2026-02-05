/**
 * AC FIXBOT - Proveedor de Transcripción: Google Speech-to-Text
 *
 * Google ofrece 60 minutos gratis por mes
 * - API robusta y confiable
 * - Excelente soporte para español
 * - Pay-as-you-go después (~$0.006/15 segundos)
 *
 * Configuración: https://cloud.google.com/speech-to-text/docs/quickstart-client-libraries
 */

const axios = require('axios');
const { logger } = require('../../infrastructure/errorHandler');

const GOOGLE_API_URL = 'https://speech.googleapis.com/v1/speech:recognize';

/**
 * Transcribe audio usando Google Speech-to-Text API
 * @param {Buffer} audioBuffer - Buffer con el audio (debe ser WAV o FLAC)
 * @param {Object} options - Opciones de configuración
 * @param {string} options.apiKey - API Key de Google Cloud
 * @param {string} options.mimeType - Tipo MIME del audio
 * @returns {Promise<Object>} - Resultado de la transcripción
 */
async function transcribe(audioBuffer, options = {}) {
  const { apiKey, mimeType = 'audio/ogg' } = options;

  if (!apiKey) {
    throw new Error('Google Cloud API Key no configurada');
  }

  const startTime = Date.now();

  try {
    // Google Speech API requiere audio en base64
    const audioBase64 = audioBuffer.toString('base64');

    // Determinar encoding según mimeType
    let encoding = 'OGG_OPUS';
    let sampleRateHertz = 48000;

    if (mimeType.includes('wav')) {
      encoding = 'LINEAR16';
      sampleRateHertz = 16000;
    } else if (mimeType.includes('mp3') || mimeType.includes('mpeg')) {
      encoding = 'MP3';
      sampleRateHertz = 16000;
    } else if (mimeType.includes('flac')) {
      encoding = 'FLAC';
      sampleRateHertz = 16000;
    }

    const requestBody = {
      config: {
        encoding: encoding,
        sampleRateHertz: sampleRateHertz,
        languageCode: 'es-MX', // Español mexicano
        enableAutomaticPunctuation: true,
        model: 'default',
        // Usar modelo enhanced para mejor precisión (consume más cuota)
        useEnhanced: false,
      },
      audio: {
        content: audioBase64,
      },
    };

    const response = await axios.post(`${GOOGLE_API_URL}?key=${apiKey}`, requestBody, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const duration = Date.now() - startTime;

    // Extraer transcripción de la respuesta
    const results = response.data?.results || [];
    const transcript = results
      .map((r) => r.alternatives?.[0]?.transcript || '')
      .join(' ')
      .trim();

    const confidence = results[0]?.alternatives?.[0]?.confidence || 0;

    logger.debug('Google Speech transcripción completada', {
      textLength: transcript.length,
      confidence: `${(confidence * 100).toFixed(1)}%`,
      durationMs: duration,
    });

    return {
      success: true,
      text: transcript,
      confidence,
      duration,
      provider: 'google',
      model: 'default',
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    let errorMessage = 'Error en Google Speech';
    let errorCode = 'GOOGLE_ERROR';

    if (error.response) {
      const status = error.response.status;
      const errorDetails = error.response.data?.error;

      if (status === 401 || status === 403) {
        errorMessage = 'API Key de Google inválida o sin permisos';
        errorCode = 'AUTH_ERROR';
      } else if (status === 429 || errorDetails?.message?.includes('quota')) {
        errorMessage = 'Cuota de Google Speech agotada (60 min/mes gratis)';
        errorCode = 'QUOTA_EXCEEDED';
      } else if (status === 400) {
        errorMessage = 'Audio inválido para Google Speech';
        errorCode = 'INVALID_AUDIO';
      }

      logger.error('Error Google Speech', error, {
        status,
        errorCode,
        errorDetails: JSON.stringify(errorDetails).substring(0, 200),
      });
    } else {
      logger.error('Error de red Google Speech', error);
      errorCode = 'NETWORK_ERROR';
      errorMessage = 'Error de conexión con Google';
    }

    return {
      success: false,
      text: null,
      error: errorMessage,
      errorCode,
      duration,
      provider: 'google',
    };
  }
}

/**
 * Verifica si Google Speech está configurado
 * @param {Object} config - Configuración
 * @returns {boolean}
 */
function isConfigured(config) {
  return Boolean(config?.audio?.googleApiKey);
}

/**
 * Obtiene información del proveedor
 * @returns {Object}
 */
function getInfo() {
  return {
    name: 'Google Speech-to-Text',
    description: 'Servicio de Google con 60 min/mes gratis',
    website: 'https://cloud.google.com/speech-to-text',
    pricing: '$0.006 por 15 segundos después de 60 min/mes',
    features: [
      'Español mexicano nativo (es-MX)',
      '60 minutos gratis por mes',
      'Puntuación automática',
      'Alta precisión',
    ],
  };
}

module.exports = {
  transcribe,
  isConfigured,
  getInfo,
};
