/**
 * AC FIXBOT - Test Factory
 * Utilidades para crear objetos de prueba
 */

/**
 * Crea un mock del objeto context de Azure Functions
 * @param {Object} overrides - Propiedades a sobrescribir
 * @returns {Object} - Context mock
 */
function createMockContext(overrides = {}) {
    return {
        log: jest.fn(),
        res: null,
        ...overrides
    };
}

/**
 * Crea un mock del objeto request de Azure Functions
 * @param {Object} options - Opciones de configuracion
 * @returns {Object} - Request mock
 */
function createMockRequest(options = {}) {
    const {
        method = 'POST',
        body = {},
        query = {},
        headers = {}
    } = options;

    return {
        method,
        body,
        query,
        headers: {
            'content-type': 'application/json',
            ...headers
        }
    };
}

/**
 * Crea un mock de whatsappService
 * @returns {Object} - WhatsApp service mock
 */
function createMockWhatsAppService() {
    return {
        sendTextMessage: jest.fn().mockResolvedValue(true),
        sendButtons: jest.fn().mockResolvedValue(true),
        sendTypingIndicator: jest.fn().mockResolvedValue(true),
        markAsRead: jest.fn().mockResolvedValue(true),
        downloadMedia: jest.fn().mockResolvedValue(Buffer.from('test'))
    };
}

/**
 * Crea un mock de databaseService
 * @param {Object} overrides - Metodos a sobrescribir
 * @returns {Object} - Database service mock
 */
function createMockDatabaseService(overrides = {}) {
    return {
        getSession: jest.fn().mockResolvedValue(null),
        createSession: jest.fn().mockResolvedValue({ SesionId: 1 }),
        updateSession: jest.fn().mockResolvedValue(true),
        getEquipoBySAP: jest.fn().mockResolvedValue(null),
        createReporte: jest.fn().mockResolvedValue('TKT123456789'),
        saveMessage: jest.fn().mockResolvedValue(true),
        isMessageProcessed: jest.fn().mockResolvedValue(false),
        markMessageAsProcessed: jest.fn().mockResolvedValue(true),
        ...overrides
    };
}

/**
 * Crea un mock de aiService
 * @returns {Object} - AI service mock
 */
function createMockAIService() {
    return {
        analyzeMessage: jest.fn().mockResolvedValue({
            intent: 'SALUDO',
            confidence: 0.9
        }),
        extractSAPCode: jest.fn().mockResolvedValue(null)
    };
}

/**
 * Simula un delay
 * @param {number} ms - Milisegundos a esperar
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => { setTimeout(resolve, ms); });
}

/**
 * Crea un spy que registra llamadas
 * @returns {Function} - Funcion spy
 */
function createSpy() {
    const calls = [];
    const spy = (...args) => {
        calls.push(args);
        return spy.returnValue;
    };
    spy.calls = calls;
    spy.returnValue = undefined;
    spy.reset = () => { calls.length = 0; };
    return spy;
}

module.exports = {
    createMockContext,
    createMockRequest,
    createMockWhatsAppService,
    createMockDatabaseService,
    createMockAIService,
    delay,
    createSpy
};
