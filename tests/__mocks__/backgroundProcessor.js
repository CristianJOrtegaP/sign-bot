/**
 * Mock - Background Processor
 * Simula el procesamiento en segundo plano de imágenes
 */

const mockBackgroundProcessor = {
  __reset: () => {
    mockBackgroundProcessor.processImageInBackground.mockClear();
    mockBackgroundProcessor.processImageWithAIVision.mockClear();
  },

  // OCR para códigos de barras (refrigeradores)
  processImageInBackground: jest.fn().mockResolvedValue({
    success: true,
    sapCode: '1234567',
  }),

  // AI Vision para análisis general (vehículos)
  processImageWithAIVision: jest.fn().mockResolvedValue({
    success: true,
    descripcion: 'Imagen analizada correctamente',
  }),
};

module.exports = mockBackgroundProcessor;
