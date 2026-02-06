/**
 * Unit Test: Clases de Error personalizadas
 * Verifica herencia, propiedades y serialización
 */

const {
  AppError,
  DatabaseError,
  ValidationError,
  ExternalServiceError,
  SessionError,
  EquipoNotFoundError,
  RateLimitError,
  ConfigurationError,
  ConcurrencyError,
} = require('../../core/errors');

describe('Error Classes', () => {
  // ===========================================================
  // APP ERROR (BASE)
  // ===========================================================
  describe('AppError', () => {
    test('debe crear error con propiedades base', () => {
      const error = new AppError('test error', 'TEST_CODE', 500);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.statusCode).toBe(500);
      expect(error.isOperational).toBe(true);
      expect(error.timestamp).toBeDefined();
      expect(error.name).toBe('AppError');
    });

    test('debe serializar a JSON correctamente', () => {
      const error = new AppError('serialize me', 'SERIAL', 400);
      const json = error.toJSON();
      expect(json).toEqual({
        name: 'AppError',
        message: 'serialize me',
        code: 'SERIAL',
        statusCode: 400,
        timestamp: expect.any(String),
      });
    });

    test('debe tener stack trace', () => {
      const error = new AppError('with stack');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('AppError');
    });
  });

  // ===========================================================
  // DATABASE ERROR
  // ===========================================================
  describe('DatabaseError', () => {
    test('debe crear error con operación y error original', () => {
      const original = new Error('connection timeout');
      const error = new DatabaseError('DB failed', original, 'getSession');
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe('DATABASE_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.operation).toBe('getSession');
      expect(error.originalError).toBe('connection timeout');
    });

    test('debe manejar error original null', () => {
      const error = new DatabaseError('DB failed');
      expect(error.originalError).toBeNull();
      expect(error.operation).toBe('unknown');
    });
  });

  // ===========================================================
  // VALIDATION ERROR
  // ===========================================================
  describe('ValidationError', () => {
    test('debe crear error con campo', () => {
      const error = new ValidationError('Campo inválido', 'email');
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.field).toBe('email');
    });
  });

  // ===========================================================
  // EXTERNAL SERVICE ERROR
  // ===========================================================
  describe('ExternalServiceError', () => {
    test('debe crear error con servicio y error original', () => {
      const original = { message: 'API timeout', response: { data: { detail: 'slow' } } };
      const error = new ExternalServiceError('WhatsApp failed', 'whatsapp', original);
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe('EXTERNAL_SERVICE_ERROR');
      expect(error.statusCode).toBe(502);
      expect(error.service).toBe('whatsapp');
      expect(error.originalError).toBe('API timeout');
      expect(error.responseData).toEqual({ detail: 'slow' });
    });
  });

  // ===========================================================
  // SESSION ERROR
  // ===========================================================
  describe('SessionError', () => {
    test('debe crear error con teléfono', () => {
      const error = new SessionError('Sesión no encontrada', '+52155');
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe('SESSION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.telefono).toBe('+52155');
    });
  });

  // ===========================================================
  // EQUIPO NOT FOUND ERROR
  // ===========================================================
  describe('EquipoNotFoundError', () => {
    test('debe crear error con código SAP', () => {
      const error = new EquipoNotFoundError('1234567');
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe('EQUIPO_NOT_FOUND');
      expect(error.statusCode).toBe(404);
      expect(error.codigoSAP).toBe('1234567');
      expect(error.message).toContain('1234567');
    });
  });

  // ===========================================================
  // RATE LIMIT ERROR
  // ===========================================================
  describe('RateLimitError', () => {
    test('debe crear error con teléfono y razón', () => {
      const error = new RateLimitError('+52155', 'Demasiados mensajes');
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe('RATE_LIMIT_ERROR');
      expect(error.statusCode).toBe(429);
      expect(error.telefono).toBe('+52155');
    });
  });

  // ===========================================================
  // CONFIGURATION ERROR
  // ===========================================================
  describe('ConfigurationError', () => {
    test('debe crear error no operacional', () => {
      const error = new ConfigurationError('Missing API key', 'WHATSAPP_API_KEY');
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe('CONFIGURATION_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.isOperational).toBe(false);
      expect(error.configKey).toBe('WHATSAPP_API_KEY');
    });
  });

  // ===========================================================
  // CONCURRENCY ERROR
  // ===========================================================
  describe('ConcurrencyError', () => {
    test('debe crear error con teléfono, versión y operación', () => {
      const error = new ConcurrencyError('+52155', 5, 'updateSession');
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toContain('Concurrency conflict');
      expect(error.telefono).toBe('+52155');
      expect(error.expectedVersion).toBe(5);
      expect(error.operation).toBe('updateSession');
    });
  });
});
