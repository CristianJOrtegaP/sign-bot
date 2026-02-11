/**
 * Unit Test: Document States
 * Verifica helpers de estados de documento de firma
 */

const {
  ESTADO_DOCUMENTO,
  TIPO_DOCUMENTO,
  esEstadoDocumentoFinal,
  esEstadoDocumentoActivo,
  esEstadoRecordatorio,
  getEstadoDocumentoInfo,
  getEstadoDocumentoId,
  getTipoDocumentoId,
} = require('../../bot/constants/documentStates');

describe('Document States', () => {
  // ===========================================================
  // CONSTANTES
  // ===========================================================
  describe('Constantes de estados', () => {
    test('debe tener todos los estados de documento definidos', () => {
      expect(ESTADO_DOCUMENTO.PENDIENTE_ENVIO).toBe('PENDIENTE_ENVIO');
      expect(ESTADO_DOCUMENTO.ENVIADO).toBe('ENVIADO');
      expect(ESTADO_DOCUMENTO.ENTREGADO).toBe('ENTREGADO');
      expect(ESTADO_DOCUMENTO.VISTO).toBe('VISTO');
      expect(ESTADO_DOCUMENTO.FIRMADO).toBe('FIRMADO');
      expect(ESTADO_DOCUMENTO.RECHAZADO).toBe('RECHAZADO');
      expect(ESTADO_DOCUMENTO.ANULADO).toBe('ANULADO');
      expect(ESTADO_DOCUMENTO.ERROR).toBe('ERROR');
    });

    test('debe tener todos los tipos de documento definidos', () => {
      expect(TIPO_DOCUMENTO.CONTRATO).toBe('CONTRATO');
      expect(TIPO_DOCUMENTO.ADENDUM).toBe('ADENDUM');
      expect(TIPO_DOCUMENTO.PAGARE).toBe('PAGARE');
      expect(TIPO_DOCUMENTO.OTRO).toBe('OTRO');
    });
  });

  // ===========================================================
  // esEstadoDocumentoFinal
  // ===========================================================
  describe('esEstadoDocumentoFinal()', () => {
    test('FIRMADO es estado final', () => {
      expect(esEstadoDocumentoFinal('FIRMADO')).toBe(true);
    });

    test('ANULADO es estado final', () => {
      expect(esEstadoDocumentoFinal('ANULADO')).toBe(true);
    });

    test('ENVIADO no es estado final', () => {
      expect(esEstadoDocumentoFinal('ENVIADO')).toBe(false);
    });

    test('RECHAZADO no es estado final (permite reenvio)', () => {
      expect(esEstadoDocumentoFinal('RECHAZADO')).toBe(false);
    });

    test('PENDIENTE_ENVIO no es estado final', () => {
      expect(esEstadoDocumentoFinal('PENDIENTE_ENVIO')).toBe(false);
    });

    test('estado desconocido no es final', () => {
      expect(esEstadoDocumentoFinal('ESTADO_INVENTADO')).toBe(false);
    });
  });

  // ===========================================================
  // esEstadoDocumentoActivo
  // ===========================================================
  describe('esEstadoDocumentoActivo()', () => {
    test('PENDIENTE_ENVIO es activo', () => {
      expect(esEstadoDocumentoActivo('PENDIENTE_ENVIO')).toBe(true);
    });

    test('ENVIADO es activo', () => {
      expect(esEstadoDocumentoActivo('ENVIADO')).toBe(true);
    });

    test('ENTREGADO es activo', () => {
      expect(esEstadoDocumentoActivo('ENTREGADO')).toBe(true);
    });

    test('VISTO es activo', () => {
      expect(esEstadoDocumentoActivo('VISTO')).toBe(true);
    });

    test('RECHAZADO es activo (permite reenvio)', () => {
      expect(esEstadoDocumentoActivo('RECHAZADO')).toBe(true);
    });

    test('ERROR es activo (reintentable)', () => {
      expect(esEstadoDocumentoActivo('ERROR')).toBe(true);
    });

    test('FIRMADO no es activo', () => {
      expect(esEstadoDocumentoActivo('FIRMADO')).toBe(false);
    });

    test('ANULADO no es activo', () => {
      expect(esEstadoDocumentoActivo('ANULADO')).toBe(false);
    });
  });

  // ===========================================================
  // esEstadoRecordatorio
  // ===========================================================
  describe('esEstadoRecordatorio()', () => {
    test('ENVIADO permite recordatorios', () => {
      expect(esEstadoRecordatorio('ENVIADO')).toBe(true);
    });

    test('ENTREGADO permite recordatorios', () => {
      expect(esEstadoRecordatorio('ENTREGADO')).toBe(true);
    });

    test('VISTO permite recordatorios', () => {
      expect(esEstadoRecordatorio('VISTO')).toBe(true);
    });

    test('RECHAZADO permite recordatorios', () => {
      expect(esEstadoRecordatorio('RECHAZADO')).toBe(true);
    });

    test('FIRMADO no permite recordatorios', () => {
      expect(esEstadoRecordatorio('FIRMADO')).toBe(false);
    });

    test('PENDIENTE_ENVIO no permite recordatorios', () => {
      expect(esEstadoRecordatorio('PENDIENTE_ENVIO')).toBe(false);
    });

    test('ANULADO no permite recordatorios', () => {
      expect(esEstadoRecordatorio('ANULADO')).toBe(false);
    });
  });

  // ===========================================================
  // getEstadoDocumentoInfo
  // ===========================================================
  describe('getEstadoDocumentoInfo()', () => {
    test('debe retornar info para FIRMADO', () => {
      const info = getEstadoDocumentoInfo('FIRMADO');
      expect(info.nombre).toBe('Firmado');
      expect(info.emoji).toBeDefined();
      expect(info.mensaje).toBeDefined();
    });

    test('debe retornar info para RECHAZADO', () => {
      const info = getEstadoDocumentoInfo('RECHAZADO');
      expect(info.nombre).toBe('Rechazado');
      expect(info.emoji).toBeDefined();
    });

    test('debe retornar info para ENVIADO', () => {
      const info = getEstadoDocumentoInfo('ENVIADO');
      expect(info.nombre).toBe('Enviado');
    });

    test('debe retornar info por defecto para estado desconocido', () => {
      const info = getEstadoDocumentoInfo('DESCONOCIDO');
      expect(info.nombre).toBe('DESCONOCIDO');
    });

    test('cada estado conocido debe tener emoji, nombre y mensaje', () => {
      const estados = Object.values(ESTADO_DOCUMENTO);
      for (const estado of estados) {
        const info = getEstadoDocumentoInfo(estado);
        expect(info.emoji).toBeDefined();
        expect(info.nombre).toBeDefined();
        expect(info.mensaje).toBeDefined();
      }
    });
  });

  // ===========================================================
  // getEstadoDocumentoId / getTipoDocumentoId
  // ===========================================================
  describe('getEstadoDocumentoId()', () => {
    test('debe retornar ID numerico para PENDIENTE_ENVIO', () => {
      expect(getEstadoDocumentoId('PENDIENTE_ENVIO')).toBe(1);
    });

    test('debe retornar ID numerico para FIRMADO', () => {
      expect(getEstadoDocumentoId('FIRMADO')).toBe(5);
    });

    test('debe retornar null para estado desconocido', () => {
      expect(getEstadoDocumentoId('DESCONOCIDO')).toBeNull();
    });
  });

  describe('getTipoDocumentoId()', () => {
    test('debe retornar ID numerico para CONTRATO', () => {
      expect(getTipoDocumentoId('CONTRATO')).toBe(1);
    });

    test('debe retornar ID numerico para PAGARE', () => {
      expect(getTipoDocumentoId('PAGARE')).toBe(3);
    });

    test('debe retornar null para tipo desconocido', () => {
      expect(getTipoDocumentoId('DESCONOCIDO')).toBeNull();
    });
  });
});
