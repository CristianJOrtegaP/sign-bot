/**
 * AC FIXBOT - Inicialización de Flujos Flexibles
 * @module flows/modules/flowInit
 */

const whatsapp = require('../../../../core/services/external/whatsappService');
const db = require('../../../../core/services/storage/databaseService');
const MSG = require('../../../constants/messages');
const { logger } = require('../../../../core/services/infrastructure/errorHandler');
const {
  ESTADO,
  TIPO_REPORTE,
  ORIGEN_ACCION,
  TIPO_MENSAJE,
  TIPO_CONTENIDO,
} = require('../../../constants/sessionStates');
const fieldExtractor = require('../../../services/fieldExtractor');
const fieldManager = require('../../../services/fieldManager');
const { ESTADO_FLEXIBLE } = require('./constants');
const { solicitarSiguienteCampo } = require('./fieldHandlers');

/**
 * Inicia un flujo flexible de reporte
 * @param {string} from - Teléfono del usuario
 * @param {string} tipoReporte - REFRIGERADOR | VEHICULO
 * @param {Object} datosIniciales - Datos ya extraídos (opcional)
 * @param {Object} context - Contexto de Azure Function
 */
async function iniciarFlujo(from, tipoReporte, datosIniciales = {}, context = null) {
  const estadoFlexible = ESTADO_FLEXIBLE[tipoReporte];

  if (!estadoFlexible) {
    logger.error(`[FlexibleFlow] Tipo de reporte desconocido: ${tipoReporte}`);
    throw new Error(`Tipo de reporte no soportado: ${tipoReporte}`);
  }

  // Crear DatosTemp con estructura de campos requeridos
  const datosTemp = fieldManager.crearDatosTemp(tipoReporte);
  let resumenActualizacion = { estaCompleto: false };

  // Si vienen datos iniciales (de detección de intención), mergearlos
  if (datosIniciales && Object.keys(datosIniciales).length > 0) {
    const resultado = fieldManager.actualizarDatosTemp(datosTemp, datosIniciales, { context });
    Object.assign(datosTemp, resultado.datosActualizados);
    resumenActualizacion = resultado.resumenActualizacion;
  }

  // Si es REFRIGERADOR y viene código SAP, validarlo contra la BD
  if (
    tipoReporte === TIPO_REPORTE.REFRIGERADOR &&
    datosIniciales.codigoSAP?.valor &&
    !datosTemp.equipoIdTemp
  ) {
    const sapValor = datosIniciales.codigoSAP.valor;
    const equipo = await db.getEquipoBySAP(sapValor);

    if (equipo) {
      datosTemp.equipoIdTemp = equipo.EquipoId;
      datosTemp.datosEquipo = {
        EquipoId: equipo.EquipoId,
        CodigoSAP: equipo.CodigoSAP,
        Modelo: equipo.Modelo,
        Marca: equipo.Marca,
        NombreCliente: equipo.NombreCliente,
        Ubicacion: equipo.Ubicacion,
      };

      if (context?.log) {
        context.log(`[FlexibleFlow] Equipo encontrado en inicio: ${equipo.EquipoId}`);
      }

      // Cambiar a estado de confirmación para pedir al usuario que confirme
      await db.updateSession(
        from,
        ESTADO.REFRIGERADOR_CONFIRMAR_EQUIPO,
        datosTemp,
        equipo.EquipoId,
        ORIGEN_ACCION.BOT,
        `Código SAP inicial: ${sapValor}, esperando confirmación`
      );

      // Pedir confirmación al usuario
      const mensajeConfirmacion =
        `✅ *Equipo encontrado:*\n\n` +
        `• *SAP:* ${equipo.CodigoSAP}\n` +
        `• *Modelo:* ${equipo.Modelo}\n` +
        `• *Marca:* ${equipo.Marca || 'N/A'}\n` +
        `• *Cliente:* ${equipo.NombreCliente}\n` +
        `• *Ubicación:* ${equipo.Ubicacion || 'N/A'}\n\n` +
        `¿Es correcto este equipo?`;

      await whatsapp.sendInteractiveMessage(from, '🔍 Confirmar Equipo', mensajeConfirmacion, [
        { id: 'btn_confirmar_equipo', title: '✅ Sí, es correcto' },
        { id: 'btn_rechazar_equipo', title: '❌ No, es otro' },
      ]);

      await db.saveMessage(from, TIPO_MENSAJE.BOT, mensajeConfirmacion, TIPO_CONTENIDO.TEXTO);

      if (context?.log) {
        context.log(
          `[FlexibleFlow] Flujo iniciado: ${tipoReporte}, esperando confirmación de equipo`
        );
      }
      return; // Esperar confirmación del usuario
    }
    // SAP no encontrado, eliminar el valor inválido
    if (context?.log) {
      context.log(`[FlexibleFlow] SAP no encontrado: ${sapValor}`);
    }
    delete datosTemp.camposRequeridos.codigoSAP;
    resumenActualizacion.estaCompleto = false;

    // Notificar al usuario
    await whatsapp.sendText(from, MSG.REFRIGERADOR.equipoNoEncontrado(sapValor));
    await db.saveMessage(from, TIPO_MENSAJE.BOT, 'Equipo no encontrado', TIPO_CONTENIDO.TEXTO);
  }

  // Actualizar sesión al estado flexible
  await db.updateSession(
    from,
    estadoFlexible,
    datosTemp,
    datosTemp.equipoIdTemp || null,
    ORIGEN_ACCION.BOT,
    `Flujo flexible ${tipoReporte} iniciado`
  );

  if (context?.log) {
    context.log(`[FlexibleFlow] Flujo iniciado: ${tipoReporte}, estado: ${estadoFlexible}`);
  }

  // Enviar mensaje inicial pidiendo el primer campo faltante
  await solicitarSiguienteCampo(from, datosTemp, context);
}

/**
 * Inicia flujo con datos pre-extraídos de un mensaje inicial
 * @param {string} from - Teléfono del usuario
 * @param {string} tipoReporte - REFRIGERADOR | VEHICULO
 * @param {string} mensajeOriginal - Mensaje original del usuario
 * @param {Object} context - Contexto de Azure Function
 */
async function iniciarFlujoConMensaje(from, tipoReporte, mensajeOriginal, context = null) {
  // Extraer todos los campos posibles del mensaje inicial
  const { campos } = await fieldExtractor.extractAllFields(mensajeOriginal, {
    tipoReporte,
    useAI: true,
    context,
  });

  if (context?.log) {
    context.log(
      `[FlexibleFlow] Campos extraídos de mensaje inicial: ${tipoReporte}, campos: ${Object.keys(campos).join(', ')}`
    );
  }

  await iniciarFlujo(from, tipoReporte, campos, context);
}

module.exports = {
  iniciarFlujo,
  iniciarFlujoConMensaje,
};
