/**
 * AC FIXBOT - Manejadores de reportes e intenciones
 * Funciones para procesar intenciones específicas
 */

const whatsapp = require('../../../../core/services/external/whatsappService');
const db = require('../../../../core/services/storage/databaseService');
const MSG = require('../../../constants/messages');
const FlowManager = require('../../flows/FlowManager');
const { ESTADO, ORIGEN_ACCION } = require('../../../constants/sessionStates');

/**
 * Envía mensaje de bienvenida con opciones de tipo de reporte
 * Usa sendAndSaveInteractive para guardar en BD automáticamente
 */
async function sendWelcome(from) {
  await whatsapp.sendAndSaveInteractive(from, MSG.GENERAL.WELCOME_TITLE, MSG.GENERAL.WELCOME_BODY, [
    MSG.BUTTONS.TIPO_REFRIGERADOR,
    MSG.BUTTONS.TIPO_VEHICULO,
    MSG.BUTTONS.CANCELAR,
  ]);
}

/**
 * Maneja la intención de reportar falla con datos estructurados
 */
async function handleReportarFalla(from, session, detectedIntent, context) {
  // Verificar si tenemos datos estructurados (de cualquier método de extracción)
  const metodosConExtraccion = [
    'ai_extract',
    'gemini_extract',
    'regex+gemini_extract',
    'regex+ai_extract_all',
  ];
  const hasStructuredData =
    metodosConExtraccion.includes(detectedIntent.metodo) &&
    detectedIntent.tipo_equipo &&
    detectedIntent.tipo_equipo !== 'OTRO';

  // Si NO tenemos tipo de equipo pero SÍ tenemos otros datos (problema, SAP, empleado),
  // guardarlos en datosTemp y mostrar los botones
  if (!hasStructuredData) {
    const tieneDatos =
      detectedIntent.problema ||
      detectedIntent.codigo_sap ||
      detectedIntent.numero_empleado ||
      detectedIntent.datos_extraidos?.problema ||
      detectedIntent.datos_extraidos?.codigo_sap ||
      detectedIntent.datos_extraidos?.numero_empleado;

    if (tieneDatos) {
      // Guardar los datos extraídos en datosTemp para usarlos después
      const datosTemp = {
        problema: detectedIntent.problema || detectedIntent.datos_extraidos?.problema,
        codigoSAP: detectedIntent.codigo_sap || detectedIntent.datos_extraidos?.codigo_sap,
        numeroEmpleado:
          detectedIntent.numero_empleado || detectedIntent.datos_extraidos?.numero_empleado,
      };

      await db.updateSession(
        from,
        ESTADO.INICIO,
        datosTemp,
        null,
        ORIGEN_ACCION.BOT,
        'Datos pre-extraídos guardados'
      );

      context.log(`💾 Datos guardados en INICIO: ${JSON.stringify(datosTemp)}`);
    }

    await sendWelcome(from);
    return;
  }

  // Preparar objeto con todos los datos extraídos
  const datosExtraidos = {
    problema: detectedIntent.problema,
    codigo_sap: detectedIntent.codigo_sap || detectedIntent.datos_extraidos?.codigo_sap,
    numero_empleado:
      detectedIntent.numero_empleado || detectedIntent.datos_extraidos?.numero_empleado,
  };

  context.log(
    `📦 Datos para flujo: tipo=${detectedIntent.tipo_equipo}, datos=${JSON.stringify(datosExtraidos)}`
  );
  const isFirstMessage = session.Estado === 'INICIO';

  await FlowManager.iniciarFlujoConDatos(
    from,
    detectedIntent.tipo_equipo,
    datosExtraidos,
    isFirstMessage,
    context
  );
}

/**
 * Maneja la selección de tipo de equipo (refrigerador o vehículo)
 * @param {Function} handleButton - Referencia a la función handleButton para llamadas recursivas
 */
async function handleTipoEquipo(from, text, detectedIntent, tipo, context, handleButton) {
  context.log(`Usuario ${from} seleccionó ${tipo} vía texto: "${text}"`);

  if (detectedIntent.confianza < 0.7) {
    // Baja confianza: pedir confirmación
    const confirmTitle =
      tipo === 'REFRIGERADOR'
        ? MSG.DETECCION.CONFIRM_REFRIGERADOR_TITLE
        : MSG.DETECCION.CONFIRM_VEHICULO_TITLE;
    const confirmBody =
      tipo === 'REFRIGERADOR'
        ? MSG.DETECCION.confirmRefrigerador(text)
        : MSG.DETECCION.confirmVehiculo(text);
    const buttons =
      tipo === 'REFRIGERADOR'
        ? [MSG.BUTTONS.SI_REFRIGERADOR, MSG.BUTTONS.NO_ES_VEHICULO]
        : [MSG.BUTTONS.SI_VEHICULO, MSG.BUTTONS.NO_ES_REFRIGERADOR];

    await whatsapp.sendInteractiveMessage(from, confirmTitle, confirmBody, buttons);
  } else {
    // Alta confianza: iniciar flujo directamente
    const buttonId = tipo === 'REFRIGERADOR' ? 'btn_tipo_refrigerador' : 'btn_tipo_vehiculo';
    await handleButton(from, buttonId, null, context);
  }
}

/**
 * Maneja intenciones no reconocidas
 */
async function handleDefaultIntent(from, detectedIntent) {
  if (detectedIntent.metodo === 'gemini_interpret' && detectedIntent.confianza < 0.5) {
    await whatsapp.sendText(from, MSG.VALIDACION.NO_ENTIENDO);
  } else {
    await sendWelcome(from);
  }
}

module.exports = {
  sendWelcome,
  handleReportarFalla,
  handleTipoEquipo,
  handleDefaultIntent,
};
