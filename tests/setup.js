/**
 * Jest Setup - AC FixBot Tests
 * Configuración global para todos los tests
 */

// Silenciar console.log durante tests (excepto errores)
global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: console.error
};

// Mock de variables de entorno
process.env.NODE_ENV = 'test';
process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
process.env.WHATSAPP_PHONE_ID = 'test-phone-id';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.AZURE_VISION_ENDPOINT = 'https://test-vision.cognitiveservices.azure.com/';
process.env.AZURE_VISION_KEY = 'test-vision-key';
process.env.SQL_SERVER = 'test-server';
process.env.SQL_DATABASE = 'test-db';
process.env.SQL_USER = 'test-user';
process.env.SQL_PASSWORD = 'test-password';
process.env.AZURE_STORAGE_CONNECTION_STRING = 'test-storage-connection';
process.env.AI_PROVIDER = 'gemini';
process.env.AI_ENABLED = 'true';

// Timeout para tests async
jest.setTimeout(10000);

// Limpiar todos los mocks después de cada test
afterEach(() => {
    jest.clearAllMocks();
});

// Helper global para crear contexto de Azure Functions
global.createMockContext = () => ({
    log: jest.fn(),
    log_error: jest.fn(),
    log_warn: jest.fn(),
    bindings: {},
    res: {}
});

// Helper para simular delays
global.delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

console.info('Test environment initialized');
