/**
 * AC FIXBOT - Servicio de Transcripción de Audio
 * Proveedores Azure (Producción):
 * 1. Azure OpenAI Whisper (primario)
 * 2. Azure Speech Services (fallback, 5 hrs/mes gratis)
 *
 * Proveedor desarrollo (solo dev/test):
 * 3. Google Speech-to-Text (60 min/mes gratis) - NO usar en producción
 *
 * Compatible con audios de WhatsApp (OGG/Opus)
 */

const axios = require('axios');
const config = require('../../config');
const { logger } = require('../infrastructure/errorHandler');
const { getBreaker, SERVICES } = require('../infrastructure/circuitBreaker');

// Proveedores de transcripción Azure (producción)
const azureSpeechProvider = require('./transcriptionProviders/azureSpeechProvider');
// Google Speech solo para desarrollo/testing (NO usar en producción Arca Continental)
const googleProvider = require('./transcriptionProviders/googleSpeechProvider');

// Utilidades de procesamiento de audio
const { convertOggToWav } = require('./audioUtils');

// Circuit breaker para el servicio de transcripción
const transcriptionBreaker = getBreaker(SERVICES.AZURE_AI || 'azure-ai');

/**
 * Configuración del servicio de transcripción
 */
const TRANSCRIPTION_CONFIG = {
  // Idioma principal (español mexicano)
  language: 'es',
  // Timeout para transcripción (audios pueden tardar)
  timeoutMs: 60000,
  // Tamaño máximo de audio (25MB)
  maxFileSizeBytes: 25 * 1024 * 1024,
  // Formatos soportados
  supportedFormats: [
    'audio/ogg',
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/wav',
    'audio/webm',
    'audio/x-m4a',
    'audio/opus',
  ],
};

/**
 * Obtiene la lista de proveedores disponibles en orden de prioridad
 * @returns {Array} Lista de proveedores configurados
 */
function getAvailableProviders() {
  const audioConfig = config.audio || {};
  const providers = [];

  // 1. Azure Whisper (primario si está configurado)
  if (audioConfig.enabled && audioConfig.endpoint && audioConfig.apiKey) {
    providers.push({
      name: 'azure-whisper',
      priority: 1,
      description: 'Azure OpenAI Whisper',
    });
  }

  // 2. Azure Speech Services (5 hrs/mes gratis) - Fallback Azure
  if (audioConfig.azureSpeechKey && audioConfig.azureSpeechRegion) {
    providers.push({
      name: 'azure-speech',
      priority: 2,
      description: 'Azure Speech Services (5 hrs/mes gratis)',
    });
  }

  // 3. Google Speech-to-Text - SOLO PARA DESARROLLO (NO usar en producción)
  if (audioConfig.googleApiKey && process.env.NODE_ENV !== 'production') {
    providers.push({
      name: 'google',
      priority: 3,
      description: 'Google Speech (solo desarrollo)',
    });
  }

  return providers.sort((a, b) => a.priority - b.priority);
}

/**
 * Verifica si la transcripción está habilitada
 * Producción: Solo proveedores Azure
 * Desarrollo: Azure + Google Speech
 * @returns {boolean}
 */
function isEnabled() {
  const audioConfig = config.audio || {};
  const isProduction = process.env.NODE_ENV === 'production';

  // Azure Whisper (primario)
  const azureWhisperEnabled =
    audioConfig.enabled === true && audioConfig.endpoint && audioConfig.apiKey;

  // Azure Speech Services (fallback)
  const azureSpeechEnabled = Boolean(audioConfig.azureSpeechKey && audioConfig.azureSpeechRegion);

  // Google (solo desarrollo)
  const googleEnabled = !isProduction && Boolean(audioConfig.googleApiKey);

  return azureWhisperEnabled || azureSpeechEnabled || googleEnabled;
}

/**
 * Verifica si Azure Whisper está habilitado específicamente
 * @returns {boolean}
 */
function isAzureEnabled() {
  const audioConfig = config.audio || {};
  return audioConfig.enabled === true && audioConfig.endpoint && audioConfig.apiKey;
}

/**
 * Transcribe audio usando proveedores alternativos (Azure Speech o Google en dev)
 * @param {Buffer} audioBuffer - Buffer con el audio
 * @param {Object} options - Opciones de transcripción
 * @returns {Promise<Object>} - Resultado de transcripción
 */
async function transcribeWithAlternativeProvider(audioBuffer, options = {}) {
  const audioConfig = config.audio || {};
  const mimeType = options.mimeType || 'audio/ogg';
  const isProduction = process.env.NODE_ENV === 'production';
  const errors = [];

  // 1. Intentar Azure Speech Services (fallback Azure - 5 hrs/mes gratis)
  if (audioConfig.azureSpeechKey && audioConfig.azureSpeechRegion) {
    logger.debug('Intentando transcripción con Azure Speech Services...');
    const result = await azureSpeechProvider.transcribe(audioBuffer, {
      apiKey: audioConfig.azureSpeechKey,
      region: audioConfig.azureSpeechRegion,
      mimeType,
    });

    if (result.success) {
      logger.info('Transcripción exitosa con Azure Speech', {
        textLength: result.text?.length,
        duration: result.duration,
      });
      return result;
    }

    errors.push({ provider: 'azure-speech', error: result.error, errorCode: result.errorCode });
    logger.warn('Azure Speech falló', { error: result.error });
  }

  // 2. Google Speech - SOLO en desarrollo (NO en producción Arca Continental)
  if (!isProduction && audioConfig.googleApiKey) {
    logger.debug('Intentando transcripción con Google Speech (solo dev)...');
    const result = await googleProvider.transcribe(audioBuffer, {
      apiKey: audioConfig.googleApiKey,
      mimeType,
    });

    if (result.success) {
      logger.info('Transcripción exitosa con Google Speech (dev)', {
        textLength: result.text?.length,
        duration: result.duration,
      });
      return result;
    }

    errors.push({ provider: 'google', error: result.error, errorCode: result.errorCode });
  }

  // Ningún proveedor alternativo disponible o todos fallaron
  return {
    success: false,
    text: null,
    error:
      errors.length > 0
        ? `Proveedores Azure fallaron: ${errors.map((e) => e.error).join(', ')}`
        : 'No hay proveedores Azure de audio configurados (AZURE_SPEECH_KEY, AZURE_SPEECH_REGION)',
    errors,
    duration: 0,
  };
}

/**
 * Transcribe un buffer de audio a texto
 * Proveedores Azure (Producción Arca Continental):
 * 1. Azure OpenAI Whisper (primario)
 * 2. Azure Speech Services (fallback)
 *
 * @param {Buffer} audioBuffer - Buffer con el contenido del audio
 * @param {Object} options - Opciones adicionales
 * @param {string} options.mimeType - Tipo MIME del audio (default: audio/ogg)
 * @param {string} options.filename - Nombre del archivo (default: audio.ogg)
 * @param {boolean} options.preferAlternative - Usar proveedor alternativo primero
 * @returns {Promise<Object>} - Objeto con texto transcrito y metadata
 */
async function transcribeAudio(audioBuffer, options = {}) {
  const availableProviders = getAvailableProviders();

  if (availableProviders.length === 0) {
    logger.warn('Transcripción de audio: ningún proveedor Azure configurado');
    return {
      success: false,
      text: null,
      error:
        'No hay proveedores de transcripción configurados. Configura AZURE_SPEECH_KEY y AZURE_SPEECH_REGION, o habilita AUDIO_TRANSCRIPTION_ENABLED con Azure OpenAI.',
      duration: 0,
    };
  }

  logger.debug('Proveedores de transcripción disponibles', {
    providers: availableProviders.map((p) => p.name),
  });

  // Si se prefiere proveedor alternativo o Azure no está disponible, usar alternativo directamente
  if (options.preferAlternative || !isAzureEnabled()) {
    return transcribeWithAlternativeProvider(audioBuffer, options);
  }

  // Verificar circuit breaker para Azure
  const check = transcriptionBreaker.canExecute();
  if (!check.allowed) {
    logger.warn('Circuit breaker abierto para Azure, usando proveedor alternativo', {
      reason: check.reason,
    });
    return transcribeWithAlternativeProvider(audioBuffer, options);
  }

  const startTime = Date.now();
  const mimeType = options.mimeType || 'audio/ogg';

  try {
    // Validar tamaño del audio
    if (audioBuffer.length > TRANSCRIPTION_CONFIG.maxFileSizeBytes) {
      return {
        success: false,
        text: null,
        error: 'Audio demasiado grande (máximo 25MB)',
        duration: 0,
      };
    }

    // Validar formato
    const normalizedMime = mimeType.toLowerCase();
    const isSupported = TRANSCRIPTION_CONFIG.supportedFormats.some(
      (f) =>
        normalizedMime.includes(f.split('/')[1]) ||
        normalizedMime.includes('ogg') ||
        normalizedMime.includes('opus')
    );

    if (!isSupported && !normalizedMime.includes('ogg') && !normalizedMime.includes('opus')) {
      logger.warn('Formato de audio no soportado', { mimeType });
      return {
        success: false,
        text: null,
        error: `Formato de audio no soportado: ${mimeType}`,
        duration: 0,
      };
    }

    // Construir URL del endpoint de Azure OpenAI para transcripción
    const audioConfig = config.audio || {};
    const endpoint = audioConfig.endpoint.replace(/\/$/, '');
    const apiKey = audioConfig.apiKey;
    const deploymentName = audioConfig.audioDeployment || 'whisper';

    // Usar API de transcripciones de Whisper (no Chat Completions)
    const whisperUrl = `${endpoint}/openai/deployments/${deploymentName}/audio/transcriptions?api-version=2024-06-01`;

    // Determinar formato y convertir si es necesario
    let audioToSend = audioBuffer;
    let audioFormat = 'wav';

    if (normalizedMime.includes('mp3') || normalizedMime.includes('mpeg')) {
      // MP3 se envía directamente
      audioFormat = 'mp3';
    } else if (normalizedMime.includes('ogg') || normalizedMime.includes('opus')) {
      // OGG/Opus necesita conversión a WAV
      logger.debug('Convirtiendo OGG/Opus a WAV...');
      audioToSend = await convertOggToWav(audioBuffer);
      audioFormat = 'wav';
    } else if (normalizedMime.includes('wav')) {
      // WAV se envía directamente
      audioFormat = 'wav';
    } else {
      // Otros formatos, intentar como WAV
      audioFormat = 'wav';
    }

    // Construir FormData para Whisper API (multipart/form-data)
    const FormData = require('form-data');
    const formData = new FormData();

    // Agregar el archivo de audio
    const filename = `audio.${audioFormat}`;
    formData.append('file', audioToSend, {
      filename: filename,
      contentType: audioFormat === 'wav' ? 'audio/wav' : 'audio/mpeg',
    });

    // Configurar idioma español
    formData.append('language', TRANSCRIPTION_CONFIG.language);

    // Formato de respuesta (json para obtener más detalles)
    formData.append('response_format', 'json');

    logger.debug('Enviando audio a Whisper', {
      originalSize: audioBuffer.length,
      convertedSize: audioToSend.length,
      mimeType,
      deployment: deploymentName,
      audioFormat,
      endpoint: whisperUrl,
    });

    // Llamar a la API de Azure OpenAI Whisper
    const response = await axios.post(whisperUrl, formData, {
      headers: {
        ...formData.getHeaders(),
        'api-key': apiKey,
      },
      timeout: TRANSCRIPTION_CONFIG.timeoutMs,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const duration = Date.now() - startTime;

    // Extraer texto de la respuesta de Whisper
    const transcribedText = response.data.text?.trim() || '';

    // Registrar éxito en circuit breaker
    transcriptionBreaker.recordSuccess();

    logger.ai('Transcripción completada', {
      textLength: transcribedText.length,
      durationMs: duration,
      audioSizeBytes: audioBuffer.length,
      model: deploymentName,
    });

    return {
      success: true,
      text: transcribedText,
      error: null,
      duration,
      language: 'es',
      model: deploymentName,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    // Registrar fallo en circuit breaker
    transcriptionBreaker.recordFailure(error);

    // Clasificar el error
    let errorMessage = 'Error al transcribir audio';
    let errorCode = 'TRANSCRIPTION_ERROR';
    let shouldFallback = false;

    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;

      if (status === 400) {
        errorMessage = 'Audio inválido o formato no soportado';
        errorCode = 'INVALID_AUDIO';
      } else if (status === 401 || status === 403) {
        errorMessage = 'Error de autenticación con Azure OpenAI';
        errorCode = 'AUTH_ERROR';
        shouldFallback = true;
      } else if (status === 404) {
        errorMessage = 'Deployment de audio no encontrado';
        errorCode = 'DEPLOYMENT_NOT_FOUND';
        shouldFallback = true;
      } else if (status === 429) {
        errorMessage = 'Límite de tasa excedido en Azure';
        errorCode = 'RATE_LIMIT';
        shouldFallback = true; // Importante: hacer fallback en rate limit
      } else if (status >= 500) {
        errorMessage = 'Error del servidor de Azure OpenAI';
        errorCode = 'SERVER_ERROR';
        shouldFallback = true;
      }

      logger.warn('Error en Azure Whisper', {
        status,
        data: JSON.stringify(data).substring(0, 500),
        errorCode,
        willFallback: shouldFallback,
      });
    } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      errorMessage = 'Timeout al transcribir audio';
      errorCode = 'TIMEOUT';
      shouldFallback = true;
      logger.warn('Timeout en Azure Whisper', { durationMs: duration });
    } else if (
      error.message &&
      (error.message.includes('decode') || error.message.includes('DECODE'))
    ) {
      errorMessage = 'Error al decodificar audio OGG/Opus';
      errorCode = 'DECODE_ERROR';
      // Intentar fallback porque Azure Speech soporta OGG nativo
      shouldFallback = true;
      logger.warn('Error decodificando audio, intentando Azure Speech', {
        error: error.message,
      });
    } else {
      logger.error('Error inesperado en transcripción Azure', error);
      shouldFallback = true;
    }

    // Si Azure falló por rate limit u otro error recuperable, intentar con proveedores alternativos
    if (shouldFallback) {
      logger.info('Azure Whisper falló, intentando proveedores alternativos', {
        azureError: errorMessage,
        errorCode,
      });

      const alternativeResult = await transcribeWithAlternativeProvider(audioBuffer, options);

      if (alternativeResult.success) {
        logger.info('Transcripción exitosa con proveedor alternativo después de fallo de Azure', {
          provider: alternativeResult.provider,
          textLength: alternativeResult.text?.length,
        });
        return alternativeResult;
      }

      // Si también falló el alternativo, devolver error combinado
      return {
        success: false,
        text: null,
        error: `Azure: ${errorMessage}. Alternativos: ${alternativeResult.error}`,
        errorCode: 'ALL_PROVIDERS_FAILED',
        azureError: { message: errorMessage, code: errorCode },
        alternativeErrors: alternativeResult.errors,
        duration,
      };
    }

    return {
      success: false,
      text: null,
      error: errorMessage,
      errorCode,
      duration,
      provider: 'azure',
    };
  }
}

/**
 * Verifica si un tipo MIME es un audio válido para transcripción
 * @param {string} mimeType - Tipo MIME a verificar
 * @returns {boolean}
 */
function isSupportedAudioFormat(mimeType) {
  if (!mimeType) {
    return false;
  }
  const normalized = mimeType.toLowerCase();

  // WhatsApp envía audio/ogg o audio/ogg; codecs=opus
  if (normalized.includes('ogg') || normalized.includes('opus')) {
    return true;
  }

  return TRANSCRIPTION_CONFIG.supportedFormats.some((format) =>
    normalized.includes(format.split('/')[1])
  );
}

/**
 * Obtiene estadísticas del servicio
 * @returns {Object}
 */
function getStats() {
  return {
    enabled: isEnabled(),
    circuitBreakerState: transcriptionBreaker.getState(),
    config: {
      maxFileSizeBytes: TRANSCRIPTION_CONFIG.maxFileSizeBytes,
      timeoutMs: TRANSCRIPTION_CONFIG.timeoutMs,
      language: TRANSCRIPTION_CONFIG.language,
    },
  };
}

module.exports = {
  transcribeAudio,
  isEnabled,
  isAzureEnabled,
  isSupportedAudioFormat,
  getStats,
  getAvailableProviders,
  TRANSCRIPTION_CONFIG,
};
