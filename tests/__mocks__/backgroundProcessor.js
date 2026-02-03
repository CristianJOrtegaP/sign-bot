/**
 * Mock - Background Processor
 * Simula el procesamiento en segundo plano de imágenes
 */

const mockBackgroundProcessor = {
    __reset: () => {
        mockBackgroundProcessor.processImageInBackground.mockClear();
    },

    processImageInBackground: jest.fn().mockResolvedValue({
        success: true,
        sapCode: '1234567'
    })
};

module.exports = mockBackgroundProcessor;
