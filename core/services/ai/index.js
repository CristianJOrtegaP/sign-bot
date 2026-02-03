/**
 * AC FIXBOT - Servicios de IA (Barrel File)
 * Exporta todos los servicios de IA desde un único punto
 */

const aiService = require('./aiService');
const intentService = require('./intentService');
const visionService = require('./visionService');

module.exports = {
    // AI Service - Factory de proveedores
    ...aiService,

    // Intent Service - Detección de intenciones
    detectIntent: intentService.detectIntent,

    // Vision Service - OCR y procesamiento de imágenes
    ...visionService
};
