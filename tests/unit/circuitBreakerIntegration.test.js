/**
 * Unit Test: Circuit Breaker integration with DocuSign and Blob services
 * Verifica gate checks, recordSuccess y recordFailure - Sign Bot
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
  },
}));

const {
  getBreaker,
  SERVICES,
  resetAll,
} = require('../../core/services/infrastructure/circuitBreaker');

describe('Circuit Breaker - DOCUSIGN service', () => {
  beforeEach(() => {
    resetAll();
  });

  test('should have DOCUSIGN defined in SERVICES', () => {
    expect(SERVICES.DOCUSIGN).toBe('docusign');
  });

  test('should allow execution when circuit is closed', () => {
    const breaker = getBreaker(SERVICES.DOCUSIGN);
    const result = breaker.canExecute();
    expect(result.allowed).toBe(true);
  });

  test('should open circuit after threshold failures', () => {
    const breaker = getBreaker(SERVICES.DOCUSIGN);

    // DocuSign has failureThreshold: 5
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure(new Error(`fail-${i}`));
    }

    const result = breaker.canExecute();
    expect(result.allowed).toBe(false);
  });

  test('should close circuit after reset', () => {
    const breaker = getBreaker(SERVICES.DOCUSIGN);

    // Open the circuit
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure(new Error(`fail-${i}`));
    }
    expect(breaker.canExecute().allowed).toBe(false);

    breaker.reset();
    expect(breaker.canExecute().allowed).toBe(true);
  });

  test('should record success and keep circuit closed', () => {
    const breaker = getBreaker(SERVICES.DOCUSIGN);

    breaker.recordSuccess();
    const result = breaker.canExecute();
    expect(result.allowed).toBe(true);
  });
});

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

    const buffer = Buffer.alloc(1024); // 1KB
    await expect(blobService.uploadImage(buffer, '5551234567', 'jpg')).rejects.toThrow(
      'circuit breaker abierto'
    );
  });
});

describe('Circuit Breaker - all services pre-configured', () => {
  beforeEach(() => {
    resetAll();
  });

  test('should have all 4 services in SERVICES enum', () => {
    expect(Object.keys(SERVICES)).toEqual(
      expect.arrayContaining(['WHATSAPP', 'DOCUSIGN', 'DATABASE', 'BLOB_STORAGE'])
    );
  });

  test('all pre-configured breakers should start in closed state', () => {
    for (const service of Object.values(SERVICES)) {
      const breaker = getBreaker(service);
      expect(breaker.canExecute().allowed).toBe(true);
    }
  });
});
