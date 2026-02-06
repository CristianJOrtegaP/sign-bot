/**
 * AC FIXBOT - Registro de Flujos
 * Configuración central de qué flujos están activos
 *
 * Para agregar un nuevo flujo:
 * 1. Crear el archivo en bot/flows/miFlujo.js
 * 2. Importarlo aquí
 * 3. Agregarlo a FLUJOS_DISPONIBLES
 * 4. Habilitarlo en FLUJOS_HABILITADOS
 *
 * Para clonar el bot y remover flujos:
 * 1. Cambiar FLUJOS_HABILITADOS[flujo] = false
 * 2. Opcionalmente eliminar el archivo del flujo
 *
 * @module bot/flows
 */

const { registry } = require('../../core/flowEngine');

// ============================================================
// IMPORTAR FLUJOS DISPONIBLES
// ============================================================

const consultaFlow = require('./consultaFlow');
// const encuestaFlow = require('./encuestaFlow');  // TODO: Migrar
// const reporteFlow = require('./reporteFlow');    // TODO: Migrar

// ============================================================
// CONFIGURACIÓN: QUÉ FLUJOS ESTÁN HABILITADOS
// Cambiar a false para deshabilitar un flujo
// ============================================================

/**
 * CONFIGURACIÓN: QUÉ FLUJOS ESTÁN HABILITADOS
 * Cambiar a true para activar un flujo migrado al FlowEngine
 *
 * NOTA: Mientras CONSULTA esté en false, se usa el sistema legacy
 * Activar cuando los tests se actualicen para el nuevo sistema
 */
const FLUJOS_HABILITADOS = {
  CONSULTA: false, // TODO: Activar cuando los tests se actualicen
  // ENCUESTA: true,   // TODO: Migrar
  // REPORTE: true,    // TODO: Migrar (refrigerador + vehículo)
};

// ============================================================
// REGISTRO DE FLUJOS
// ============================================================

/**
 * Lista de todos los flujos disponibles
 * Agregar nuevos flujos aquí
 */
const FLUJOS_DISPONIBLES = {
  CONSULTA: consultaFlow,
  // ENCUESTA: encuestaFlow,  // TODO
  // REPORTE: reporteFlow,    // TODO
};

/**
 * Inicializa el registro de flujos
 * Llamar al inicio de la aplicación
 */
function inicializarFlujos() {
  let registrados = 0;

  for (const [nombre, flujo] of Object.entries(FLUJOS_DISPONIBLES)) {
    if (FLUJOS_HABILITADOS[nombre]) {
      registry.registrar(flujo);
      registrados++;
    }
  }

  const stats = registry.getStats();
  console.log(`[Flows] Inicializados ${registrados} flujos:`, {
    flujos: stats.flujos,
    estados: stats.totalEstados,
    botones: stats.totalBotones,
  });

  return stats;
}

/**
 * Verifica si un flujo está habilitado
 * @param {string} nombre - Nombre del flujo
 * @returns {boolean}
 */
function estaHabilitado(nombre) {
  return FLUJOS_HABILITADOS[nombre] === true;
}

/**
 * Lista flujos habilitados
 * @returns {string[]}
 */
function listarHabilitados() {
  return Object.entries(FLUJOS_HABILITADOS)
    .filter(([_, habilitado]) => habilitado)
    .map(([nombre]) => nombre);
}

module.exports = {
  // Configuración
  FLUJOS_HABILITADOS,
  FLUJOS_DISPONIBLES,

  // Funciones
  inicializarFlujos,
  estaHabilitado,
  listarHabilitados,

  // Re-exportar registry para acceso directo
  registry,

  // Flujos individuales (para compatibilidad hacia atrás)
  consultaFlow,
};
