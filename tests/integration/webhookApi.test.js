/**
 * Tests - WhatsApp Webhook API
 * Pruebas de integración para el endpoint principal del webhook
 */

// Mocks
jest.mock('../../core/services/external/whatsappService', () => require('../__mocks__/whatsappService'));
jest.mock('../../core/services/storage/databaseService', () => require('../__mocks__/databaseService'));
jest.mock('../../core/services/ai/aiService', () => require('../__mocks__/aiService'));
jest.mock('../../core/config', () => require('../__mocks__/config'));

jest.mock('../../core/services/ai/intentService', () => ({
    detectIntent: jest.fn().mockResolvedValue({
        intencion: 'SALUDO',
        confianza: 0.95,
        metodo: 'mock',
        datos_extraidos: {}
    })
}));

jest.mock('../../core/services/infrastructure/metricsService', () => require('../__mocks__/metricsService'));

jest.mock('../../core/services/infrastructure/rateLimiter', () => ({
    checkRateLimit: jest.fn().mockReturnValue({ allowed: true }),
    recordRequest: jest.fn(),
    isSpamming: jest.fn().mockReturnValue(false),
    isDuplicateMessage: jest.fn().mockReturnValue(false)
}));

jest.mock('../../bot/controllers/messageHandler', () => ({
    handleText: jest.fn().mockResolvedValue(undefined),
    handleButton: jest.fn().mockResolvedValue(undefined),
    handleLocation: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../bot/controllers/imageHandler', () => ({
    handleImage: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../core/services/infrastructure/securityService', () => ({
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    sanitizeInput: jest.fn().mockImplementation((input) => input)
}));

const webhook = require('../../api-whatsapp-webhook');
const rateLimiter = require('../../core/services/infrastructure/rateLimiter');
const messageHandler = require('../../bot/controllers/messageHandler');
const imageHandler = require('../../bot/controllers/imageHandler');
const db = require('../../core/services/storage/databaseService');

describe('WhatsApp Webhook API', () => {
    let mockContext;

    beforeEach(() => {
        jest.clearAllMocks();
        db.__reset();

        mockContext = {
            log: jest.fn(),
            log_error: jest.fn(),
            log_warn: jest.fn(),
            res: {}
        };
        mockContext.log.warn = jest.fn();
        mockContext.log.error = jest.fn();

        process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
    });

    describe('GET - Webhook Verification', () => {
        test('debe verificar webhook correctamente con token válido', async () => {
            const req = {
                method: 'GET',
                query: {
                    'hub.mode': 'subscribe',
                    'hub.verify_token': 'test-verify-token',
                    'hub.challenge': '123456789'
                }
            };

            await webhook(mockContext, req);

            expect(mockContext.res.status).toBe(200);
            expect(mockContext.res.body).toBe(123456789);
        });

        test('debe rechazar verificación con token inválido', async () => {
            const req = {
                method: 'GET',
                query: {
                    'hub.mode': 'subscribe',
                    'hub.verify_token': 'wrong-token',
                    'hub.challenge': '123456789'
                }
            };

            await webhook(mockContext, req);

            expect(mockContext.res.status).toBe(403);
            expect(mockContext.res.body).toBe('Forbidden');
        });

        test('debe rechazar verificación con modo incorrecto', async () => {
            const req = {
                method: 'GET',
                query: {
                    'hub.mode': 'unsubscribe',
                    'hub.verify_token': 'test-verify-token',
                    'hub.challenge': '123456789'
                }
            };

            await webhook(mockContext, req);

            expect(mockContext.res.status).toBe(403);
        });
    });

    describe('POST - Message Processing', () => {
        test('debe procesar mensaje de texto correctamente', async () => {
            const req = {
                method: 'POST',
                headers: { 'x-hub-signature-256': 'sha256=mock-signature' },
                body: {
                    object: 'whatsapp_business_account',
                    entry: [{
                        changes: [{
                            value: {
                                messages: [{
                                    from: '+5215540829614',
                                    type: 'text',
                                    id: 'msg_123',
                                    text: { body: 'Hola' }
                                }]
                            }
                        }]
                    }]
                }
            };

            await webhook(mockContext, req);

            expect(messageHandler.handleText).toHaveBeenCalledWith(
                '+5215540829614',
                'Hola',
                'msg_123',
                mockContext
            );
            expect(mockContext.res.status).toBe(200);
        });

        test('debe procesar imagen correctamente', async () => {
            const req = {
                method: 'POST',
                headers: { 'x-hub-signature-256': 'sha256=mock-signature' },
                body: {
                    object: 'whatsapp_business_account',
                    entry: [{
                        changes: [{
                            value: {
                                messages: [{
                                    from: '+5215540829614',
                                    type: 'image',
                                    id: 'msg_456',
                                    image: { id: 'img_123' }
                                }]
                            }
                        }]
                    }]
                }
            };

            await webhook(mockContext, req);

            expect(imageHandler.handleImage).toHaveBeenCalledWith(
                '+5215540829614',
                { id: 'img_123' },
                'msg_456',
                mockContext
            );
            expect(mockContext.res.status).toBe(200);
        });

        test('debe procesar botón interactivo correctamente', async () => {
            const req = {
                method: 'POST',
                headers: { 'x-hub-signature-256': 'sha256=mock-signature' },
                body: {
                    object: 'whatsapp_business_account',
                    entry: [{
                        changes: [{
                            value: {
                                messages: [{
                                    from: '+5215540829614',
                                    type: 'interactive',
                                    id: 'msg_789',
                                    interactive: {
                                        button_reply: { id: 'btn_tipo_refrigerador' }
                                    }
                                }]
                            }
                        }]
                    }]
                }
            };

            await webhook(mockContext, req);

            expect(messageHandler.handleButton).toHaveBeenCalledWith(
                '+5215540829614',
                'btn_tipo_refrigerador',
                'msg_789',
                mockContext
            );
            expect(mockContext.res.status).toBe(200);
        });

        test('debe procesar ubicación correctamente', async () => {
            const req = {
                method: 'POST',
                headers: { 'x-hub-signature-256': 'sha256=mock-signature' },
                body: {
                    object: 'whatsapp_business_account',
                    entry: [{
                        changes: [{
                            value: {
                                messages: [{
                                    from: '+5215540829614',
                                    type: 'location',
                                    id: 'msg_loc',
                                    location: { latitude: 19.4326, longitude: -99.1332 }
                                }]
                            }
                        }]
                    }]
                }
            };

            await webhook(mockContext, req);

            expect(messageHandler.handleLocation).toHaveBeenCalledWith(
                '+5215540829614',
                { latitude: 19.4326, longitude: -99.1332 },
                'msg_loc',
                mockContext
            );
        });

        test('debe ignorar mensajes duplicados (memoria)', async () => {
            rateLimiter.isDuplicateMessage.mockReturnValueOnce(true);

            const req = {
                method: 'POST',
                headers: { 'x-hub-signature-256': 'sha256=mock-signature' },
                body: {
                    object: 'whatsapp_business_account',
                    entry: [{
                        changes: [{
                            value: {
                                messages: [{
                                    from: '+5215540829614',
                                    type: 'text',
                                    id: 'msg_dup',
                                    text: { body: 'Duplicado' }
                                }]
                            }
                        }]
                    }]
                }
            };

            await webhook(mockContext, req);

            expect(messageHandler.handleText).not.toHaveBeenCalled();
            expect(mockContext.res.status).toBe(200);
        });

        test('debe ignorar mensajes duplicados (BD)', async () => {
            db.isMessageProcessed.mockResolvedValueOnce(true);

            const req = {
                method: 'POST',
                headers: { 'x-hub-signature-256': 'sha256=mock-signature' },
                body: {
                    object: 'whatsapp_business_account',
                    entry: [{
                        changes: [{
                            value: {
                                messages: [{
                                    from: '+5215540829614',
                                    type: 'text',
                                    id: 'msg_db_dup',
                                    text: { body: 'Duplicado BD' }
                                }]
                            }
                        }]
                    }]
                }
            };

            await webhook(mockContext, req);

            expect(messageHandler.handleText).not.toHaveBeenCalled();
            expect(mockContext.res.status).toBe(200);
        });

        test('debe ignorar eventos que no son de WhatsApp', async () => {
            const req = {
                method: 'POST',
                headers: { 'x-hub-signature-256': 'sha256=mock-signature' },
                body: {
                    object: 'other_service',
                    entry: []
                }
            };

            await webhook(mockContext, req);

            expect(messageHandler.handleText).not.toHaveBeenCalled();
            expect(mockContext.res.status).toBe(200);
        });

        test('debe ignorar notificaciones de estado (sin mensaje)', async () => {
            const req = {
                method: 'POST',
                headers: { 'x-hub-signature-256': 'sha256=mock-signature' },
                body: {
                    object: 'whatsapp_business_account',
                    entry: [{
                        changes: [{
                            value: {
                                statuses: [{ id: 'status_123', status: 'delivered' }]
                            }
                        }]
                    }]
                }
            };

            await webhook(mockContext, req);

            expect(messageHandler.handleText).not.toHaveBeenCalled();
            expect(mockContext.res.status).toBe(200);
        });

        test('debe manejar errores sin lanzar excepción', async () => {
            messageHandler.handleText.mockRejectedValueOnce(new Error('Test error'));

            const req = {
                method: 'POST',
                headers: { 'x-hub-signature-256': 'sha256=mock-signature' },
                body: {
                    object: 'whatsapp_business_account',
                    entry: [{
                        changes: [{
                            value: {
                                messages: [{
                                    from: '+5215540829614',
                                    type: 'text',
                                    id: 'msg_error',
                                    text: { body: 'Error test' }
                                }]
                            }
                        }]
                    }]
                }
            };

            await webhook(mockContext, req);

            // Siempre responde 200 para evitar reintentos de Meta
            expect(mockContext.res.status).toBe(200);
        });

        test('debe manejar tipos de mensaje no soportados', async () => {
            const req = {
                method: 'POST',
                headers: { 'x-hub-signature-256': 'sha256=mock-signature' },
                body: {
                    object: 'whatsapp_business_account',
                    entry: [{
                        changes: [{
                            value: {
                                messages: [{
                                    from: '+5215540829614',
                                    type: 'sticker',
                                    id: 'msg_sticker'
                                }]
                            }
                        }]
                    }]
                }
            };

            await webhook(mockContext, req);

            expect(messageHandler.handleText).not.toHaveBeenCalled();
            expect(mockContext.res.status).toBe(200);
        });

        test('debe ignorar botones de encuesta si falla BD (protección race condition)', async () => {
            db.isMessageProcessed.mockRejectedValueOnce(new Error('DB Error'));

            const req = {
                method: 'POST',
                headers: { 'x-hub-signature-256': 'sha256=mock-signature' },
                body: {
                    object: 'whatsapp_business_account',
                    entry: [{
                        changes: [{
                            value: {
                                messages: [{
                                    from: '+5215540829614',
                                    type: 'interactive',
                                    id: 'msg_rating',
                                    interactive: {
                                        button_reply: { id: 'btn_rating_5' }
                                    }
                                }]
                            }
                        }]
                    }]
                }
            };

            await webhook(mockContext, req);

            expect(messageHandler.handleButton).not.toHaveBeenCalled();
            expect(mockContext.res.status).toBe(200);
        });

        test('debe continuar procesando mensaje normal si falla BD', async () => {
            db.isMessageProcessed.mockRejectedValueOnce(new Error('DB Error'));

            const req = {
                method: 'POST',
                headers: { 'x-hub-signature-256': 'sha256=mock-signature' },
                body: {
                    object: 'whatsapp_business_account',
                    entry: [{
                        changes: [{
                            value: {
                                messages: [{
                                    from: '+5215540829614',
                                    type: 'text',
                                    id: 'msg_normal',
                                    text: { body: 'Mensaje normal' }
                                }]
                            }
                        }]
                    }]
                }
            };

            await webhook(mockContext, req);

            // A diferencia de botones de encuesta, mensajes normales continúan procesándose
            expect(messageHandler.handleText).toHaveBeenCalled();
            expect(mockContext.res.status).toBe(200);
        });

        test('debe guardar en dead letter cuando falla procesamiento de mensaje con ubicación', async () => {
            messageHandler.handleLocation.mockRejectedValueOnce(new Error('Location error'));

            const req = {
                method: 'POST',
                headers: { 'x-hub-signature-256': 'sha256=mock-signature' },
                body: {
                    object: 'whatsapp_business_account',
                    entry: [{
                        changes: [{
                            value: {
                                messages: [{
                                    from: '+5215540829614',
                                    type: 'location',
                                    id: 'msg_loc_error',
                                    location: { latitude: 19.4326, longitude: -99.1332 }
                                }]
                            }
                        }]
                    }]
                }
            };

            await webhook(mockContext, req);

            // Siempre responde 200
            expect(mockContext.res.status).toBe(200);
            expect(mockContext.log.error).toHaveBeenCalled();
        });

        test('debe guardar en dead letter cuando falla procesamiento de imagen', async () => {
            imageHandler.handleImage.mockRejectedValueOnce(new Error('Image error'));

            const req = {
                method: 'POST',
                headers: { 'x-hub-signature-256': 'sha256=mock-signature' },
                body: {
                    object: 'whatsapp_business_account',
                    entry: [{
                        changes: [{
                            value: {
                                messages: [{
                                    from: '+5215540829614',
                                    type: 'image',
                                    id: 'msg_img_error',
                                    image: { id: 'img_fail' }
                                }]
                            }
                        }]
                    }]
                }
            };

            await webhook(mockContext, req);

            // Siempre responde 200
            expect(mockContext.res.status).toBe(200);
            expect(mockContext.log.error).toHaveBeenCalled();
        });

        test('debe incluir correlation ID en respuesta', async () => {
            const req = {
                method: 'POST',
                headers: { 'x-hub-signature-256': 'sha256=mock-signature' },
                body: {
                    object: 'whatsapp_business_account',
                    entry: [{
                        changes: [{
                            value: {
                                messages: [{
                                    from: '+5215540829614',
                                    type: 'text',
                                    id: 'msg_corr',
                                    text: { body: 'Test correlation' }
                                }]
                            }
                        }]
                    }]
                }
            };

            await webhook(mockContext, req);

            expect(mockContext.res.headers).toBeDefined();
            expect(mockContext.res.headers['x-correlation-id']).toBeDefined();
        });
    });
});
