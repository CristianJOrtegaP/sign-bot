/**
 * AC FIXBOT - Servicio de Transcripción de Audio
 * Soporta múltiples proveedores con fallback automático:
 * 1. Azure OpenAI Whisper (primario, si está configurado)
 * 2. Deepgram ($200 gratis, excelente calidad)
 * 3. Google Speech-to-Text (60 min/mes gratis)
 *
 * Compatible con audios de WhatsApp (OGG/Opus)
 */

const axios = require('axios');
const config = require('../../config');
const { logger } = require('../infrastructure/errorHandler');
const { getBreaker, SERVICES } = require('../infrastructure/circuitBreaker');

// Proveedores de transcripción
const azureSpeechProvider = require('./transcriptionProviders/azureSpeechProvider');
const deepgramProvider = require('./transcriptionProviders/deepgramProvider');
const googleProvider = require('./transcriptionProviders/googleSpeechProvider');

// Circuit breaker para el servicio de transcripción
const transcriptionBreaker = getBreaker(SERVICES.AZURE_AI || 'azure-ai');

// Decoder de OGG/Opus (se inicializa lazy)
let OggOpusDecoder = null;

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

  // 2. Azure Speech Services (5 hrs/mes gratis) - Recomendado para Azure
  if (audioConfig.azureSpeechKey && audioConfig.azureSpeechRegion) {
    providers.push({
      name: 'azure-speech',
      priority: 2,
      description: 'Azure Speech Services (5 hrs/mes gratis)',
    });
  }

  // 3. Deepgram ($200 gratis)
  if (audioConfig.deepgramApiKey) {
    providers.push({
      name: 'deepgram',
      priority: 3,
      description: 'Deepgram ($200 créditos gratis)',
    });
  }

  // 4. Google Speech-to-Text (60 min/mes gratis)
  if (audioConfig.googleApiKey) {
    providers.push({
      name: 'google',
      priority: 4,
      description: 'Google Speech (60 min/mes gratis)',
    });
  }

  return providers.sort((a, b) => a.priority - b.priority);
}

/**
 * Verifica si la transcripción está habilitada (cualquier proveedor)
 * @returns {boolean}
 */
function isEnabled() {
  const audioConfig = config.audio || {};

  // Azure Whisper
  const azureEnabled = audioConfig.enabled === true && audioConfig.endpoint && audioConfig.apiKey;

  // Deepgram
  const deepgramEnabled = Boolean(audioConfig.deepgramApiKey);

  // Google
  const googleEnabled = Boolean(audioConfig.googleApiKey);

  return azureEnabled || deepgramEnabled || googleEnabled;
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
 * Resamplea audio a una frecuencia objetivo (linear interpolation)
 * @param {Float32Array} samples - Muestras de audio
 * @param {number} fromRate - Frecuencia original
 * @param {number} toRate - Frecuencia objetivo
 * @returns {Float32Array} - Muestras resampleadas
 */
function _resample(samples, fromRate, toRate) {
  if (fromRate === toRate) {
    return samples;
  }

  const ratio = fromRate / toRate;
  const newLength = Math.round(samples.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, samples.length - 1);
    const t = srcIndex - srcIndexFloor;

    // Interpolación linear
    result[i] = samples[srcIndexFloor] * (1 - t) + samples[srcIndexCeil] * t;
  }

  return result;
}

/**
 * Convierte audio stereo a mono
 * @param {Float32Array[]} channelData - Array de canales
 * @returns {Float32Array} - Audio mono
 */
function stereoToMono(channelData) {
  // Validar que hay datos de audio
  if (!channelData || channelData.length === 0) {
    throw new Error('Error al decodificar audio: no se encontraron canales de audio');
  }

  if (channelData.length === 1) {
    return channelData[0];
  }

  // Validar que el primer canal tiene datos
  if (!channelData[0] || channelData[0].length === 0) {
    throw new Error('Error al decodificar audio: canal de audio sin muestras');
  }

  const samples = channelData[0].length;
  const mono = new Float32Array(samples);

  for (let i = 0; i < samples; i++) {
    // Promediar canales
    let sum = 0;
    for (let ch = 0; ch < channelData.length; ch++) {
      sum += channelData[ch][i];
    }
    mono[i] = sum / channelData.length;
  }

  return mono;
}

/**
 * Normaliza audio para mejor reconocimiento
 * @param {Float32Array} samples - Muestras de audio
 * @returns {Float32Array} - Audio normalizado
 */
function normalizeAudio(samples) {
  // Encontrar valor máximo absoluto
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > maxAbs) {
      maxAbs = abs;
    }
  }

  // Si el audio está muy silencioso o ya está normalizado, no hacer nada
  if (maxAbs < 0.01 || maxAbs > 0.9) {
    return samples;
  }

  // Normalizar a 0.9 de amplitud máxima
  const factor = 0.9 / maxAbs;
  const normalized = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    normalized[i] = samples[i] * factor;
  }

  return normalized;
}

/**
 * Convierte PCM float32 a WAV Buffer (mono, 16-bit)
 * @param {Float32Array} monoSamples - Muestras mono de audio
 * @param {number} sampleRate - Frecuencia de muestreo (default: 48000)
 * @returns {Buffer} - Buffer con audio WAV
 */
function pcmToWav(monoSamples, sampleRate = 48000) {
  const numChannels = 1; // Mono
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = monoSamples.length * bytesPerSample;

  // Crear buffer WAV
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size
  buffer.writeUInt16LE(1, 20); // AudioFormat (PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34); // BitsPerSample

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Escribir datos PCM (convertir float32 a int16)
  let offset = 44;
  for (let i = 0; i < monoSamples.length; i++) {
    // Clamp y convertir float32 [-1, 1] a int16
    const sample = Math.max(-1, Math.min(1, monoSamples[i]));
    const int16 = Math.round(sample * 32767);
    buffer.writeInt16LE(int16, offset);
    offset += 2;
  }

  return buffer;
}

/**
 * Convierte audio OGG/Opus a WAV para transcripción
 * - Convierte a mono
 * - Mantiene sample rate original (48kHz) para preservar calidad
 * - Normaliza el audio
 * @param {Buffer} oggBuffer - Buffer con audio OGG/Opus
 * @returns {Promise<Buffer>} - Buffer con audio WAV (mono, 48kHz, 16-bit)
 */
async function convertOggToWav(oggBuffer) {
  // Lazy load del decoder
  if (!OggOpusDecoder) {
    const { OggOpusDecoder: Decoder } = await import('ogg-opus-decoder');
    OggOpusDecoder = Decoder;
  }

  const decoder = new OggOpusDecoder();
  await decoder.ready;

  try {
    // Decodificar OGG/Opus a PCM
    const decodeResult = await decoder.decode(new Uint8Array(oggBuffer));

    // IMPORTANTE: Llamar a flush() para obtener los últimos samples de audio
    // Sin esto, las últimas palabras del audio se pierden
    const flushResult = await decoder.flush();

    // Combinar los samples de decode y flush
    let channelData = decodeResult.channelData;
    const sampleRate = decodeResult.sampleRate;

    // Si flush devolvió samples adicionales, concatenarlos
    if (flushResult && flushResult.channelData && flushResult.channelData.length > 0) {
      const flushSamples = flushResult.channelData[0]?.length || 0;
      if (flushSamples > 0) {
        logger.debug('Flush recuperó samples adicionales', { flushSamples });

        // Concatenar los canales
        const combinedChannels = [];
        for (let ch = 0; ch < channelData.length; ch++) {
          const originalSamples = channelData[ch] || new Float32Array(0);
          const additionalSamples = flushResult.channelData[ch] || new Float32Array(0);

          const combined = new Float32Array(originalSamples.length + additionalSamples.length);
          combined.set(originalSamples, 0);
          combined.set(additionalSamples, originalSamples.length);
          combinedChannels.push(combined);
        }
        channelData = combinedChannels;
      }
    }

    // Validar que la decodificación fue exitosa
    const channels = channelData?.length || 0;
    const samplesPerChannel = channelData?.[0]?.length || 0;

    logger.debug('Audio decodificado', {
      originalSampleRate: sampleRate,
      channels,
      samplesPerChannel,
      decodeSamples: decodeResult.channelData?.[0]?.length || 0,
      flushSamples: flushResult?.channelData?.[0]?.length || 0,
    });

    // Si no hay datos de audio, lanzar error para intentar con proveedor alternativo
    if (channels === 0 || samplesPerChannel === 0) {
      throw new Error('DECODE_EMPTY: El decodificador OGG/Opus no encontró datos de audio válidos');
    }

    // 1. Convertir a mono si es stereo
    let monoSamples = stereoToMono(channelData);

    // 2. Mantener sample rate original (sin resampleo para preservar calidad)
    // GPT-4o-mini-audio soporta múltiples sample rates

    // 3. Normalizar audio para mejor reconocimiento
    monoSamples = normalizeAudio(monoSamples);

    // 4. Convertir a WAV usando sample rate original
    const wavBuffer = pcmToWav(monoSamples, sampleRate);

    const durationSeconds = monoSamples.length / sampleRate;

    logger.debug('Audio convertido de OGG a WAV', {
      originalSize: oggBuffer.length,
      wavSize: wavBuffer.length,
      sampleRate: sampleRate,
      durationSeconds: durationSeconds.toFixed(2),
      originalChannels: channelData.length,
    });

    return wavBuffer;
  } finally {
    decoder.free();
  }
}

/**
 * Transcribe audio usando proveedores alternativos (Azure Speech, Deepgram o Google)
 * @param {Buffer} audioBuffer - Buffer con el audio
 * @param {Object} options - Opciones de transcripción
 * @returns {Promise<Object>} - Resultado de transcripción
 */
async function transcribeWithAlternativeProvider(audioBuffer, options = {}) {
  const audioConfig = config.audio || {};
  const mimeType = options.mimeType || 'audio/ogg';
  const errors = [];

  // 1. Intentar Azure Speech Services primero (5 hrs/mes gratis, mismo ecosistema)
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
    logger.warn('Azure Speech falló, intentando siguiente proveedor', { error: result.error });
  }

  // 2. Intentar Deepgram ($200 en créditos gratis)
  if (audioConfig.deepgramApiKey) {
    logger.debug('Intentando transcripción con Deepgram...');
    const result = await deepgramProvider.transcribe(audioBuffer, {
      apiKey: audioConfig.deepgramApiKey,
      mimeType,
    });

    if (result.success) {
      logger.info('Transcripción exitosa con Deepgram', {
        textLength: result.text?.length,
        duration: result.duration,
      });
      return result;
    }

    errors.push({ provider: 'deepgram', error: result.error, errorCode: result.errorCode });
    logger.warn('Deepgram falló, intentando siguiente proveedor', { error: result.error });
  }

  // 3. Intentar Google Speech como último recurso (60 min/mes gratis)
  if (audioConfig.googleApiKey) {
    logger.debug('Intentando transcripción con Google Speech...');
    const result = await googleProvider.transcribe(audioBuffer, {
      apiKey: audioConfig.googleApiKey,
      mimeType,
    });

    if (result.success) {
      logger.info('Transcripción exitosa con Google Speech', {
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
        ? `Todos los proveedores fallaron: ${errors.map((e) => e.error).join(', ')}`
        : 'No hay proveedores alternativos configurados',
    errors,
    duration: 0,
  };
}

/**
 * Transcribe un buffer de audio a texto
 * Usa múltiples proveedores con fallback automático:
 * 1. Azure OpenAI Whisper (si configurado)
 * 2. Deepgram ($200 gratis)
 * 3. Google Speech (60 min/mes gratis)
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
    logger.warn('Transcripción de audio: ningún proveedor configurado');
    return {
      success: false,
      text: null,
      error:
        'No hay proveedores de transcripción configurados. Configura DEEPGRAM_API_KEY o GOOGLE_SPEECH_API_KEY.',
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
      // Intentar fallback porque Deepgram/Azure Speech soportan OGG nativo
      shouldFallback = true;
      logger.warn('Error decodificando audio, intentando proveedores alternativos', {
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
