/**
 * Tests - Message Handler
 * Pruebas del controlador principal de mensajes
 */

// Mocks
jest.mock('../../core/services/external/whatsappService', () => require('../__mocks__/whatsappService'));
jest.mock('../../core/services/storage/databaseService', () => require('../__mocks__/databaseService'));
jest.mock('../../core/services/ai/aiService', () => require('../__mocks__/aiService'));
jest.mock('../../core/config', () => require('../__mocks__/config'));

jest.mock('../../core/services/ai/intentService', () => ({
    detectIntent: jest.fn().mockResolvedValue({
        intencion: 'OTRO',
        confianza: 0.5,
        metodo: 'mock',
        datos_extraidos: {}
    })
}));

jest.mock('../../core/services/infrastructure/metricsService', () => ({
    startTimer: jest.fn(() => ({ end: jest.fn() })),
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn(),
    recordError: jest.fn()
}));

jest.mock('../../core/services/infrastructure/rateLimiter', () => ({
    checkRateLimit: jest.fn().mockReturnValue({ allowed: true }),
    recordRequest: jest.fn(),
    isSpamming: jest.fn().mockReturnValue(false),
    isDuplicateMessage: jest.fn().mockReturnValue(false)
}));

const messageHandler = require('../../bot/controllers/messageHandler');
const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');
const intentService = require('../../core/services/ai/intentService');
const rateLimiter = require('../../core/services/infrastructure/rateLimiter');

describe('MessageHandler', () => {
    let mockContext;

    beforeEach(() => {
        // Reset todos los mocks
        jest.clearAllMocks();
        whatsapp.__reset();
        db.__reset();

        // Crear mock context
        mockContext = {
            log: jest.fn(),
            log_error: jest.fn(),
            log_warn: jest.fn()
        };
        mockContext.log.warn = jest.fn();
        mockContext.log.error = jest.fn();
    });

    describe('handleText - Rate Limiting', () => {
        test('debe bloquear mensaje si excede rate limit', async () => {
            rateLimiter.checkRateLimit.mockReturnValueOnce({
                allowed: false,
                reason: 'Demasiadas solicitudes'
            });

            await messageHandler.handleText('+5215512345678', 'hola', 'msg_123', mockContext);

            expect(whatsapp.sendText).toHaveBeenCalledWith(
                '+5215512345678',
                expect.stringContaining('Demasiadas solicitudes')
            );
        });

        test('debe bloquear si detecta spam local', async () => {
            rateLimiter.isSpamming.mockReturnValueOnce(true);

            await messageHandler.handleText('+5215512345678', 'hola', 'msg_123', mockContext);

            expect(whatsapp.sendText).toHaveBeenCalledWith(
                '+5215512345678',
                expect.stringContaining('Espera')
            );
        });

        test('debe bloquear si detecta spam en BD', async () => {
            db.checkSpam.mockResolvedValueOnce({
                esSpam: true,
                totalMensajes: 50,
                razon: 'Excede límite por hora'
            });

            await messageHandler.handleText('+5215512345678', 'hola', 'msg_123', mockContext);

            expect(whatsapp.sendText).toHaveBeenCalledWith(
                '+5215512345678',
                expect.stringContaining('Espera')
            );
        });

        test('debe permitir mensaje si pasa todos los checks', async () => {
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'SALUDO',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });

            await messageHandler.handleText('+5215512345678', 'hola', 'msg_123', mockContext);

            expect(rateLimiter.recordRequest).toHaveBeenCalled();
            expect(whatsapp.sendTypingIndicator).toHaveBeenCalled();
        });
    });

    describe('handleText - Intenciones', () => {
        test('debe manejar SALUDO mostrando bienvenida', async () => {
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'SALUDO',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });

            await messageHandler.handleText('+5215512345678', 'hola', 'msg_123', mockContext);

            expect(whatsapp.sendInteractiveMessage).toHaveBeenCalledWith(
                '+5215512345678',
                expect.any(String),
                expect.any(String),
                expect.arrayContaining([
                    expect.objectContaining({ id: 'btn_tipo_refrigerador' }),
                    expect.objectContaining({ id: 'btn_tipo_vehiculo' })
                ])
            );
        });

        test('debe manejar DESPEDIDA reiniciando sesión', async () => {
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'DESPEDIDA',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });

            await messageHandler.handleText('+5215512345678', 'adiós', 'msg_123', mockContext);

            expect(whatsapp.sendText).toHaveBeenCalledWith(
                '+5215512345678',
                expect.stringContaining('pronto')
            );
            expect(db.updateSession).toHaveBeenCalledWith(
                '+5215512345678',
                'INICIO',
                null,
                null,
                expect.any(String),
                expect.any(String)
            );
        });

        test('debe manejar CANCELAR cuando hay flujo activo', async () => {
            // Configurar sesión en flujo activo
            db.__setSession('+5215512345678', { Estado: 'REFRI_ESPERA_SAP' });

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'CANCELAR',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });

            await messageHandler.handleText('+5215512345678', 'cancelar', 'msg_123', mockContext);

            // Debería haber cancelado el flujo
            expect(db.updateSession).toHaveBeenCalled();
        });
    });

    describe('handleText - Typing Indicator', () => {
        test('debe enviar typing indicator al inicio', async () => {
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'SALUDO',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });

            await messageHandler.handleText('+5215512345678', 'hola', 'msg_123', mockContext);

            expect(whatsapp.sendTypingIndicator).toHaveBeenCalledWith('+5215512345678', 'msg_123');
        });
    });

    describe('handleText - Guardar Mensajes', () => {
        test('debe guardar mensaje del usuario en BD', async () => {
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'SALUDO',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });

            await messageHandler.handleText('+5215512345678', 'hola', 'msg_123', mockContext);

            expect(db.saveMessage).toHaveBeenCalledWith(
                '+5215512345678',
                'U',
                'hola',
                'TEXTO'
            );
        });
    });

    describe('handleButton', () => {
        test('debe manejar botón de refrigerador', async () => {
            await messageHandler.handleButton('+5215512345678', 'btn_tipo_refrigerador', 'msg_123', mockContext);

            expect(db.saveMessage).toHaveBeenCalledWith(
                '+5215512345678',
                'U',
                'btn_tipo_refrigerador',
                'BOTON'
            );
        });

        test('debe manejar botón de vehículo', async () => {
            await messageHandler.handleButton('+5215512345678', 'btn_tipo_vehiculo', 'msg_123', mockContext);

            expect(db.saveMessage).toHaveBeenCalledWith(
                '+5215512345678',
                'U',
                'btn_tipo_vehiculo',
                'BOTON'
            );
        });

        test('debe enviar typing indicator si hay messageId', async () => {
            await messageHandler.handleButton('+5215512345678', 'btn_tipo_refrigerador', 'msg_123', mockContext);

            expect(whatsapp.sendTypingIndicator).toHaveBeenCalledWith('+5215512345678', 'msg_123');
        });

        test('no debe enviar typing indicator si no hay messageId', async () => {
            await messageHandler.handleButton('+5215512345678', 'btn_tipo_refrigerador', null, mockContext);

            expect(whatsapp.sendTypingIndicator).not.toHaveBeenCalled();
        });

        test('debe manejar botón de cancelar', async () => {
            // Configurar sesión en flujo activo
            db.__setSession('+5215512345678', { Estado: 'REFRI_ESPERA_SAP' });

            await messageHandler.handleButton('+5215512345678', 'btn_cancelar', 'msg_123', mockContext);

            // Debería haber procesado la cancelación
            expect(db.updateSession).toHaveBeenCalled();
        });

        test('debe reactivar sesión si está en estado terminal', async () => {
            db.__setSession('+5215512345678', { Estado: 'CANCELADO' });

            await messageHandler.handleButton('+5215512345678', 'btn_tipo_refrigerador', 'msg_123', mockContext);

            expect(db.updateSession).toHaveBeenCalledWith(
                '+5215512345678',
                'INICIO',
                null,
                null,
                expect.any(String),
                expect.stringContaining('reactivada')
            );
        });
    });

    describe('handleText - Sesión Terminal', () => {
        test('debe reactivar sesión si está en CANCELADO', async () => {
            db.__setSession('+5215512345678', { Estado: 'CANCELADO' });

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'SALUDO',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });

            await messageHandler.handleText('+5215512345678', 'hola', 'msg_123', mockContext);

            expect(db.updateSession).toHaveBeenCalledWith(
                '+5215512345678',
                'INICIO',
                null,
                null,
                expect.any(String),
                expect.stringContaining('reactivada')
            );
        });

        test('debe reactivar sesión si está en TIMEOUT', async () => {
            db.__setSession('+5215512345678', { Estado: 'TIMEOUT' });

            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'SALUDO',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });

            await messageHandler.handleText('+5215512345678', 'hola', 'msg_123', mockContext);

            expect(db.updateSession).toHaveBeenCalledWith(
                '+5215512345678',
                'INICIO',
                null,
                null,
                expect.any(String),
                expect.stringContaining('reactivada')
            );
        });
    });

    describe('handleText - Actualizar Actividad', () => {
        test('debe actualizar última actividad', async () => {
            intentService.detectIntent.mockResolvedValueOnce({
                intencion: 'SALUDO',
                confianza: 0.95,
                metodo: 'regex',
                datos_extraidos: {}
            });

            await messageHandler.handleText('+5215512345678', 'hola', 'msg_123', mockContext);

            expect(db.updateLastActivity).toHaveBeenCalledWith('+5215512345678');
        });
    });
});
