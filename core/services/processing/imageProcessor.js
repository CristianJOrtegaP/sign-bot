/**
 * AC FIXBOT - Procesador de Imágenes
 * Comprime y redimensiona imágenes antes de almacenarlas
 * Usa Jimp (JavaScript puro, sin binarios nativos)
 */

const { Jimp } = require('jimp');
const { logger } = require('../infrastructure/errorHandler');

// Configuración de compresión
const MAX_WIDTH = 800;
const MAX_HEIGHT = 800;
const JPEG_QUALITY = 75;

/**
 * Comprime y redimensiona una imagen
 * @param {Buffer} imageBuffer - Buffer de la imagen original
 * @returns {Promise<{buffer: Buffer, originalSize: number, compressedSize: number}>}
 */
async function compressImage(imageBuffer) {
  const originalSize = imageBuffer.length;

  try {
    const image = await Jimp.read(imageBuffer);

    // Redimensionar manteniendo proporción si excede los límites
    if (image.width > MAX_WIDTH || image.height > MAX_HEIGHT) {
      image.scaleToFit({ w: MAX_WIDTH, h: MAX_HEIGHT });
    }

    // Convertir a JPEG con calidad especificada
    const compressedBuffer = await image.getBuffer('image/jpeg', { quality: JPEG_QUALITY });
    const compressedSize = compressedBuffer.length;

    // Usar imagen original si la comprimida es más grande
    if (compressedSize >= originalSize) {
      logger.info('Imagen ya optimizada, usando original', {
        originalSize: `${(originalSize / 1024).toFixed(1)}KB`,
        compressedSize: `${(compressedSize / 1024).toFixed(1)}KB`,
      });
      return {
        buffer: imageBuffer,
        originalSize,
        compressedSize: originalSize,
      };
    }

    const savings = ((1 - compressedSize / originalSize) * 100).toFixed(1);
    logger.info('Imagen comprimida', {
      originalSize: `${(originalSize / 1024).toFixed(1)}KB`,
      compressedSize: `${(compressedSize / 1024).toFixed(1)}KB`,
      savings: `${savings}%`,
    });

    return {
      buffer: compressedBuffer,
      originalSize,
      compressedSize,
    };
  } catch (error) {
    logger.warn('Error comprimiendo imagen, usando original', { error: error.message });
    return {
      buffer: imageBuffer,
      originalSize,
      compressedSize: originalSize,
    };
  }
}

/**
 * Detecta si una imagen es borrosa usando varianza del Laplaciano.
 * Un score bajo indica imagen desenfocada/borrosa.
 * @param {Buffer} imageBuffer - Buffer de la imagen
 * @param {number} threshold - Umbral de blur (default: 100). Menor = más borroso
 * @returns {Promise<{isBlurry: boolean, score: number, threshold: number}>}
 */
async function detectBlur(imageBuffer, threshold = 100) {
  try {
    const image = await Jimp.read(imageBuffer);

    // Redimensionar a max 200px para cálculo rápido (no afecta precisión)
    if (image.width > 200 || image.height > 200) {
      image.scaleToFit({ w: 200, h: 200 });
    }

    image.greyscale();

    const { data, width, height } = image.bitmap;
    const pixelCount = width * height;

    // Calcular Laplaciano: L(x,y) = 4*I(x,y) - I(x-1,y) - I(x+1,y) - I(x,y-1) - I(x,y+1)
    const laplacianValues = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4; // RGBA, usamos R (ya es greyscale)
        const center = data[idx];
        const left = data[idx - 4];
        const right = data[idx + 4];
        const up = data[idx - width * 4];
        const down = data[idx + width * 4];
        laplacianValues.push(4 * center - left - right - up - down);
      }
    }

    // Varianza del Laplaciano
    const n = laplacianValues.length;
    if (n === 0) {
      return { isBlurry: false, score: 999, threshold };
    }

    const mean = laplacianValues.reduce((a, b) => a + b, 0) / n;
    const variance = laplacianValues.reduce((sum, val) => sum + (val - mean) ** 2, 0) / n;

    const isBlurry = variance < threshold;

    logger.info('Detección de blur', {
      score: variance.toFixed(1),
      threshold,
      isBlurry,
      dimensions: `${width}x${height}`,
      pixelCount,
    });

    return { isBlurry, score: Math.round(variance), threshold };
  } catch (error) {
    logger.warn('Error en detección de blur, continuando sin filtro', { error: error.message });
    return { isBlurry: false, score: -1, threshold };
  }
}

module.exports = {
  compressImage,
  detectBlur,
  MAX_WIDTH,
  MAX_HEIGHT,
  JPEG_QUALITY,
};
