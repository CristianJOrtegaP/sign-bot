/**
 * Unit Test: FlexibleFlowContext
 * Verifica gestión de campos dinámicos, equipo y confirmaciones
 */

jest.mock('../../../core/services/infrastructure/appInsightsService', () =>
  require('../../__mocks__/appInsightsService.mock')
);
jest.mock('../../../core/services/external/whatsappService', () =>
  require('../../__mocks__/whatsappService.mock')
);
jest.mock('../../../core/services/storage/databaseService', () =>
  require('../../__mocks__/databaseService.mock')
);
jest.mock('../../../core/services/infrastructure/metricsService', () =>
  require('../../__mocks__/metricsService.mock')
);
jest.mock('../../../core/services/infrastructure/errorHandler', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const FlexibleFlowContext = require('../../../core/flowEngine/contexts/FlexibleFlowContext');
const {
  createFlexibleFlowContext,
} = require('../../../core/flowEngine/contexts/FlexibleFlowContext');
const db = require('../../../core/services/storage/databaseService');

describe('FlexibleFlowContext', () => {
  const from = '+5215512345678';
  let ctx;
  let azureContext;

  beforeEach(() => {
    jest.clearAllMocks();
    azureContext = global.createMockContext();
    // DatosTemp como OBJETO (no string) para que getDatos() retorne por referencia
    // y las mutaciones en actualizarCampo/actualizarCampos persistan en la misma ejecución
    const datosTemp = {
      tipoReporte: 'REFRIGERADOR',
      camposRequeridos: {
        codigoSAP: { valor: '1234567', completo: true, fuente: 'usuario' },
        problema: {
          valor: null,
          completo: false,
          descripcion: 'Problema reportado',
          requerido: true,
        },
        ubicacion: { valor: null, completo: false, requerido: false },
      },
    };
    const session = {
      Estado: 'REFRIGERADOR_ACTIVO',
      Version: 1,
      EquipoId: null,
      DatosTemp: datosTemp,
    };
    db.__reset();
    db.__setSession(from, session);
    ctx = new FlexibleFlowContext(from, session, azureContext, {
      flowName: 'REPORTE_REFRIGERADOR',
      tipoReporte: 'REFRIGERADOR',
    });
  });

  // ===========================================================
  // FACTORY
  // ===========================================================
  describe('createFlexibleFlowContext', () => {
    test('debe crear instancia via factory', () => {
      const session = { Estado: 'VEHICULO_ACTIVO', Version: 1, EquipoId: null, DatosTemp: null };
      const instance = createFlexibleFlowContext(from, session, azureContext, {
        flowName: 'REPORTE_VEHICULO',
        tipoReporte: 'VEHICULO',
      });
      expect(instance).toBeInstanceOf(FlexibleFlowContext);
      expect(instance.tipoReporte).toBe('VEHICULO');
    });
  });

  // ===========================================================
  // CAMPOS REQUERIDOS
  // ===========================================================
  describe('getCamposRequeridos', () => {
    test('debe retornar campos del DatosTemp', () => {
      const campos = ctx.getCamposRequeridos();
      expect(campos.codigoSAP).toBeDefined();
      expect(campos.problema).toBeDefined();
      expect(campos.ubicacion).toBeDefined();
    });

    test('debe retornar objeto vacío si no hay campos', () => {
      const session = {
        Estado: 'REFRIGERADOR_ACTIVO',
        Version: 1,
        EquipoId: null,
        DatosTemp: null,
      };
      const emptyCtx = new FlexibleFlowContext(from, session, azureContext);
      expect(emptyCtx.getCamposRequeridos()).toEqual({});
    });
  });

  // ===========================================================
  // CAMPO ESTA COMPLETO
  // ===========================================================
  describe('campoEstaCompleto', () => {
    test('debe retornar true para campo completo', () => {
      expect(ctx.campoEstaCompleto('codigoSAP')).toBe(true);
    });

    test('debe retornar false para campo incompleto', () => {
      expect(ctx.campoEstaCompleto('problema')).toBe(false);
    });

    test('debe retornar false para campo inexistente', () => {
      expect(ctx.campoEstaCompleto('noExiste')).toBe(false);
    });
  });

  // ===========================================================
  // GET VALOR CAMPO
  // ===========================================================
  describe('getValorCampo', () => {
    test('debe retornar valor de campo existente', () => {
      expect(ctx.getValorCampo('codigoSAP')).toBe('1234567');
    });

    test('debe retornar null para campo sin valor', () => {
      expect(ctx.getValorCampo('problema')).toBeNull();
    });

    test('debe retornar null para campo inexistente', () => {
      expect(ctx.getValorCampo('noExiste')).toBeNull();
    });
  });

  // ===========================================================
  // ACTUALIZAR CAMPO
  // ===========================================================
  describe('actualizarCampo', () => {
    test('debe actualizar un campo y persistir', async () => {
      await ctx.actualizarCampo('problema', 'No enfría', { fuente: 'usuario', confianza: 1.0 });
      expect(ctx.campoEstaCompleto('problema')).toBe(true);
      expect(ctx.getValorCampo('problema')).toBe('No enfría');
      expect(db.updateSession).toHaveBeenCalled();
    });

    test('debe crear camposRequeridos si no existe', async () => {
      // DatosTemp como objeto vacío para que getDatos() retorne por referencia
      const datosVacios = {};
      const session = {
        Estado: 'REFRIGERADOR_ACTIVO',
        Version: 1,
        EquipoId: null,
        DatosTemp: datosVacios,
      };
      db.__setSession(from, session);
      const emptyCtx = new FlexibleFlowContext(from, session, azureContext);
      await emptyCtx.actualizarCampo('test', 'valor');
      expect(emptyCtx.getValorCampo('test')).toBe('valor');
    });
  });

  // ===========================================================
  // ACTUALIZAR CAMPOS (BATCH)
  // ===========================================================
  describe('actualizarCampos', () => {
    test('debe actualizar múltiples campos a la vez', async () => {
      await ctx.actualizarCampos({
        problema: { valor: 'No enfría', fuente: 'usuario' },
        ubicacion: { valor: { lat: 19.43, lng: -99.13 }, fuente: 'gps' },
      });
      expect(ctx.campoEstaCompleto('problema')).toBe(true);
      expect(ctx.campoEstaCompleto('ubicacion')).toBe(true);
      // Solo una llamada a updateSession (batch)
      expect(db.updateSession).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================
  // CAMPOS FALTANTES
  // ===========================================================
  describe('getCamposFaltantes', () => {
    test('debe retornar campos incompletos', () => {
      const faltantes = ctx.getCamposFaltantes();
      const nombres = faltantes.map((f) => f.nombre);
      expect(nombres).toContain('problema');
      expect(nombres).not.toContain('codigoSAP');
    });

    test('debe incluir descripción y requerido', () => {
      const faltantes = ctx.getCamposFaltantes();
      const problema = faltantes.find((f) => f.nombre === 'problema');
      expect(problema.descripcion).toBe('Problema reportado');
      expect(problema.requerido).toBe(true);
    });
  });

  // ===========================================================
  // COMPLETITUD
  // ===========================================================
  describe('getCompletitud', () => {
    test('debe calcular porcentaje correcto', () => {
      const completitud = ctx.getCompletitud();
      expect(completitud.completados).toBe(1); // solo codigoSAP
      expect(completitud.total).toBe(3);
      expect(completitud.porcentaje).toBe(33);
    });
  });

  describe('todosLosCamposCompletos', () => {
    test('debe retornar false si hay campos faltantes', () => {
      expect(ctx.todosLosCamposCompletos()).toBe(false);
    });

    test('debe retornar true si todos están completos', async () => {
      await ctx.actualizarCampos({
        problema: { valor: 'No enfría', fuente: 'usuario' },
        ubicacion: { valor: 'Tienda Centro', fuente: 'usuario' },
      });
      expect(ctx.todosLosCamposCompletos()).toBe(true);
    });
  });

  // ===========================================================
  // CAMPO SOLICITADO
  // ===========================================================
  describe('setCampoSolicitado / getCampoSolicitado', () => {
    test('debe establecer y obtener campo solicitado', async () => {
      await ctx.setCampoSolicitado('problema');
      expect(ctx.getCampoSolicitado()).toBe('problema');
    });

    test('debe retornar null si no hay campo solicitado', () => {
      expect(ctx.getCampoSolicitado()).toBeNull();
    });
  });

  // ===========================================================
  // DATOS EQUIPO
  // ===========================================================
  describe('getDatosEquipo / guardarDatosEquipo', () => {
    test('debe retornar null si no hay equipo', () => {
      expect(ctx.getDatosEquipo()).toBeNull();
    });

    test('debe guardar y retornar datos de equipo', async () => {
      const equipo = { EquipoId: 42, CodigoSAP: '1234567', Descripcion: 'Refrigerador Vitrina' };
      await ctx.guardarDatosEquipo(equipo);
      expect(ctx.getDatosEquipo()).toEqual(equipo);
    });
  });

  describe('buscarEquipoPorSAP', () => {
    test('debe buscar equipo en BD', async () => {
      const mockEquipo = { EquipoId: 42, CodigoSAP: '1234567' };
      db.getEquipoBySAP.mockResolvedValue(mockEquipo);
      const result = await ctx.buscarEquipoPorSAP('1234567');
      expect(result).toEqual(mockEquipo);
      expect(db.getEquipoBySAP).toHaveBeenCalledWith('1234567');
    });

    test('debe retornar null si no encuentra equipo', async () => {
      db.getEquipoBySAP.mockResolvedValue(null);
      const result = await ctx.buscarEquipoPorSAP('9999999');
      expect(result).toBeNull();
    });
  });

  // ===========================================================
  // CONFIRMACION
  // ===========================================================
  describe('solicitarConfirmacion', () => {
    test('debe cambiar estado a confirmación y guardar datos', async () => {
      await ctx.solicitarConfirmacion('CONFIRMAR_DATOS', { resumen: 'Refrigerador no enfría' });
      expect(db.updateSession).toHaveBeenCalledWith(
        from,
        'CONFIRMAR_DATOS',
        expect.objectContaining({ datosAConfirmar: { resumen: 'Refrigerador no enfría' } }),
        null,
        expect.any(String),
        expect.any(String),
        null,
        1
      );
    });
  });

  // ===========================================================
  // RESUMEN
  // ===========================================================
  describe('generarResumen', () => {
    test('debe generar resumen de campos completos', () => {
      const resumen = ctx.generarResumen();
      expect(resumen).toContain('Código SAP');
      expect(resumen).toContain('1234567');
    });

    test('debe formatear nombres de campos correctamente', () => {
      expect(ctx._formatearNombreCampo('codigoSAP')).toBe('Código SAP');
      expect(ctx._formatearNombreCampo('problema')).toBe('Problema');
      expect(ctx._formatearNombreCampo('desconocido')).toBe('desconocido');
    });
  });

  // ===========================================================
  // GETDATOSSTEMP (ALIAS)
  // ===========================================================
  describe('getDatosTemp', () => {
    test('debe retornar lo mismo que getDatos', () => {
      expect(ctx.getDatosTemp()).toEqual(ctx.getDatos());
    });
  });
});
