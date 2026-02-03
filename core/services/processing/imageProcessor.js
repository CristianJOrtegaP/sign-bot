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
                compressedSize: `${(compressedSize / 1024).toFixed(1)}KB`
            });
            return {
                buffer: imageBuffer,
                originalSize,
                compressedSize: originalSize
            };
        }

        const savings = ((1 - compressedSize / originalSize) * 100).toFixed(1);
        logger.info('Imagen comprimida', {
            originalSize: `${(originalSize / 1024).toFixed(1)}KB`,
            compressedSize: `${(compressedSize / 1024).toFixed(1)}KB`,
            savings: `${savings}%`
        });

        return {
            buffer: compressedBuffer,
            originalSize,
            compressedSize
        };
    } catch (error) {
        logger.warn('Error comprimiendo imagen, usando original', { error: error.message });
        return {
            buffer: imageBuffer,
            originalSize,
            compressedSize: originalSize
        };
    }
}

module.exports = {
    compressImage,
    MAX_WIDTH,
    MAX_HEIGHT,
    JPEG_QUALITY
};
