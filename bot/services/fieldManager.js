/**
 * AC FIXBOT - Field Manager Service (FASE 2b)
 *
 * Gestiona los campos requeridos por cada tipo de reporte:
 * - Define qué campos son necesarios/opcionales por flujo
 * - Valida campos extraídos
 * - Mergea campos nuevos con existentes
 * - Calcula porcentaje de completitud
 * - Determina el siguiente campo faltante
 *
 * Estructura de DatosTemp esperada:
 * {
 *   tipoReporte: 'REFRIGERADOR' | 'VEHICULO',
 *   camposRequeridos: {
 *     codigoSAP: { valor: '123456', completo: true, fuente: 'regex', confianza: 95 },
 *     problema: { valor: null, completo: false, fuente: null, confianza: 0 },
 *     ...
 *   },
 *   equipoIdTemp: 123,  // ID del equipo encontrado (para refrigerador)
 *   datosEquipo: {...}  // Datos completos del equipo
 * }
 */

const { TIPO_REPORTE } = require('../constants/sessionStates');
const {
  validateSAPCode,
  validateEmployeeNumber,
  safeParseJSON,
} = require('../../core/utils/helpers');
const { logger } = require('../../core/services/infrastructure/errorHandler');

// ==============================================================
// DEFINICIÓN DE CAMPOS POR TIPO DE REPORTE
// ==============================================================

/**
 * Campos requeridos por tipo de reporte
 * - requerido: true = obligatorio para crear reporte
 * - orden: prioridad para solicitar al usuario (menor = primero)
 * - validador: función de validación (opcional)
 * - mensaje: clave del mensaje para solicitar este campo
 */
const CAMPOS_POR_TIPO = {
  [TIPO_REPORTE.REFRIGERADOR]: {
    codigoSAP: {
      requerido: true,
      orden: 1,
      validador: validateSAPCode,
      mensaje: 'SOLICITAR_SAP',
      descripcion: 'Código SAP del refrigerador',
    },
    problema: {
      requerido: true,
      orden: 2,
      validador: (valor) => ({ valid: valor && valor.length >= 5, cleaned: valor }),
      mensaje: 'SOLICITAR_DESCRIPCION',
      descripcion: 'Descripción del problema',
    },
  },

  [TIPO_REPORTE.VEHICULO]: {
    numeroEmpleado: {
      requerido: true,
      orden: 1,
      validador: validateEmployeeNumber,
      mensaje: 'SOLICITAR_EMPLEADO',
      descripcion: 'Número de empleado',
    },
    codigoSAP: {
      requerido: true,
      orden: 2,
      validador: validateSAPCode,
      mensaje: 'SOLICITAR_SAP_VEHICULO',
      descripcion: 'Código SAP del vehículo',
    },
    problema: {
      requerido: true,
      orden: 3,
      validador: (valor) => ({ valid: valor && valor.length >= 5, cleaned: valor }),
      mensaje: 'SOLICITAR_DESCRIPCION_VEHICULO',
      descripcion: 'Descripción del problema',
    },
    ubicacion: {
      requerido: true,
      orden: 4,
      validador: (valor) => ({ valid: valor && valor.length >= 5, cleaned: valor }),
      mensaje: 'SOLICITAR_UBICACION',
      descripcion: 'Ubicación del vehículo',
    },
  },
};

// Umbral de confianza mínimo para considerar un campo "completo"
const UMBRAL_CONFIANZA = 60;

// ==============================================================
// INICIALIZACIÓN
// ==============================================================

/**
 * Inicializa la estructura de campos requeridos para un tipo de reporte
 * @param {string} tipoReporte - REFRIGERADOR | VEHICULO
 * @returns {Object} - Estructura de camposRequeridos vacía
 */
function inicializarCampos(tipoReporte) {
  const definicion = CAMPOS_POR_TIPO[tipoReporte];
  if (!definicion) {
    logger.warn(`[FieldManager] Tipo de reporte desconocido: ${tipoReporte}`);
    return {};
  }

  const camposRequeridos = {};
  for (const [nombreCampo, config] of Object.entries(definicion)) {
    camposRequeridos[nombreCampo] = {
      valor: null,
      completo: false,
      fuente: null,
      confianza: 0,
      opcional: !config.requerido,
    };
  }

  return camposRequeridos;
}

/**
 * Crea estructura DatosTemp inicial para un flujo flexible
 * @param {string} tipoReporte - REFRIGERADOR | VEHICULO
 * @returns {Object} - DatosTemp inicializado
 */
function crearDatosTemp(tipoReporte) {
  return {
    tipoReporte,
    camposRequeridos: inicializarCampos(tipoReporte),
    equipoIdTemp: null,
    datosEquipo: null,
    iniciadoEn: new Date().toISOString(),
    version: '2.1', // FASE 2b
  };
}

// ==============================================================
// VALIDACIÓN Y MERGE DE CAMPOS
// ==============================================================

/**
 * Valida un campo usando su validador definido
 * @param {string} tipoReporte - Tipo de reporte
 * @param {string} nombreCampo - Nombre del campo
 * @param {string} valor - Valor a validar
 * @returns {Object} - { valido, valorLimpio, error }
 */
function validarCampo(tipoReporte, nombreCampo, valor) {
  const definicion = CAMPOS_POR_TIPO[tipoReporte]?.[nombreCampo];

  if (!definicion) {
    // Campo no definido, aceptar como está
    return { valido: true, valorLimpio: valor, error: null };
  }

  if (!valor) {
    return { valido: false, valorLimpio: null, error: 'Valor vacío' };
  }

  if (definicion.validador) {
    const resultado = definicion.validador(valor);
    return {
      valido: resultado.valid,
      valorLimpio: resultado.cleaned || valor,
      error: resultado.error || (resultado.valid ? null : 'Valor inválido'),
    };
  }

  return { valido: true, valorLimpio: valor, error: null };
}

/**
 * Mergea campos extraídos con campos existentes
 * Solo actualiza si el campo nuevo tiene mayor confianza o el existente está vacío
 *
 * @param {Object} camposExistentes - Campos actuales de DatosTemp
 * @param {Object} camposNuevos - Campos extraídos por fieldExtractor
 * @param {string} tipoReporte - Tipo de reporte para validación
 * @returns {Object} - { camposMergeados, camposActualizados, erroresValidacion }
 */
function mergeCampos(camposExistentes, camposNuevos, tipoReporte) {
  const camposMergeados = { ...camposExistentes };
  const camposActualizados = [];
  const erroresValidacion = [];

  for (const [nombreCampo, campoNuevo] of Object.entries(camposNuevos)) {
    // Ignorar campos internos o metadatos
    if (nombreCampo.endsWith('_ai') || nombreCampo === 'problemaPotencial') {
      continue;
    }

    const campoExistente = camposMergeados[nombreCampo] || {
      valor: null,
      completo: false,
      fuente: null,
      confianza: 0,
    };

    // Validar el campo nuevo
    const validacion = validarCampo(tipoReporte, nombreCampo, campoNuevo.valor);

    if (!validacion.valido) {
      erroresValidacion.push({
        campo: nombreCampo,
        valor: campoNuevo.valor,
        error: validacion.error,
      });
      continue;
    }

    // Decidir si actualizar: nuevo tiene mayor confianza O existente está vacío
    const debeActualizar =
      !campoExistente.valor || campoNuevo.confianza > (campoExistente.confianza || 0);

    if (debeActualizar) {
      camposMergeados[nombreCampo] = {
        valor: validacion.valorLimpio,
        completo: campoNuevo.confianza >= UMBRAL_CONFIANZA,
        fuente: campoNuevo.fuente,
        confianza: campoNuevo.confianza,
        opcional: campoExistente.opcional,
      };

      camposActualizados.push(nombreCampo);
    }
  }

  // Manejar problemaPotencial si no hay problema definido
  if (camposNuevos.problemaPotencial && !camposMergeados.problema?.valor) {
    camposMergeados.problema = {
      valor: camposNuevos.problemaPotencial.valor,
      completo: false, // Necesita confirmación
      fuente: 'inferido',
      confianza: camposNuevos.problemaPotencial.confianza,
      requiereConfirmacion: true,
    };
    camposActualizados.push('problema (potencial)');
  }

  return {
    camposMergeados,
    camposActualizados,
    erroresValidacion,
  };
}

// ==============================================================
// ANÁLISIS DE COMPLETITUD
// ==============================================================

/**
 * Obtiene lista de campos faltantes (requeridos y no completos)
 * @param {Object} camposRequeridos - Campos del DatosTemp
 * @param {string} tipoReporte - Tipo de reporte
 * @returns {Array} - Lista de campos faltantes ordenados por prioridad
 */
function getCamposFaltantes(camposRequeridos, tipoReporte) {
  const definicion = CAMPOS_POR_TIPO[tipoReporte];
  if (!definicion) {
    return [];
  }

  const faltantes = [];

  for (const [nombreCampo, config] of Object.entries(definicion)) {
    if (!config.requerido) {
      continue;
    }

    const campo = camposRequeridos[nombreCampo];
    if (!campo || !campo.completo) {
      faltantes.push({
        nombre: nombreCampo,
        orden: config.orden,
        mensaje: config.mensaje,
        descripcion: config.descripcion,
        valorActual: campo?.valor || null,
        requiereConfirmacion: campo?.requiereConfirmacion || false,
      });
    }
  }

  // Ordenar por prioridad
  faltantes.sort((a, b) => a.orden - b.orden);

  return faltantes;
}

/**
 * Obtiene el siguiente campo a solicitar al usuario
 * @param {Object} camposRequeridos - Campos del DatosTemp
 * @param {string} tipoReporte - Tipo de reporte
 * @returns {Object|null} - Siguiente campo faltante o null si está completo
 */
function getSiguienteCampoFaltante(camposRequeridos, tipoReporte) {
  const faltantes = getCamposFaltantes(camposRequeridos, tipoReporte);
  return faltantes.length > 0 ? faltantes[0] : null;
}

/**
 * Calcula el porcentaje de completitud
 * @param {Object} camposRequeridos - Campos del DatosTemp
 * @param {string} tipoReporte - Tipo de reporte
 * @returns {Object} - { porcentaje, completados, total }
 */
function calcularCompletitud(camposRequeridos, tipoReporte) {
  const definicion = CAMPOS_POR_TIPO[tipoReporte];
  if (!definicion) {
    return { porcentaje: 0, completados: 0, total: 0 };
  }

  const camposRequeridosDef = Object.entries(definicion).filter(([_, config]) => config.requerido);
  const total = camposRequeridosDef.length;

  let completados = 0;
  for (const [nombreCampo, _] of camposRequeridosDef) {
    if (camposRequeridos[nombreCampo]?.completo) {
      completados++;
    }
  }

  return {
    porcentaje: total > 0 ? Math.round((completados / total) * 100) : 0,
    completados,
    total,
  };
}

/**
 * Verifica si todos los campos requeridos están completos
 * @param {Object} camposRequeridos - Campos del DatosTemp
 * @param {string} tipoReporte - Tipo de reporte
 * @returns {boolean} - true si el formulario está listo para crear reporte
 */
function estaCompleto(camposRequeridos, tipoReporte) {
  const { porcentaje } = calcularCompletitud(camposRequeridos, tipoReporte);
  return porcentaje === 100;
}

// ==============================================================
// UTILIDADES PARA SESIÓN
// ==============================================================

/**
 * Extrae camposRequeridos del DatosTemp de una sesión
 * @param {Object|string} datosTemp - DatosTemp de la sesión (puede ser string JSON)
 * @returns {Object} - { tipoReporte, camposRequeridos, equipoIdTemp, datosEquipo }
 */
function parseDatosTemp(datosTemp) {
  const datos = typeof datosTemp === 'string' ? safeParseJSON(datosTemp, {}) : datosTemp || {};

  // Retornar TODOS los campos del objeto original, con valores por defecto para campos críticos
  // Esto preserva campos de AI Vision como: problemaTemp, codigoSAPVehiculo, numeroEmpleado, etc.
  return {
    ...datos, // Preservar TODOS los campos (incluyendo AI Vision)
    // Sobrescribir con valores por defecto solo los campos críticos que pueden ser undefined
    tipoReporte: datos.tipoReporte || null,
    camposRequeridos: datos.camposRequeridos || {},
    equipoIdTemp: datos.equipoIdTemp || null,
    datosEquipo: datos.datosEquipo || null,
    version: datos.version || '1.0',
    // IMPORTANTE: Incluir campoSolicitado para prioridad contextual en fieldExtractor
    campoSolicitado: datos.campoSolicitado || null,
  };
}

/**
 * Actualiza DatosTemp con nuevos campos extraídos
 * @param {Object|string} datosTemp - DatosTemp actual
 * @param {Object} camposNuevos - Campos extraídos por fieldExtractor
 * @param {Object} options - Opciones adicionales
 * @returns {Object} - { datosActualizados, resumenActualizacion }
 */
function actualizarDatosTemp(datosTemp, camposNuevos, options = {}) {
  const { equipoData = null, context = null } = options;
  const datos = parseDatosTemp(datosTemp);

  if (!datos.tipoReporte) {
    logger.warn('[FieldManager] DatosTemp sin tipoReporte definido');
    return {
      datosActualizados: datos,
      resumenActualizacion: { camposActualizados: [], errores: ['Sin tipoReporte'] },
    };
  }

  // Mergear campos
  const { camposMergeados, camposActualizados, erroresValidacion } = mergeCampos(
    datos.camposRequeridos,
    camposNuevos,
    datos.tipoReporte
  );

  // Actualizar datos de equipo si se proporcionan
  if (equipoData) {
    datos.equipoIdTemp = equipoData.EquipoId || equipoData.equipoId || datos.equipoIdTemp;
    datos.datosEquipo = equipoData;
  }

  datos.camposRequeridos = camposMergeados;
  datos.ultimaActualizacion = new Date().toISOString();

  // Calcular completitud
  const completitud = calcularCompletitud(camposMergeados, datos.tipoReporte);

  if (context) {
    context.log?.info('[FieldManager] DatosTemp actualizado', {
      tipoReporte: datos.tipoReporte,
      camposActualizados,
      completitud: `${completitud.porcentaje}%`,
      errores: erroresValidacion.length,
    });
  }

  return {
    datosActualizados: datos,
    resumenActualizacion: {
      camposActualizados,
      errores: erroresValidacion,
      completitud,
      estaCompleto: completitud.porcentaje === 100,
    },
  };
}

/**
 * Confirma un campo como correcto (por respuesta del usuario)
 * @param {Object} camposRequeridos - Campos del DatosTemp
 * @param {string} nombreCampo - Campo a confirmar
 * @returns {Object} - Campos actualizados
 */
function confirmarCampo(camposRequeridos, nombreCampo) {
  if (camposRequeridos[nombreCampo]) {
    camposRequeridos[nombreCampo].completo = true;
    camposRequeridos[nombreCampo].fuente = 'usuario_confirmado';
    camposRequeridos[nombreCampo].confianza = 100;
    delete camposRequeridos[nombreCampo].requiereConfirmacion;
  }
  return camposRequeridos;
}

/**
 * Actualiza un campo específico directamente
 * @param {Object} camposRequeridos - Campos del DatosTemp
 * @param {string} nombreCampo - Campo a actualizar
 * @param {string} valor - Nuevo valor
 * @param {string} tipoReporte - Tipo de reporte
 * @returns {Object} - { campos, exito, error }
 */
function setCampo(camposRequeridos, nombreCampo, valor, tipoReporte) {
  const validacion = validarCampo(tipoReporte, nombreCampo, valor);

  if (!validacion.valido) {
    return {
      campos: camposRequeridos,
      exito: false,
      error: validacion.error,
    };
  }

  camposRequeridos[nombreCampo] = {
    valor: validacion.valorLimpio,
    completo: true,
    fuente: 'usuario_directo',
    confianza: 100,
    opcional: camposRequeridos[nombreCampo]?.opcional || false,
  };

  return {
    campos: camposRequeridos,
    exito: true,
    error: null,
  };
}

// ==============================================================
// EXPORTS
// ==============================================================

module.exports = {
  // Constantes
  CAMPOS_POR_TIPO,
  UMBRAL_CONFIANZA,

  // Inicialización
  inicializarCampos,
  crearDatosTemp,

  // Validación y Merge
  validarCampo,
  mergeCampos,

  // Análisis de completitud
  getCamposFaltantes,
  getSiguienteCampoFaltante,
  calcularCompletitud,
  estaCompleto,

  // Utilidades de sesión
  parseDatosTemp,
  actualizarDatosTemp,
  confirmarCampo,
  setCampo,
};
