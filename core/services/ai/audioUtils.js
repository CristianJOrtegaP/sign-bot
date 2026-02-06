/**
 * AC FIXBOT - Utilidades de Procesamiento de Audio
 * Funciones para conversión, normalización y transformación de audio
 */

const { logger } = require('../infrastructure/errorHandler');

// Decoder de OGG/Opus (se inicializa lazy)
let OggOpusDecoder = null;

/**
 * Resamplea audio a una frecuencia objetivo (linear interpolation)
 * @param {Float32Array} samples - Muestras de audio
 * @param {number} fromRate - Frecuencia original
 * @param {number} toRate - Frecuencia objetivo
 * @returns {Float32Array} - Muestras resampleadas
 */
function resample(samples, fromRate, toRate) {
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

module.exports = {
  resample,
  stereoToMono,
  normalizeAudio,
  pcmToWav,
  convertOggToWav,
};
