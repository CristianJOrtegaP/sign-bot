/**
 * Unit Test: Circuit Breaker integration with Vision and Blob services
 * Verifica gate checks, recordSuccess y recordFailure
 */

jest.mock('../../core/services/infrastructure/appInsightsService', () =>
  require('../__mocks__/appInsightsService.mock')
);
jest.mock('../../core/services/infrastructure/metricsService', () =>
  require('../__mocks__/metricsService.mock')
);
jest.mock('../../core/services/infrastructure/errorHandler', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    vision: jest.fn(),
  },
}));

const {
  getBreaker,
  SERVICES,
  resetAll,
} = require('../../core/services/infrastructure/circuitBreaker');

describe('Circuit Breaker - BLOB_STORAGE service', () => {
  beforeEach(() => {
    resetAll();
  });

  test('should have BLOB_STORAGE defined in SERVICES', () => {
    expect(SERVICES.BLOB_STORAGE).toBe('blob-storage');
  });

  test('should allow execution when circuit is closed', () => {
    const breaker = getBreaker(SERVICES.BLOB_STORAGE);
    const result = breaker.canExecute();
    expect(result.allowed).toBe(true);
  });

  test('should open circuit after threshold failures', () => {
    const breaker = getBreaker(SERVICES.BLOB_STORAGE);

    // Blob has failureThreshold: 5
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure(new Error(`fail-${i}`));
    }

    const result = breaker.canExecute();
    expect(result.allowed).toBe(false);
  });

  test('should close circuit after reset', () => {
    const breaker = getBreaker(SERVICES.BLOB_STORAGE);

    // Open the circuit
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure(new Error(`fail-${i}`));
    }
    expect(breaker.canExecute().allowed).toBe(false);

    breaker.reset();
    expect(breaker.canExecute().allowed).toBe(true);
  });
});

describe('Circuit Breaker - AZURE_VISION service', () => {
  beforeEach(() => {
    resetAll();
  });

  test('should have AZURE_VISION defined in SERVICES', () => {
    expect(SERVICES.AZURE_VISION).toBe('azure-vision');
  });

  test('should allow execution when circuit is closed', () => {
    const breaker = getBreaker(SERVICES.AZURE_VISION);
    const result = breaker.canExecute();
    expect(result.allowed).toBe(true);
  });

  test('should open circuit after threshold failures', () => {
    const breaker = getBreaker(SERVICES.AZURE_VISION);

    // Vision has failureThreshold: 5
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure(new Error(`fail-${i}`));
    }

    const result = breaker.canExecute();
    expect(result.allowed).toBe(false);
  });
});

describe('Circuit Breaker - Vision Service gate check', () => {
  beforeEach(() => {
    resetAll();
  });

  test('should reject OCR when vision circuit breaker is open', async () => {
    // Open the vision circuit breaker
    const breaker = getBreaker(SERVICES.AZURE_VISION);
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure(new Error(`fail-${i}`));
    }

    // Mock Azure Vision client to prevent real API calls
    jest.mock('@azure/cognitiveservices-computervision', () => ({
      ComputerVisionClient: jest.fn(() => ({
        readInStream: jest.fn(),
        getReadResult: jest.fn(),
      })),
    }));
    jest.mock('@azure/ms-rest-js', () => ({
      ApiKeyCredentials: jest.fn(),
    }));

    const {
      extractTextFromImage,
      OCR_ERROR_TYPES,
    } = require('../../core/services/ai/visionService');

    const imageBuffer = Buffer.alloc(5 * 1024); // 5KB valid size
    try {
      await extractTextFromImage(imageBuffer);
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      expect(error.name).toBe('OCRError');
      expect(error.type).toBe(OCR_ERROR_TYPES.SERVICE_ERROR);
    }
  });
});

describe('Circuit Breaker - Blob Service gate check', () => {
  beforeEach(() => {
    resetAll();
  });

  test('should reject upload when blob circuit breaker is open', async () => {
    // Open the blob circuit breaker
    const breaker = getBreaker(SERVICES.BLOB_STORAGE);
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure(new Error(`fail-${i}`));
    }

    // Mock Azure storage to prevent real API calls
    jest.mock('@azure/storage-blob', () => ({
      BlobServiceClient: { fromConnectionString: jest.fn() },
      generateBlobSASQueryParameters: jest.fn(),
      BlobSASPermissions: { parse: jest.fn() },
      StorageSharedKeyCredential: jest.fn(),
    }));

    const blobService = require('../../core/services/storage/blobService');

    const imageBuffer = Buffer.alloc(1024); // 1KB
    await expect(blobService.uploadImage(imageBuffer, '5551234567', 'jpg')).rejects.toThrow(
      'circuit breaker abierto'
    );
  });
});

describe('Circuit Breaker - all services pre-configured', () => {
  beforeEach(() => {
    resetAll();
  });

  test('should have all 6 services in SERVICES enum', () => {
    expect(Object.keys(SERVICES)).toEqual(
      expect.arrayContaining([
        'WHATSAPP',
        'GEMINI',
        'AZURE_OPENAI',
        'AZURE_VISION',
        'DATABASE',
        'BLOB_STORAGE',
      ])
    );
  });

  test('all pre-configured breakers should start in closed state', () => {
    for (const service of Object.values(SERVICES)) {
      const breaker = getBreaker(service);
      expect(breaker.canExecute().allowed).toBe(true);
    }
  });
});
