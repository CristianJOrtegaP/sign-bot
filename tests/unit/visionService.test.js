/**
 * Tests para VisionService
 * Valida OCR, extraccion de texto y manejo de errores
 */

// Mock de Azure Computer Vision antes de importar el servicio
jest.mock('@azure/cognitiveservices-computervision', () => ({
    ComputerVisionClient: jest.fn().mockImplementation(() => ({
        readInStream: jest.fn(),
        getReadResult: jest.fn()
    }))
}));

jest.mock('@azure/ms-rest-js', () => ({
    ApiKeyCredentials: jest.fn()
}));

describe('VisionService', () => {
    let visionService;
    let mockClient;

    const originalEnv = process.env;

    beforeAll(() => {
        process.env = {
            ...originalEnv,
            VISION_ENDPOINT: 'https://test-vision.cognitiveservices.azure.com',
            VISION_KEY: 'test-vision-key-123'
        };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();

        // Re-import after reset
        const { ComputerVisionClient } = require('@azure/cognitiveservices-computervision');

        mockClient = {
            readInStream: jest.fn(),
            getReadResult: jest.fn()
        };
        ComputerVisionClient.mockImplementation(() => mockClient);

        visionService = require('../../core/services/ai/visionService');
    });

    describe('OCR_ERROR_TYPES', () => {
        it('debe tener todos los tipos de error definidos', () => {
            expect(visionService.OCR_ERROR_TYPES).toBeDefined();
            expect(visionService.OCR_ERROR_TYPES.TIMEOUT).toBe('TIMEOUT');
            expect(visionService.OCR_ERROR_TYPES.INVALID_IMAGE).toBe('INVALID_IMAGE');
            expect(visionService.OCR_ERROR_TYPES.IMAGE_TOO_SMALL).toBe('IMAGE_TOO_SMALL');
            expect(visionService.OCR_ERROR_TYPES.IMAGE_TOO_LARGE).toBe('IMAGE_TOO_LARGE');
            expect(visionService.OCR_ERROR_TYPES.NO_TEXT_FOUND).toBe('NO_TEXT_FOUND');
            expect(visionService.OCR_ERROR_TYPES.SERVICE_ERROR).toBe('SERVICE_ERROR');
        });
    });

    describe('OCRError', () => {
        it('debe crear error con tipo y mensaje', () => {
            const error = new visionService.OCRError(visionService.OCR_ERROR_TYPES.TIMEOUT);
            expect(error.name).toBe('OCRError');
            expect(error.type).toBe('TIMEOUT');
            expect(error.message).toContain('tiempo');
            expect(error.suggestions).toBeDefined();
            expect(Array.isArray(error.suggestions)).toBe(true);
        });

        it('debe generar mensaje para usuario', () => {
            const error = new visionService.OCRError(visionService.OCR_ERROR_TYPES.NO_TEXT_FOUND);
            const userMessage = error.getUserMessage();

            expect(userMessage).toContain('No encontré texto');
            expect(userMessage).toContain('Sugerencias');
            expect(userMessage).toContain('código SAP manualmente');
        });

        it('debe preservar error original', () => {
            const originalError = new Error('API error');
            const error = new visionService.OCRError(
                visionService.OCR_ERROR_TYPES.SERVICE_ERROR,
                originalError
            );

            expect(error.originalError).toBe(originalError);
        });
    });

    describe('extractTextFromImage', () => {
        it('debe rechazar imagen muy pequena', async () => {
            const smallBuffer = Buffer.alloc(500); // 500 bytes < 1KB

            await expect(visionService.extractTextFromImage(smallBuffer))
                .rejects.toThrow(visionService.OCRError);

            try {
                await visionService.extractTextFromImage(smallBuffer);
            } catch (error) {
                expect(error.type).toBe(visionService.OCR_ERROR_TYPES.IMAGE_TOO_SMALL);
            }
        });

        it('debe rechazar imagen muy grande', async () => {
            const largeBuffer = Buffer.alloc(25 * 1024 * 1024); // 25MB > 20MB

            await expect(visionService.extractTextFromImage(largeBuffer))
                .rejects.toThrow(visionService.OCRError);

            try {
                await visionService.extractTextFromImage(largeBuffer);
            } catch (error) {
                expect(error.type).toBe(visionService.OCR_ERROR_TYPES.IMAGE_TOO_LARGE);
            }
        });

        it('debe procesar imagen y extraer texto exitosamente', async () => {
            const imageBuffer = Buffer.alloc(50 * 1024); // 50KB

            mockClient.readInStream.mockResolvedValue({
                operationLocation: 'https://test.com/operations/12345'
            });

            mockClient.getReadResult.mockResolvedValue({
                status: 'succeeded',
                analyzeResult: {
                    readResults: [{
                        width: 800,
                        height: 600,
                        lines: [
                            { text: 'Codigo SAP' },
                            { text: '4045101' }
                        ]
                    }]
                }
            });

            const result = await visionService.extractTextFromImage(imageBuffer);

            expect(result.lines).toContain('Codigo SAP');
            expect(result.lines).toContain('4045101');
            expect(result.metadata.totalPages).toBe(1);
            expect(result.metadata.totalLines).toBe(2);
        });

        it('debe lanzar error si no se encuentra texto', async () => {
            const imageBuffer = Buffer.alloc(50 * 1024);

            mockClient.readInStream.mockResolvedValue({
                operationLocation: 'https://test.com/operations/12345'
            });

            mockClient.getReadResult.mockResolvedValue({
                status: 'succeeded',
                analyzeResult: {
                    readResults: [{
                        width: 800,
                        height: 600,
                        lines: []
                    }]
                }
            });

            await expect(visionService.extractTextFromImage(imageBuffer))
                .rejects.toThrow(visionService.OCRError);
        });

        it('debe manejar timeout de OCR', async () => {
            const imageBuffer = Buffer.alloc(50 * 1024);

            mockClient.readInStream.mockResolvedValue({
                operationLocation: 'https://test.com/operations/12345'
            });

            // Simular que siempre esta "running"
            mockClient.getReadResult.mockResolvedValue({
                status: 'running'
            });

            await expect(visionService.extractTextFromImage(imageBuffer))
                .rejects.toThrow(visionService.OCRError);
        }, 30000); // Timeout largo para este test

        it('debe manejar error de red', async () => {
            const imageBuffer = Buffer.alloc(50 * 1024);

            const networkError = new Error('Network error');
            networkError.code = 'ECONNRESET';
            mockClient.readInStream.mockRejectedValue(networkError);

            await expect(visionService.extractTextFromImage(imageBuffer))
                .rejects.toThrow(visionService.OCRError);

            try {
                await visionService.extractTextFromImage(imageBuffer);
            } catch (error) {
                expect(error.type).toBe(visionService.OCR_ERROR_TYPES.NETWORK_ERROR);
            }
        });
    });

    describe('findSAPCode', () => {
        it('debe encontrar codigo SAP de 7 digitos', () => {
            const lines = ['Codigo SAP', '4045101', 'Modelo XYZ'];
            const code = visionService.findSAPCode(lines);
            expect(code).toBe('4045101');
        });

        it('debe encontrar codigo en linea con texto', () => {
            const lines = ['SAP: 4045101 - Refrigerador'];
            const code = visionService.findSAPCode(lines);
            expect(code).toBe('4045101');
        });

        it('debe aceptar objeto con propiedad lines', () => {
            const result = { lines: ['4045101'] };
            const code = visionService.findSAPCode(result);
            expect(code).toBe('4045101');
        });

        it('debe retornar null si no hay codigo', () => {
            const lines = ['Sin codigo', 'Texto aleatorio'];
            const code = visionService.findSAPCode(lines);
            expect(code).toBeNull();
        });

        it('debe ignorar numeros que no son 7 digitos', () => {
            const lines = ['123456', '12345678', '123'];
            const code = visionService.findSAPCode(lines);
            expect(code).toBeNull();
        });

        it('debe encontrar codigo con espacios o guiones', () => {
            const lines = ['404-5101'];
            const code = visionService.findSAPCode(lines);
            expect(code).toBe('4045101');
        });
    });
});
