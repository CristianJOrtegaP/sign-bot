/**
 * SIGN BOT - Flujo de Consulta de Documentos
 * Maneja consultas iniciadas por el usuario sobre sus documentos
 *
 * Entry: Usuario escribe "mis documentos", "documentos", etc.
 * States: CONSULTA_DOCUMENTOS, CONSULTA_DETALLE
 *
 * Flujo:
 * 1. Usuario pregunta por documentos -> listar documentos
 * 2. Usuario selecciona documento (por numero) -> mostrar detalle
 * 3. Usuario puede volver o terminar
 *
 * @module bot/flows/consultaDocumentosFlow
 */

const { ESTADO } = require('../constants/sessionStates');
const { CONSULTA_DOCS, ERRORES } = require('../constants/messages');
const db = require('../../core/services/storage/databaseService');

/**
 * Handler: Usuario inicia consulta de documentos
 * Lista los documentos del usuario
 *
 * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx - Contexto del flujo
 * @param {string} _mensaje - Mensaje del usuario (no utilizado)
 * @param {Object} session - Sesion actual
 */
async function handleConsultaIniciada(ctx, _mensaje, _session) {
  const telefono = ctx.from;

  try {
    // Consultar documentos del usuario
    const documentos = await db.getDocumentosFirmaPorTelefono(telefono);

    if (!documentos || documentos.length === 0) {
      // Sin documentos pendientes
      await ctx.responder(CONSULTA_DOCS.SIN_DOCUMENTOS);
      await ctx.finalizar('Consulta sin documentos');
      return;
    }

    // Listar documentos
    const listaMsg = CONSULTA_DOCS.listaDocumentos(documentos);
    await ctx.responder(listaMsg);

    // Guardar lista de documentos en DatosTemp para referencia por indice
    await ctx.cambiarEstado(ESTADO.CONSULTA_DOCUMENTOS, {
      documentos: documentos.map((doc) => ({
        DocumentoFirmaId: doc.DocumentoFirmaId,
        DocumentoNombre: doc.DocumentoNombre || doc.SapDocumentId,
        TipoDocumento: doc.TipoDocumento,
        EstadoDocumento: doc.EstadoDocumento,
        FechaCreacion: doc.FechaCreacion,
        MotivoRechazo: doc.MotivoRechazo,
        SigningUrl: doc.SigningUrl,
        SapDocumentId: doc.SapDocumentId,
      })),
    });
  } catch (error) {
    ctx.registrarError('Error consultando documentos', error);
    await ctx.responder(ERRORES.GENERICO);
    await ctx.finalizar('Error en consulta de documentos');
  }
}

/**
 * Handler: Usuario selecciona un documento de la lista (por numero)
 * Muestra el detalle del documento seleccionado
 *
 * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx - Contexto del flujo
 * @param {string} seleccion - Texto del usuario (numero de seleccion)
 * @param {Object} session - Sesion actual
 */
async function handleSeleccionDocumento(ctx, seleccion, session) {
  const datos = ctx.getDatos();
  const documentos = datos.documentos;

  if (!documentos || documentos.length === 0) {
    await ctx.responder(CONSULTA_DOCS.SIN_DOCUMENTOS);
    await ctx.finalizar('Lista de documentos vacia');
    return;
  }

  // Intentar parsear como "volver"
  const textoLimpio = seleccion.trim().toLowerCase();
  if (textoLimpio === 'volver' || textoLimpio === 'atras' || textoLimpio === 'regresar') {
    // Re-listar documentos
    await handleConsultaIniciada(ctx, null, session);
    return;
  }

  // Parsear seleccion como numero de indice
  const indice = parseInt(seleccion.trim(), 10);

  if (isNaN(indice) || indice < 1 || indice > documentos.length) {
    await ctx.responder(CONSULTA_DOCS.DOCUMENTO_NO_ENCONTRADO);
    return; // Mantener en CONSULTA_DOCUMENTOS
  }

  const documento = documentos[indice - 1];

  // Mostrar detalle del documento
  const detalleMsg = CONSULTA_DOCS.detalleDocumento(documento);
  await ctx.responder(detalleMsg);

  // Cambiar a estado de detalle
  await ctx.cambiarEstado(ESTADO.CONSULTA_DETALLE, {
    ...datos,
    documentoSeleccionado: indice - 1,
  });
}

/**
 * Handler: Usuario esta en detalle de documento
 * Puede volver a la lista o seleccionar otro documento
 *
 * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx - Contexto del flujo
 * @param {string} texto - Texto del usuario
 * @param {Object} session - Sesion actual
 */
async function handleDetalleDocumento(ctx, texto, session) {
  const textoLimpio = texto.trim().toLowerCase();

  // Si el usuario escribe "volver", re-listar documentos
  if (textoLimpio === 'volver' || textoLimpio === 'atras' || textoLimpio === 'regresar') {
    await handleConsultaIniciada(ctx, null, session);
    return;
  }

  // Si el usuario escribe un numero, mostrar ese documento
  const indice = parseInt(texto.trim(), 10);
  if (!isNaN(indice)) {
    await handleSeleccionDocumento(ctx, texto, session);
    return;
  }

  // Texto no reconocido - dar indicaciones
  await ctx.responder(
    'Escribe el *numero* del documento para ver detalles,\n' +
      'o *"volver"* para regresar a la lista.'
  );
}

/**
 * Definicion del flujo para el StaticFlowRegistry
 */
module.exports = {
  nombre: 'CONSULTA_DOCUMENTOS',

  // Estados que maneja este flujo
  estados: [ESTADO.CONSULTA_DOCUMENTOS, ESTADO.CONSULTA_DETALLE],

  // Mapeo de botones -> handlers
  botones: {
    btn_ver_documentos: 'handleConsultaIniciada',
    btn_volver: 'handleConsultaIniciada',
  },

  // Handlers por estado
  handlers: {
    [ESTADO.CONSULTA_DOCUMENTOS]: 'handleSeleccionDocumento',
    [ESTADO.CONSULTA_DETALLE]: 'handleDetalleDocumento',
  },

  // Metodos del flujo
  handleConsultaIniciada,
  handleSeleccionDocumento,
  handleDetalleDocumento,
};
