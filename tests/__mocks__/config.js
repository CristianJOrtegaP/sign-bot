/**
 * Mock - Config
 * Configuración para tests
 */

module.exports = {
    isAIEnabled: true,

    ai: {
        enabled: true,
        provider: 'gemini',
        messageLengthThreshold: 30,
        confidence: {
            high: 0.9,
            medium: 0.7,
            low: 0.5,
            minimum: 0.3
        },
        gemini: {
            apiKey: 'test-gemini-key',
            model: 'gemini-1.5-flash'
        },
        azureOpenAI: {
            endpoint: 'https://test.openai.azure.com/',
            apiKey: 'test-azure-key',
            deploymentName: 'gpt-4'
        }
    },

    intents: {
        SALUDO: 'SALUDO',
        REPORTAR_FALLA: 'REPORTAR_FALLA',
        TIPO_REFRIGERADOR: 'TIPO_REFRIGERADOR',
        TIPO_VEHICULO: 'TIPO_VEHICULO',
        CONSULTAR_ESTADO: 'CONSULTAR_ESTADO',
        DESPEDIDA: 'DESPEDIDA',
        CANCELAR: 'CANCELAR',
        OTRO: 'OTRO'
    },

    equipmentTypes: {
        REFRIGERADOR: 'REFRIGERADOR',
        VEHICULO: 'VEHICULO',
        OTRO: 'OTRO'
    },

    whatsapp: {
        apiUrl: 'https://graph.facebook.com/v18.0',
        phoneNumberId: 'test-phone-id',
        accessToken: 'test-access-token',
        timeout: {
            defaultMs: 30000,
            mediaDownloadMs: 60000
        },
        retry: {
            maxRetries: 3,
            delayMs: 1000,
            retryOnCodes: ['ECONNABORTED', 'ETIMEDOUT']
        },
        limits: {
            buttonTitleMaxLength: 20
        }
    },

    database: {
        server: 'test-server',
        database: 'test-db',
        user: 'test-user',
        password: 'test-password',
        options: {
            encrypt: true,
            trustServerCertificate: false
        },
        pool: {
            max: 10,
            min: 0,
            idleTimeoutMillis: 30000
        },
        reconnectErrorCodes: ['ECONNRESET', 'ESOCKET']
    },

    vision: {
        endpoint: 'https://test-vision.cognitiveservices.azure.com/',
        apiKey: 'test-vision-key'
    },

    storage: {
        connectionString: 'test-storage-connection',
        containerName: 'test-images'
    },

    sessionTimeoutMinutes: 30,

    session: {
        warningMinutes: 25
    },

    rateLimit: {
        maxRequestsPerMinute: 60,
        maxRequestsPerHour: 200
    },

    cache: {
        equipoTTL: 3600000,
        sessionTTL: 1800000
    }
};
