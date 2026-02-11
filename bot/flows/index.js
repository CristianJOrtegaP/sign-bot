/**
 * SIGN BOT - Registro de Flujos
 * Configuracion central de flujos activos
 *
 * Para agregar un nuevo flujo:
 * 1. Crear el archivo en bot/flows/miFlujo.js
 * 2. Importarlo aqui
 * 3. Agregarlo a FLUJOS_DISPONIBLES
 * 4. Habilitarlo en FLUJOS_HABILITADOS
 *
 * @module bot/flows
 */

const { registry } = require('../../core/flowEngine');

// ============================================================
// IMPORTAR FLUJOS DISPONIBLES
// ============================================================

const firmaFlow = require('./firmaFlow');
const consultaDocumentosFlow = require('./consultaDocumentosFlow');

// ============================================================
// CONFIGURACION: QUE FLUJOS ESTAN HABILITADOS
// ============================================================

const FLUJOS_HABILITADOS = {
  FIRMA: true,
  CONSULTA_DOCUMENTOS: true,
};

// ============================================================
// REGISTRO DE FLUJOS
// ============================================================

/**
 * Lista de todos los flujos disponibles
 */
const FLUJOS_DISPONIBLES = {
  FIRMA: firmaFlow,
  CONSULTA_DOCUMENTOS: consultaDocumentosFlow,
};

/**
 * Inicializa el registro de flujos
 * Llamar al inicio de la aplicacion
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
 * Verifica si un flujo esta habilitado
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
  // Configuracion
  FLUJOS_HABILITADOS,
  FLUJOS_DISPONIBLES,

  // Funciones
  inicializarFlujos,
  estaHabilitado,
  listarHabilitados,

  // Re-exportar registry para acceso directo
  registry,

  // Flujos individuales
  firmaFlow,
  consultaDocumentosFlow,
};
