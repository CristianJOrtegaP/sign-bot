/**
 * Tests para Field Manager Service (FASE 2b)
 */

const fieldManager = require('../../bot/services/fieldManager');

describe('Field Manager Service', () => {
  describe('CAMPOS_POR_TIPO', () => {
    it('debería tener campos definidos para REFRIGERADOR', () => {
      const campos = fieldManager.CAMPOS_POR_TIPO.REFRIGERADOR;
      expect(campos).toBeDefined();
      expect(campos.codigoSAP).toBeDefined();
      expect(campos.codigoSAP.requerido).toBe(true);
      expect(campos.problema).toBeDefined();
      expect(campos.problema.requerido).toBe(true);
    });

    it('debería tener campos definidos para VEHICULO', () => {
      const campos = fieldManager.CAMPOS_POR_TIPO.VEHICULO;
      expect(campos).toBeDefined();
      expect(campos.numeroEmpleado).toBeDefined();
      expect(campos.numeroEmpleado.requerido).toBe(true);
      expect(campos.codigoSAP).toBeDefined();
      expect(campos.problema).toBeDefined();
      expect(campos.ubicacion).toBeDefined();
    });

    it('debería tener orden definido para cada campo', () => {
      const camposRefri = fieldManager.CAMPOS_POR_TIPO.REFRIGERADOR;
      expect(camposRefri.codigoSAP.orden).toBeLessThan(camposRefri.problema.orden);

      const camposVehiculo = fieldManager.CAMPOS_POR_TIPO.VEHICULO;
      expect(camposVehiculo.numeroEmpleado.orden).toBeLessThan(camposVehiculo.codigoSAP.orden);
      expect(camposVehiculo.codigoSAP.orden).toBeLessThan(camposVehiculo.problema.orden);
    });
  });

  describe('inicializarCampos', () => {
    it('debería crear estructura vacía para REFRIGERADOR', () => {
      const campos = fieldManager.inicializarCampos('REFRIGERADOR');
      expect(campos.codigoSAP).toBeDefined();
      expect(campos.codigoSAP.valor).toBeNull();
      expect(campos.codigoSAP.completo).toBe(false);
      expect(campos.problema).toBeDefined();
      expect(campos.problema.valor).toBeNull();
    });

    it('debería crear estructura vacía para VEHICULO', () => {
      const campos = fieldManager.inicializarCampos('VEHICULO');
      expect(campos.numeroEmpleado).toBeDefined();
      expect(campos.codigoSAP).toBeDefined();
      expect(campos.problema).toBeDefined();
      expect(campos.ubicacion).toBeDefined();
    });

    it('debería retornar objeto vacío para tipo desconocido', () => {
      const campos = fieldManager.inicializarCampos('DESCONOCIDO');
      expect(Object.keys(campos).length).toBe(0);
    });
  });

  describe('crearDatosTemp', () => {
    it('debería crear estructura completa de DatosTemp', () => {
      const datos = fieldManager.crearDatosTemp('REFRIGERADOR');
      expect(datos.tipoReporte).toBe('REFRIGERADOR');
      expect(datos.camposRequeridos).toBeDefined();
      expect(datos.equipoIdTemp).toBeNull();
      expect(datos.datosEquipo).toBeNull();
      expect(datos.version).toBe('2.1');
    });
  });

  describe('validarCampo', () => {
    it('debería validar código SAP correctamente', () => {
      const result = fieldManager.validarCampo('REFRIGERADOR', 'codigoSAP', '123456');
      expect(result.valido).toBe(true);
      expect(result.valorLimpio).toBe('123456');
    });

    it('debería rechazar SAP inválido', () => {
      const result = fieldManager.validarCampo('REFRIGERADOR', 'codigoSAP', '123');
      expect(result.valido).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('debería validar problema con longitud mínima', () => {
      const result = fieldManager.validarCampo(
        'REFRIGERADOR',
        'problema',
        'No enfría correctamente'
      );
      expect(result.valido).toBe(true);
    });

    it('debería rechazar problema muy corto', () => {
      const result = fieldManager.validarCampo('REFRIGERADOR', 'problema', 'falla');
      expect(result.valido).toBe(false);
    });

    it('debería aceptar campos desconocidos', () => {
      const result = fieldManager.validarCampo('REFRIGERADOR', 'campoDesconocido', 'valor');
      expect(result.valido).toBe(true);
    });
  });

  describe('mergeCampos', () => {
    it('debería agregar campos nuevos', () => {
      const existentes = {
        codigoSAP: { valor: null, completo: false, fuente: null, confianza: 0 },
      };
      const nuevos = {
        codigoSAP: { valor: '123456', confianza: 90, fuente: 'regex' },
      };

      const { camposMergeados, camposActualizados } = fieldManager.mergeCampos(
        existentes,
        nuevos,
        'REFRIGERADOR'
      );

      expect(camposMergeados.codigoSAP.valor).toBe('123456');
      expect(camposMergeados.codigoSAP.completo).toBe(true);
      expect(camposActualizados).toContain('codigoSAP');
    });

    it('debería actualizar campo con mayor confianza', () => {
      const existentes = {
        codigoSAP: { valor: '111111', completo: false, fuente: 'ai', confianza: 50 },
      };
      const nuevos = {
        codigoSAP: { valor: '222222', confianza: 90, fuente: 'regex' },
      };

      const { camposMergeados } = fieldManager.mergeCampos(existentes, nuevos, 'REFRIGERADOR');

      expect(camposMergeados.codigoSAP.valor).toBe('222222');
      expect(camposMergeados.codigoSAP.confianza).toBe(90);
    });

    it('debería NO actualizar campo con menor confianza', () => {
      const existentes = {
        codigoSAP: {
          valor: '111111',
          completo: true,
          fuente: 'usuario_confirmado',
          confianza: 100,
        },
      };
      const nuevos = {
        codigoSAP: { valor: '222222', confianza: 60, fuente: 'ai' },
      };

      const { camposMergeados, camposActualizados } = fieldManager.mergeCampos(
        existentes,
        nuevos,
        'REFRIGERADOR'
      );

      expect(camposMergeados.codigoSAP.valor).toBe('111111');
      expect(camposActualizados).not.toContain('codigoSAP');
    });

    it('debería manejar problemaPotencial', () => {
      const existentes = {
        problema: { valor: null, completo: false, fuente: null, confianza: 0 },
      };
      const nuevos = {
        problemaPotencial: {
          valor: 'El refrigerador no enfría',
          confianza: 40,
          fuente: 'inferido',
        },
      };

      const { camposMergeados } = fieldManager.mergeCampos(existentes, nuevos, 'REFRIGERADOR');

      expect(camposMergeados.problema.valor).toBe('El refrigerador no enfría');
      expect(camposMergeados.problema.requiereConfirmacion).toBe(true);
    });

    it('debería registrar errores de validación', () => {
      const existentes = {};
      const nuevos = {
        codigoSAP: { valor: '12', confianza: 90, fuente: 'regex' }, // Inválido
      };

      const { erroresValidacion } = fieldManager.mergeCampos(existentes, nuevos, 'REFRIGERADOR');

      expect(erroresValidacion.length).toBeGreaterThan(0);
      expect(erroresValidacion[0].campo).toBe('codigoSAP');
    });
  });

  describe('getCamposFaltantes', () => {
    it('debería retornar todos los campos si están vacíos', () => {
      const campos = fieldManager.inicializarCampos('REFRIGERADOR');
      const faltantes = fieldManager.getCamposFaltantes(campos, 'REFRIGERADOR');

      expect(faltantes.length).toBe(2); // codigoSAP y problema
      expect(faltantes[0].nombre).toBe('codigoSAP'); // Primero por orden
    });

    it('debería retornar solo campos incompletos', () => {
      const campos = fieldManager.inicializarCampos('REFRIGERADOR');
      campos.codigoSAP = { valor: '123456', completo: true, fuente: 'regex', confianza: 90 };

      const faltantes = fieldManager.getCamposFaltantes(campos, 'REFRIGERADOR');

      expect(faltantes.length).toBe(1);
      expect(faltantes[0].nombre).toBe('problema');
    });

    it('debería retornar array vacío si todo está completo', () => {
      const campos = {
        codigoSAP: { valor: '123456', completo: true, fuente: 'regex', confianza: 90 },
        problema: { valor: 'No enfría', completo: true, fuente: 'ai', confianza: 80 },
      };

      const faltantes = fieldManager.getCamposFaltantes(campos, 'REFRIGERADOR');
      expect(faltantes.length).toBe(0);
    });

    it('debería ordenar por prioridad', () => {
      const campos = fieldManager.inicializarCampos('VEHICULO');
      const faltantes = fieldManager.getCamposFaltantes(campos, 'VEHICULO');

      expect(faltantes[0].nombre).toBe('numeroEmpleado');
      expect(faltantes[1].nombre).toBe('codigoSAP');
      expect(faltantes[2].nombre).toBe('problema');
      expect(faltantes[3].nombre).toBe('ubicacion');
    });
  });

  describe('getSiguienteCampoFaltante', () => {
    it('debería retornar el primer campo faltante', () => {
      const campos = fieldManager.inicializarCampos('REFRIGERADOR');
      const siguiente = fieldManager.getSiguienteCampoFaltante(campos, 'REFRIGERADOR');

      expect(siguiente).not.toBeNull();
      expect(siguiente.nombre).toBe('codigoSAP');
    });

    it('debería retornar null si está completo', () => {
      const campos = {
        codigoSAP: { valor: '123456', completo: true },
        problema: { valor: 'No enfría', completo: true },
      };

      const siguiente = fieldManager.getSiguienteCampoFaltante(campos, 'REFRIGERADOR');
      expect(siguiente).toBeNull();
    });
  });

  describe('calcularCompletitud', () => {
    it('debería calcular 0% para campos vacíos', () => {
      const campos = fieldManager.inicializarCampos('REFRIGERADOR');
      const completitud = fieldManager.calcularCompletitud(campos, 'REFRIGERADOR');

      expect(completitud.porcentaje).toBe(0);
      expect(completitud.completados).toBe(0);
      expect(completitud.total).toBe(2);
    });

    it('debería calcular 50% para mitad completa', () => {
      const campos = {
        codigoSAP: { valor: '123456', completo: true },
        problema: { valor: null, completo: false },
      };

      const completitud = fieldManager.calcularCompletitud(campos, 'REFRIGERADOR');
      expect(completitud.porcentaje).toBe(50);
      expect(completitud.completados).toBe(1);
    });

    it('debería calcular 100% para todo completo', () => {
      const campos = {
        codigoSAP: { valor: '123456', completo: true },
        problema: { valor: 'No enfría', completo: true },
      };

      const completitud = fieldManager.calcularCompletitud(campos, 'REFRIGERADOR');
      expect(completitud.porcentaje).toBe(100);
      expect(completitud.completados).toBe(2);
    });
  });

  describe('estaCompleto', () => {
    it('debería retornar false para campos vacíos', () => {
      const campos = fieldManager.inicializarCampos('REFRIGERADOR');
      expect(fieldManager.estaCompleto(campos, 'REFRIGERADOR')).toBe(false);
    });

    it('debería retornar true para todo completo', () => {
      const campos = {
        codigoSAP: { valor: '123456', completo: true },
        problema: { valor: 'No enfría', completo: true },
      };
      expect(fieldManager.estaCompleto(campos, 'REFRIGERADOR')).toBe(true);
    });
  });

  describe('parseDatosTemp', () => {
    it('debería parsear string JSON', () => {
      const json = JSON.stringify({
        tipoReporte: 'REFRIGERADOR',
        camposRequeridos: { codigoSAP: { valor: '123456' } },
      });

      const datos = fieldManager.parseDatosTemp(json);
      expect(datos.tipoReporte).toBe('REFRIGERADOR');
      expect(datos.camposRequeridos.codigoSAP.valor).toBe('123456');
    });

    it('debería manejar objeto directo', () => {
      const obj = {
        tipoReporte: 'VEHICULO',
        equipoIdTemp: 123,
      };

      const datos = fieldManager.parseDatosTemp(obj);
      expect(datos.tipoReporte).toBe('VEHICULO');
      expect(datos.equipoIdTemp).toBe(123);
    });

    it('debería manejar null/undefined', () => {
      const datos = fieldManager.parseDatosTemp(null);
      expect(datos.tipoReporte).toBeNull();
      expect(datos.camposRequeridos).toEqual({});
    });
  });

  describe('confirmarCampo', () => {
    it('debería marcar campo como confirmado', () => {
      const campos = {
        problema: { valor: 'No enfría', completo: false, requiereConfirmacion: true },
      };

      fieldManager.confirmarCampo(campos, 'problema');

      expect(campos.problema.completo).toBe(true);
      expect(campos.problema.fuente).toBe('usuario_confirmado');
      expect(campos.problema.confianza).toBe(100);
      expect(campos.problema.requiereConfirmacion).toBeUndefined();
    });
  });

  describe('setCampo', () => {
    it('debería establecer campo válido', () => {
      const campos = {};
      const {
        campos: result,
        exito,
        error,
      } = fieldManager.setCampo(campos, 'codigoSAP', '123456', 'REFRIGERADOR');

      expect(exito).toBe(true);
      expect(error).toBeNull();
      expect(result.codigoSAP.valor).toBe('123456');
      expect(result.codigoSAP.completo).toBe(true);
      expect(result.codigoSAP.fuente).toBe('usuario_directo');
    });

    it('debería rechazar campo inválido', () => {
      const campos = {};
      const { exito, error } = fieldManager.setCampo(campos, 'codigoSAP', '12', 'REFRIGERADOR');

      expect(exito).toBe(false);
      expect(error).toBeTruthy();
    });
  });

  describe('actualizarDatosTemp', () => {
    it('debería actualizar DatosTemp con nuevos campos', () => {
      const datosTemp = fieldManager.crearDatosTemp('REFRIGERADOR');
      const camposNuevos = {
        codigoSAP: { valor: '123456', confianza: 90, fuente: 'regex' },
      };

      const { datosActualizados, resumenActualizacion } = fieldManager.actualizarDatosTemp(
        datosTemp,
        camposNuevos
      );

      expect(datosActualizados.camposRequeridos.codigoSAP.valor).toBe('123456');
      expect(resumenActualizacion.camposActualizados).toContain('codigoSAP');
      expect(resumenActualizacion.completitud.completados).toBe(1);
    });

    it('debería detectar cuando está completo', () => {
      const datosTemp = fieldManager.crearDatosTemp('REFRIGERADOR');
      datosTemp.camposRequeridos.codigoSAP = { valor: '123456', completo: true };

      const camposNuevos = {
        problema: { valor: 'El refrigerador no enfría correctamente', confianza: 80, fuente: 'ai' },
      };

      const { resumenActualizacion } = fieldManager.actualizarDatosTemp(datosTemp, camposNuevos);

      expect(resumenActualizacion.estaCompleto).toBe(true);
      expect(resumenActualizacion.completitud.porcentaje).toBe(100);
    });
  });
});
