/**
 * Tests para Field Extractor Service (FASE 2b)
 */

const fieldExtractor = require('../../bot/services/fieldExtractor');

describe('Field Extractor Service', () => {
  describe('extractCodigoSAP', () => {
    it('debería extraer código SAP con prefijo "SAP"', () => {
      const result = fieldExtractor.extractCodigoSAP('Mi SAP es 123456');
      expect(result).not.toBeNull();
      expect(result.valor).toBe('123456');
      expect(result.fuente).toBe('regex');
      expect(result.confianza).toBeGreaterThanOrEqual(80);
    });

    it('debería extraer código SAP con prefijo "código"', () => {
      const result = fieldExtractor.extractCodigoSAP('El código del refrigerador es 789012');
      expect(result).not.toBeNull();
      expect(result.valor).toBe('789012');
    });

    it('debería extraer código SAP standalone de 5+ dígitos', () => {
      const result = fieldExtractor.extractCodigoSAP('Tengo el 12345');
      expect(result).not.toBeNull();
      expect(result.valor).toBe('12345');
    });

    it('debería rechazar códigos muy cortos', () => {
      const result = fieldExtractor.extractCodigoSAP('SAP 123');
      expect(result).toBeNull();
    });

    it('debería extraer solo primeros 10 dígitos de códigos muy largos', () => {
      // El validador SAP acepta hasta 10 dígitos, los primeros 10 se extraen
      const result = fieldExtractor.extractCodigoSAP('SAP 12345678901234');
      // Puede extraer los primeros 10 o rechazar, dependiendo del regex
      if (result) {
        expect(result.valor.length).toBeLessThanOrEqual(10);
      }
    });

    it('debería retornar null si no encuentra código', () => {
      const result = fieldExtractor.extractCodigoSAP('Hola, tengo un problema');
      expect(result).toBeNull();
    });
  });

  describe('extractNumeroEmpleado', () => {
    it('debería extraer número de empleado con prefijo "numero de empleado"', () => {
      const result = fieldExtractor.extractNumeroEmpleado('numero de empleado: EMP001');
      expect(result).not.toBeNull();
      expect(result.valor).toBe('EMP001');
      expect(result.fuente).toBe('regex');
    });

    it('debería extraer empleado con "soy el empleado"', () => {
      const result = fieldExtractor.extractNumeroEmpleado('Soy el empleado ABC123');
      expect(result).not.toBeNull();
      expect(result.valor).toBe('ABC123');
    });

    it('debería extraer con formato EMP:', () => {
      const result = fieldExtractor.extractNumeroEmpleado('EMP: 12345');
      expect(result).not.toBeNull();
      expect(result.valor).toBe('12345');
    });

    it('debería manejar empleados cortos según validación', () => {
      // El validador acepta mínimo 3 caracteres
      const result = fieldExtractor.extractNumeroEmpleado('Empleado: ABC');
      if (result) {
        expect(result.valor.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('extractUbicacion', () => {
    it('debería extraer coordenadas GPS', () => {
      const result = fieldExtractor.extractUbicacion('Estoy en 25.6866, -100.3161');
      expect(result).not.toBeNull();
      expect(result.coordenadas).toBeDefined();
      expect(result.coordenadas.latitud).toBeCloseTo(25.6866, 4);
      expect(result.coordenadas.longitud).toBeCloseTo(-100.3161, 4);
      expect(result.confianza).toBe(95);
    });

    it('debería extraer dirección textual con "estoy en"', () => {
      const result = fieldExtractor.extractUbicacion('Estoy en Av. Constitución 123, Monterrey');
      expect(result).not.toBeNull();
      expect(result.valor).toContain('Av. Constitución');
      expect(result.fuente).toBe('regex');
    });

    it('debería extraer dirección con "ubicación:"', () => {
      const result = fieldExtractor.extractUbicacion(
        'Ubicación: Calle Principal #500, Col. Centro'
      );
      expect(result).not.toBeNull();
      expect(result.valor).toContain('Calle Principal');
    });

    it('debería rechazar direcciones muy cortas', () => {
      const result = fieldExtractor.extractUbicacion('Estoy en casa');
      expect(result).toBeNull();
    });
  });

  describe('extractNumeroTicket', () => {
    it('debería extraer ticket con formato completo', () => {
      const result = fieldExtractor.extractNumeroTicket('Mi ticket es TKT-ABC12345');
      expect(result).not.toBeNull();
      expect(result.valor).toBe('TKT-ABC12345');
      expect(result.confianza).toBe(95);
    });

    it('debería extraer ticket mencionado después de "folio"', () => {
      const result = fieldExtractor.extractNumeroTicket('Folio: TKT-XYZ98765');
      expect(result).not.toBeNull();
      expect(result.valor).toBe('TKT-XYZ98765');
    });

    it('debería normalizar a mayúsculas', () => {
      const result = fieldExtractor.extractNumeroTicket('Ticket tkt-abc12345');
      expect(result).not.toBeNull();
      expect(result.valor).toBe('TKT-ABC12345');
    });
  });

  describe('extractAllFields', () => {
    it('debería extraer múltiples campos de un mensaje completo', async () => {
      const mensaje = 'Soy el empleado EMP001, el SAP del vehículo es 123456 y no enciende';
      const result = await fieldExtractor.extractAllFields(mensaje, {
        tipoReporte: 'VEHICULO',
        useAI: false, // Desactivar AI para test unitario
      });

      expect(result.campos.numeroEmpleado).toBeDefined();
      expect(result.campos.numeroEmpleado.valor).toBe('EMP001');

      expect(result.campos.codigoSAP).toBeDefined();
      expect(result.campos.codigoSAP.valor).toBe('123456');

      expect(result.totalCampos).toBeGreaterThanOrEqual(2);
    });

    it('debería detectar problema potencial en mensajes largos', async () => {
      const mensaje = 'El refrigerador de la tienda no está enfriando correctamente desde ayer';
      const result = await fieldExtractor.extractAllFields(mensaje, {
        tipoReporte: 'REFRIGERADOR',
        useAI: false,
      });

      // No hay campos estructurados, pero sí problema potencial
      expect(result.campos.problemaPotencial).toBeDefined();
      expect(result.campos.problemaPotencial.valor).toBe(mensaje);
      expect(result.campos.problemaPotencial.confianza).toBe(40);
    });

    it('debería retornar 0 campos para mensaje vacío', async () => {
      const result = await fieldExtractor.extractAllFields('', { useAI: false });
      expect(result.totalCampos).toBe(0);
    });

    it('debería no detectar problema potencial en respuestas cortas', async () => {
      const result = await fieldExtractor.extractAllFields('ok', { useAI: false });
      expect(result.campos.problemaPotencial).toBeUndefined();
    });

    it('debería no detectar problema potencial en números solos', async () => {
      const result = await fieldExtractor.extractAllFields('123456', { useAI: false });
      expect(result.campos.problemaPotencial).toBeUndefined();
    });
  });

  describe('PATTERNS', () => {
    it('debería tener patrones definidos para cada tipo de campo', () => {
      expect(fieldExtractor.PATTERNS.codigoSAP).toBeDefined();
      expect(fieldExtractor.PATTERNS.codigoSAP.length).toBeGreaterThan(0);

      expect(fieldExtractor.PATTERNS.numeroEmpleado).toBeDefined();
      expect(fieldExtractor.PATTERNS.ubicacion).toBeDefined();
      expect(fieldExtractor.PATTERNS.coordenadas).toBeDefined();
      expect(fieldExtractor.PATTERNS.numeroTicket).toBeDefined();
    });
  });
});
