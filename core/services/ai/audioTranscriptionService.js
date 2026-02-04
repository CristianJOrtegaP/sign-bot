/**
 * AC FIXBOT - Servicio de Transcripción de Audio
 * Usa Azure OpenAI GPT-4o-mini-audio para transcribir mensajes de voz a texto
 * Compatible con audios de WhatsApp (OGG/Opus)
 *
 * NOTA: Se migró de Whisper a GPT-4o-mini-audio por mejor disponibilidad de cuota
 * GPT-4o-mini-audio usa Chat Completions API en lugar del endpoint de transcripciones
 * OGG/Opus se convierte a WAV antes de enviar a la API
 */

const axios = require('axios');
const config = require('../../config');
const { logger } = require('../infrastructure/errorHandler');
const { getBreaker, SERVICES } = require('../infrastructure/circuitBreaker');

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
 * Verifica si la transcripción está habilitada y configurada
 * @returns {boolean}
 */
function isEnabled() {
  const audioConfig = config.audio || {};
  // Usa endpoint dedicado para audio (puede ser recurso separado de Whisper)
  const endpoint = audioConfig.endpoint;
  const apiKey = audioConfig.apiKey;
  return audioConfig.enabled === true && endpoint && apiKey;
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
  if (channelData.length === 1) {
    return channelData[0];
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
    const { channelData, sampleRate } = await decoder.decode(new Uint8Array(oggBuffer));

    logger.debug('Audio decodificado', {
      originalSampleRate: sampleRate,
      channels: channelData.length,
      samplesPerChannel: channelData[0]?.length || 0,
    });

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
 * Transcribe un buffer de audio a texto usando Azure OpenAI GPT-4o-mini-audio
 * Usa Chat Completions API con audio input en lugar del endpoint de transcripciones
 * @param {Buffer} audioBuffer - Buffer con el contenido del audio
 * @param {Object} options - Opciones adicionales
 * @param {string} options.mimeType - Tipo MIME del audio (default: audio/ogg)
 * @param {string} options.filename - Nombre del archivo (default: audio.ogg)
 * @returns {Promise<Object>} - Objeto con texto transcrito y metadata
 */
async function transcribeAudio(audioBuffer, options = {}) {
  if (!isEnabled()) {
    logger.warn('Transcripción de audio deshabilitada o no configurada');
    return {
      success: false,
      text: null,
      error: 'Transcripción no habilitada',
      duration: 0,
    };
  }

  // Verificar circuit breaker
  const check = transcriptionBreaker.canExecute();
  if (!check.allowed) {
    logger.warn('Circuit breaker abierto para transcripción', { reason: check.reason });
    return {
      success: false,
      text: null,
      error: 'Servicio temporalmente no disponible',
      duration: 0,
    };
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

    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;

      if (status === 400) {
        errorMessage = 'Audio inválido o formato no soportado';
        errorCode = 'INVALID_AUDIO';
      } else if (status === 401 || status === 403) {
        errorMessage = 'Error de autenticación con Azure OpenAI';
        errorCode = 'AUTH_ERROR';
      } else if (status === 404) {
        errorMessage = 'Deployment de audio no encontrado';
        errorCode = 'DEPLOYMENT_NOT_FOUND';
      } else if (status === 429) {
        errorMessage = 'Límite de tasa excedido, intenta más tarde';
        errorCode = 'RATE_LIMIT';
      } else if (status >= 500) {
        errorMessage = 'Error del servidor de Azure OpenAI';
        errorCode = 'SERVER_ERROR';
      }

      logger.error('Error en transcripción de audio', error, {
        status,
        data: JSON.stringify(data).substring(0, 500),
        errorCode,
      });
    } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      errorMessage = 'Timeout al transcribir audio';
      errorCode = 'TIMEOUT';
      logger.error('Timeout en transcripción', error, { durationMs: duration });
    } else if (error.message && error.message.includes('decode')) {
      errorMessage = 'Error al decodificar audio OGG/Opus';
      errorCode = 'DECODE_ERROR';
      logger.error('Error decodificando audio', error);
    } else {
      logger.error('Error inesperado en transcripción', error);
    }

    return {
      success: false,
      text: null,
      error: errorMessage,
      errorCode,
      duration,
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
  isSupportedAudioFormat,
  getStats,
  TRANSCRIPTION_CONFIG,
};
