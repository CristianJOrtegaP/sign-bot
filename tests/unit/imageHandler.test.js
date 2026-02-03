/**
 * Tests - Image Handler
 * Pruebas del controlador de imágenes
 */

// Mocks
jest.mock('../../core/services/external/whatsappService', () => require('../__mocks__/whatsappService'));
jest.mock('../../core/services/storage/databaseService', () => require('../__mocks__/databaseService'));
jest.mock('../../core/config', () => require('../__mocks__/config'));

jest.mock('../../core/services/infrastructure/rateLimiter', () => ({
    checkRateLimit: jest.fn().mockReturnValue({ allowed: true }),
    recordRequest: jest.fn()
}));

jest.mock('../../core/services/processing/backgroundProcessor', () => ({
    processImageInBackground: jest.fn().mockResolvedValue({ success: true })
}));

const imageHandler = require('../../bot/controllers/imageHandler');
const whatsapp = require('../../core/services/external/whatsappService');
const db = require('../../core/services/storage/databaseService');
const rateLimiter = require('../../core/services/infrastructure/rateLimiter');
const backgroundProcessor = require('../../core/services/processing/backgroundProcessor');

describe('ImageHandler', () => {
    let mockContext;
    const testPhone = '+5215540829614';

    beforeEach(() => {
        jest.clearAllMocks();
        whatsapp.__reset();
        db.__reset();

        mockContext = {
            log: jest.fn(),
            log_error: jest.fn(),
            log_warn: jest.fn()
        };
        mockContext.log.error = jest.fn();
    });

    describe('handleImage', () => {
        test('debe procesar imagen cuando está en estado REFRI_ESPERA_SAP', async () => {
            db.__setSession(testPhone, { Estado: 'REFRI_ESPERA_SAP' });

            await imageHandler.handleImage(
                testPhone,
                { id: 'img_123' },
                'msg_123',
                mockContext
            );

            expect(rateLimiter.recordRequest).toHaveBeenCalledWith(testPhone, 'image');
            expect(whatsapp.sendTypingIndicator).toHaveBeenCalledWith(testPhone, 'msg_123');
            expect(whatsapp.sendText).toHaveBeenCalledWith(
                testPhone,
                expect.stringContaining('Analizando')
            );
            expect(backgroundProcessor.processImageInBackground).toHaveBeenCalledWith(
                testPhone,
                'img_123',
                mockContext
            );
        });

        test('debe rechazar imagen si excede rate limit', async () => {
            rateLimiter.checkRateLimit.mockReturnValueOnce({
                allowed: false,
                reason: 'Límite de imágenes excedido'
            });

            await imageHandler.handleImage(
                testPhone,
                { id: 'img_123' },
                'msg_123',
                mockContext
            );

            expect(whatsapp.sendText).toHaveBeenCalledWith(
                testPhone,
                expect.stringContaining('Límite')
            );
            expect(backgroundProcessor.processImageInBackground).not.toHaveBeenCalled();
        });

        test('debe rechazar imagen si no está en estado REFRI_ESPERA_SAP', async () => {
            db.__setSession(testPhone, { Estado: 'INICIO' });

            await imageHandler.handleImage(
                testPhone,
                { id: 'img_123' },
                'msg_123',
                mockContext
            );

            expect(whatsapp.sendText).toHaveBeenCalledWith(
                testPhone,
                expect.stringContaining('no estoy esperando')
            );
            expect(backgroundProcessor.processImageInBackground).not.toHaveBeenCalled();
        });

        test('debe rechazar imagen si está en estado de vehículo', async () => {
            db.__setSession(testPhone, { Estado: 'VEHICULO_ESPERA_SAP' });

            await imageHandler.handleImage(
                testPhone,
                { id: 'img_123' },
                'msg_123',
                mockContext
            );

            expect(whatsapp.sendText).toHaveBeenCalledWith(
                testPhone,
                expect.stringContaining('no estoy esperando')
            );
        });

        test('debe manejar errores del procesamiento en background sin bloquear', async () => {
            db.__setSession(testPhone, { Estado: 'REFRI_ESPERA_SAP' });
            backgroundProcessor.processImageInBackground.mockRejectedValueOnce(
                new Error('Background error')
            );

            // No debería lanzar error
            await expect(
                imageHandler.handleImage(
                    testPhone,
                    { id: 'img_123' },
                    'msg_123',
                    mockContext
                )
            ).resolves.not.toThrow();

            expect(whatsapp.sendText).toHaveBeenCalledWith(
                testPhone,
                expect.stringContaining('Analizando')
            );
        });
    });
});
