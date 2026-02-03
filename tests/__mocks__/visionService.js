/**
 * Mock - Azure Vision Service
 * Simula el servicio de OCR de Azure Computer Vision
 */

const OCR_ERROR_TYPES = {
    NETWORK: 'network_error',
    TIMEOUT: 'timeout',
    NO_TEXT: 'no_text_found',
    INVALID_IMAGE: 'invalid_image',
    QUOTA_EXCEEDED: 'quota_exceeded',
    RATE_LIMITED: 'rate_limited'
};

class OCRError extends Error {
    constructor(type, message, originalError = null) {
        super(message);
        this.type = type;
        this.originalError = originalError;
        this.name = 'OCRError';
    }

    getUserMessage() {
        const messages = {
            [OCR_ERROR_TYPES.NETWORK]: 'No pude procesar la imagen. Intenta de nuevo.',
            [OCR_ERROR_TYPES.TIMEOUT]: 'El procesamiento tardo demasiado. Intenta con otra imagen.',
            [OCR_ERROR_TYPES.NO_TEXT]: 'No encontre texto en la imagen.',
            [OCR_ERROR_TYPES.INVALID_IMAGE]: 'La imagen no es valida o esta danada.',
            [OCR_ERROR_TYPES.QUOTA_EXCEEDED]: 'Servicio temporalmente no disponible.',
            [OCR_ERROR_TYPES.RATE_LIMITED]: 'Demasiadas solicitudes. Espera un momento.'
        };
        return messages[this.type] || 'Error al procesar imagen.';
    }
}

// Almacenamiento de resultados configurados
const configuredResults = new Map();
let extractCallCount = 0;
let findSAPCallCount = 0;

const mockVisionService = {
    OCR_ERROR_TYPES,
    OCRError,

    // Contadores para verificacion
    __getExtractCallCount: () => extractCallCount,
    __getFindSAPCallCount: () => findSAPCallCount,

    // Reset para tests
    __reset: () => {
        configuredResults.clear();
        extractCallCount = 0;
        findSAPCallCount = 0;
    },

    // Configurar resultado para una imagen especifica
    __setResultForImage: (imageId, result) => {
        configuredResults.set(imageId, result);
    },

    // Configurar para lanzar error
    __setErrorForNextCall: (errorType, message) => {
        configuredResults.set('__next_error__', { type: errorType, message });
    },

    /**
     * Extrae texto de una imagen
     * @param {Buffer} imageBuffer - Buffer de la imagen
     * @returns {Promise<{text: string, lines: string[]}>}
     */
    extractTextFromImage: jest.fn().mockImplementation(async (imageBuffer) => {
        extractCallCount++;

        // Verificar si hay error configurado
        const errorConfig = configuredResults.get('__next_error__');
        if (errorConfig) {
            configuredResults.delete('__next_error__');
            throw new OCRError(errorConfig.type, errorConfig.message);
        }

        // Verificar tamano de imagen
        if (!imageBuffer || imageBuffer.length < 100) {
            throw new OCRError(
                OCR_ERROR_TYPES.INVALID_IMAGE,
                'Imagen muy pequena o invalida'
            );
        }

        if (imageBuffer.length > 10 * 1024 * 1024) {
            throw new OCRError(
                OCR_ERROR_TYPES.INVALID_IMAGE,
                'Imagen demasiado grande (max 10MB)'
            );
        }

        // Resultado por defecto
        return {
            text: 'SAP: 1234567\nModelo: VR-42\nCliente: OXXO',
            lines: [
                'SAP: 1234567',
                'Modelo: VR-42',
                'Cliente: OXXO'
            ],
            confidence: 0.95
        };
    }),

    /**
     * Busca un codigo SAP en el texto
     * @param {string|{lines: string[]}} input - Texto o resultado de OCR
     * @returns {string|null} - Codigo SAP encontrado o null
     */
    findSAPCode: jest.fn().mockImplementation((input) => {
        findSAPCallCount++;

        let text;
        if (typeof input === 'string') {
            text = input;
        } else if (input && input.lines) {
            text = input.lines.join('\n');
        } else {
            return null;
        }

        // Buscar patron de 7 digitos
        const sapPattern = /\b(\d{7})\b/g;
        const matches = text.match(sapPattern);

        if (matches && matches.length > 0) {
            return matches[0];
        }

        // Buscar con prefijo SAP
        const sapPrefixPattern = /SAP[:\s]*(\d{7})/i;
        const prefixMatch = text.match(sapPrefixPattern);

        if (prefixMatch) {
            return prefixMatch[1];
        }

        return null;
    }),

    /**
     * Valida si la imagen es procesable
     * @param {Buffer} imageBuffer
     * @returns {Promise<{valid: boolean, reason?: string}>}
     */
    validateImage: jest.fn().mockImplementation(async (imageBuffer) => {
        if (!imageBuffer) {
            return { valid: false, reason: 'No image provided' };
        }

        if (imageBuffer.length < 100) {
            return { valid: false, reason: 'Image too small' };
        }

        if (imageBuffer.length > 10 * 1024 * 1024) {
            return { valid: false, reason: 'Image too large' };
        }

        return { valid: true };
    })
};

module.exports = mockVisionService;
