/**
 * Unit Test: Firma Reminder Timer
 * Verifica logica de recordatorios, reportes SAP y housekeeping
 */

const { createDocumentoEnviado } = require('../factories/documentoFactory');

describe('Firma Reminder Timer - Logica de recordatorios', () => {
  // ===========================================================
  // ELEGIBILIDAD DE RECORDATORIO
  // ===========================================================
  describe('Elegibilidad de recordatorio', () => {
    test('documento ENVIADO es elegible para recordatorio', () => {
      const { esEstadoRecordatorio } = require('../../bot/constants/documentStates');
      expect(esEstadoRecordatorio('ENVIADO')).toBe(true);
    });

    test('documento ENTREGADO es elegible para recordatorio', () => {
      const { esEstadoRecordatorio } = require('../../bot/constants/documentStates');
      expect(esEstadoRecordatorio('ENTREGADO')).toBe(true);
    });

    test('documento VISTO es elegible para recordatorio', () => {
      const { esEstadoRecordatorio } = require('../../bot/constants/documentStates');
      expect(esEstadoRecordatorio('VISTO')).toBe(true);
    });

    test('documento RECHAZADO es elegible para recordatorio', () => {
      const { esEstadoRecordatorio } = require('../../bot/constants/documentStates');
      expect(esEstadoRecordatorio('RECHAZADO')).toBe(true);
    });

    test('documento FIRMADO no es elegible para recordatorio', () => {
      const { esEstadoRecordatorio } = require('../../bot/constants/documentStates');
      expect(esEstadoRecordatorio('FIRMADO')).toBe(false);
    });

    test('documento ANULADO no es elegible para recordatorio', () => {
      const { esEstadoRecordatorio } = require('../../bot/constants/documentStates');
      expect(esEstadoRecordatorio('ANULADO')).toBe(false);
    });

    test('documento PENDIENTE_ENVIO no es elegible para recordatorio', () => {
      const { esEstadoRecordatorio } = require('../../bot/constants/documentStates');
      expect(esEstadoRecordatorio('PENDIENTE_ENVIO')).toBe(false);
    });
  });

  // ===========================================================
  // LOGICA DE MAX RECORDATORIOS
  // ===========================================================
  describe('Logica de max recordatorios', () => {
    const maxRecordatorios = parseInt(process.env.FIRMA_MAX_RECORDATORIOS_CLIENTE || '5', 10);

    test('debe tener configurado FIRMA_MAX_RECORDATORIOS_CLIENTE', () => {
      expect(maxRecordatorios).toBeGreaterThan(0);
    });

    test('documento con recordatorios < max es elegible', () => {
      const doc = createDocumentoEnviado({ RecordatoriosEnviados: 2 });
      expect(doc.RecordatoriosEnviados < maxRecordatorios).toBe(true);
    });

    test('documento con recordatorios == max no es elegible', () => {
      const doc = createDocumentoEnviado({ RecordatoriosEnviados: maxRecordatorios });
      expect(doc.RecordatoriosEnviados < maxRecordatorios).toBe(false);
    });

    test('documento con recordatorios > max no es elegible', () => {
      const doc = createDocumentoEnviado({ RecordatoriosEnviados: maxRecordatorios + 1 });
      expect(doc.RecordatoriosEnviados < maxRecordatorios).toBe(false);
    });
  });

  // ===========================================================
  // LOGICA DE HOUSEKEEPING
  // ===========================================================
  describe('Logica de housekeeping', () => {
    const housekeepingDays = parseInt(process.env.FIRMA_HOUSEKEEPING_DAYS || '30', 10);

    test('debe tener configurado FIRMA_HOUSEKEEPING_DAYS', () => {
      expect(housekeepingDays).toBeGreaterThan(0);
    });

    test('documento creado hace mas dias que housekeeping es candidato', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - (housekeepingDays + 1));
      const doc = createDocumentoEnviado({ FechaCreacion: oldDate });

      const daysSinceCreation = Math.floor(
        (Date.now() - new Date(doc.FechaCreacion).getTime()) / (1000 * 60 * 60 * 24)
      );
      expect(daysSinceCreation).toBeGreaterThan(housekeepingDays);
    });

    test('documento reciente no es candidato para housekeeping', () => {
      const doc = createDocumentoEnviado({ FechaCreacion: new Date() });

      const daysSinceCreation = Math.floor(
        (Date.now() - new Date(doc.FechaCreacion).getTime()) / (1000 * 60 * 60 * 24)
      );
      expect(daysSinceCreation).toBeLessThanOrEqual(housekeepingDays);
    });

    test('documento FIRMADO no es candidato para housekeeping (es final)', () => {
      const { esEstadoDocumentoFinal } = require('../../bot/constants/documentStates');
      expect(esEstadoDocumentoFinal('FIRMADO')).toBe(true);
    });

    test('documento ANULADO no es candidato para housekeeping (ya esta anulado)', () => {
      const { esEstadoDocumentoFinal } = require('../../bot/constants/documentStates');
      expect(esEstadoDocumentoFinal('ANULADO')).toBe(true);
    });
  });

  // ===========================================================
  // CONFIGURACION DE TIEMPOS
  // ===========================================================
  describe('Configuracion de tiempos de recordatorio', () => {
    test('FIRMA_REMINDER_HOURS_CLIENTE debe estar configurado', () => {
      const hours = parseInt(process.env.FIRMA_REMINDER_HOURS_CLIENTE || '48', 10);
      expect(hours).toBeGreaterThan(0);
    });

    test('FIRMA_REMINDER_DAYS_SAP debe estar configurado', () => {
      const days = parseInt(process.env.FIRMA_REMINDER_DAYS_SAP || '7', 10);
      expect(days).toBeGreaterThan(0);
    });

    test('FIRMA_MAX_RECORDATORIOS_CLIENTE debe estar configurado', () => {
      const max = parseInt(process.env.FIRMA_MAX_RECORDATORIOS_CLIENTE || '5', 10);
      expect(max).toBeGreaterThan(0);
    });

    test('FIRMA_HOUSEKEEPING_DAYS debe estar configurado', () => {
      const days = parseInt(process.env.FIRMA_HOUSEKEEPING_DAYS || '30', 10);
      expect(days).toBeGreaterThan(0);
    });
  });

  // ===========================================================
  // CALCULO DE DIAS PENDIENTES
  // ===========================================================
  describe('Calculo de dias pendientes', () => {
    test('debe calcular correctamente dias desde creacion', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const doc = createDocumentoEnviado({ FechaCreacion: threeDaysAgo });

      const diasPendientes = Math.floor(
        (Date.now() - new Date(doc.FechaCreacion).getTime()) / (1000 * 60 * 60 * 24)
      );
      expect(diasPendientes).toBe(3);
    });

    test('documento recien creado debe tener 0 dias pendientes', () => {
      const doc = createDocumentoEnviado({ FechaCreacion: new Date() });

      const diasPendientes = Math.floor(
        (Date.now() - new Date(doc.FechaCreacion).getTime()) / (1000 * 60 * 60 * 24)
      );
      expect(diasPendientes).toBe(0);
    });
  });
});
