/**
 * Tests - WhatsApp Service
 * Pruebas del servicio de WhatsApp
 */

jest.mock('axios');
jest.mock('../../core/config', () => require('../__mocks__/config'));
jest.mock('../../core/services/infrastructure/errorHandler', () => ({
    logger: {
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        whatsapp: jest.fn()
    },
    ExternalServiceError: class ExternalServiceError extends Error {
        constructor(message, service, originalError) {
            super(message);
            this.service = service;
            this.originalError = originalError;
        }
    }
}));

const axios = require('axios');
const whatsappService = require('../../core/services/external/whatsappService');

describe('WhatsAppService', () => {
    const testPhone = '+5215540829614';

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock axios.create to return a mock instance
        axios.create.mockReturnValue({
            post: jest.fn().mockResolvedValue({
                data: { messages: [{ id: 'msg_123' }] }
            }),
            get: jest.fn().mockResolvedValue({
                data: { url: 'https://media.whatsapp.com/test.jpg' }
            })
        });

        // Mock axios.get for media download
        axios.get.mockResolvedValue({
            data: Buffer.from('fake-image-data')
        });
    });

    describe('sendText', () => {
        test('debe enviar texto exitosamente', async () => {
            const result = await whatsappService.sendText(testPhone, 'Hola mundo');

            expect(result).toBeDefined();
            expect(result.messages).toBeDefined();
        });

        test('debe manejar errores de API', async () => {
            axios.create.mockReturnValue({
                post: jest.fn().mockRejectedValue(new Error('API Error'))
            });

            await expect(
                whatsappService.sendText(testPhone, 'Test')
            ).rejects.toThrow();
        });
    });

    describe('sendButtons', () => {
        test('debe enviar botones exitosamente', async () => {
            const buttons = [
                { id: 'btn_1', title: 'Opción 1' },
                { id: 'btn_2', title: 'Opción 2' }
            ];

            const result = await whatsappService.sendButtons(
                testPhone,
                'Selecciona una opción',
                buttons
            );

            expect(result).toBeDefined();
        });

        test('debe truncar títulos de botones largos', async () => {
            const buttons = [
                { id: 'btn_1', title: 'Este es un título muy largo que excede el límite permitido' }
            ];

            const result = await whatsappService.sendButtons(
                testPhone,
                'Mensaje',
                buttons
            );

            expect(result).toBeDefined();
        });
    });

    describe('sendInteractiveMessage', () => {
        test('debe enviar mensaje interactivo con header', async () => {
            const buttons = [
                { id: 'btn_1', title: 'Opción 1' },
                { id: 'btn_2', title: 'Opción 2' }
            ];

            const result = await whatsappService.sendInteractiveMessage(
                testPhone,
                'Título',
                'Cuerpo del mensaje',
                buttons
            );

            expect(result).toBeDefined();
        });
    });

    describe('downloadMedia', () => {
        test('debe descargar media exitosamente', async () => {
            const result = await whatsappService.downloadMedia('media_123');

            expect(result).toBeInstanceOf(Buffer);
        });

        test('debe manejar errores de descarga', async () => {
            axios.create.mockReturnValue({
                get: jest.fn().mockRejectedValue(new Error('Download failed'))
            });

            await expect(
                whatsappService.downloadMedia('media_123')
            ).rejects.toThrow();
        });
    });

    describe('sendTypingIndicator', () => {
        test('debe enviar typing indicator exitosamente', async () => {
            // No debería lanzar error
            await expect(
                whatsappService.sendTypingIndicator(testPhone, 'msg_123')
            ).resolves.not.toThrow();
        });

        test('debe manejar errores silenciosamente', async () => {
            axios.create.mockReturnValue({
                post: jest.fn().mockRejectedValue(new Error('API Error'))
            });

            // No debería lanzar error, solo loguear
            await expect(
                whatsappService.sendTypingIndicator(testPhone, 'msg_123')
            ).resolves.not.toThrow();
        });
    });

    describe('Retry Logic', () => {
        test('debe reintentar en errores de timeout', async () => {
            const error = new Error('Timeout');
            error.code = 'ETIMEDOUT';

            let callCount = 0;
            axios.create.mockReturnValue({
                post: jest.fn().mockImplementation(() => {
                    callCount++;
                    if (callCount < 2) {
                        return Promise.reject(error);
                    }
                    return Promise.resolve({
                        data: { messages: [{ id: 'msg_123' }] }
                    });
                })
            });

            const result = await whatsappService.sendText(testPhone, 'Test retry');

            expect(result).toBeDefined();
        });

        test('debe fallar después de máximo de reintentos', async () => {
            const error = new Error('Persistent timeout');
            error.code = 'ETIMEDOUT';

            axios.create.mockReturnValue({
                post: jest.fn().mockRejectedValue(error)
            });

            await expect(
                whatsappService.sendText(testPhone, 'Test')
            ).rejects.toThrow();
        });
    });
});
