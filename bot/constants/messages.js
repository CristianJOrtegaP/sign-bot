/**
 * AC FIXBOT - Templates de Mensajes
 * Optimizado para usuarios adultos mayores - Mensajes cortos y claros
 */

// ============================================
// MENSAJES GENERALES
// ============================================

const GENERAL = {
  BOT_NAME: 'AC FixBot',
  COMPANY: 'Arca Continental',

  GREETING: '¡Hola! Soy *AC FixBot*',

  WELCOME_TITLE: '¡Hola! Soy AC FixBot',
  WELCOME_BODY: '¿Qué equipo necesitas reportar?',

  GOODBYE: '¡Hasta pronto! Escríbeme cuando necesites ayuda.',

  GOODBYE_THANKS: '¡Gracias! Hasta pronto.',

  THANKS_FOOTER: '¡Gracias!',

  CANCELLED: '❌ Reporte cancelado.\n\nEscríbeme cuando necesites ayuda.',
};

// ============================================
// MENSAJES DE RATE LIMITING / SPAM
// ============================================

const RATE_LIMIT = {
  SPAM_WARNING: '⚠️ Espera un momento antes de enviar más mensajes.',
};

// ============================================
// MENSAJES DE REFRIGERADOR
// ============================================

const REFRIGERADOR = {
  TITLE: '❄️ Refrigerador',

  REQUEST_SAP:
    '❄️ *Refrigerador*\n\n' +
    'Ingresa el *Número SAP* del refrigerador.\n\n' +
    'Está en la etiqueta del equipo.\n\n' +
    'También puedes enviar *foto del código de barras*.',

  REQUEST_SAP_BODY:
    'Ingresa el *Número SAP* del refrigerador.\n\n' +
    'Está en la etiqueta del equipo.\n\n' +
    'También puedes enviar *foto del código de barras*.',

  CONFIRM_TITLE: '📋 Refrigerador Encontrado',

  CONFIRMED:
    '✅ *Refrigerador confirmado*\n\n' +
    'Describe el problema:\n' +
    '_Ejemplo: No enfría, gotea, hace ruido_',

  CONFIRMED_TITLE: '✅ Confirmado',

  CONFIRMED_BODY: 'Describe el problema:\n' + '_Ejemplo: No enfría, gotea, hace ruido_',

  REQUEST_CORRECTION: 'Ingresa el número SAP correcto:',

  REQUEST_CORRECTION_TITLE: '🔄 Corregir',

  REQUEST_CORRECTION_BODY: 'Ingresa el número SAP correcto:',

  SAP_TIP: 'El SAP está en la etiqueta del equipo.',

  /**
   * Genera mensaje de equipo encontrado con sus datos
   */
  equipoInfo: (equipo) =>
    `*SAP:* ${equipo.CodigoSAP}\n` +
    `*Modelo:* ${equipo.Modelo}\n` +
    `*Cliente:* ${equipo.NombreCliente}\n\n` +
    '¿Es correcto?',

  /**
   * Genera mensaje de confirmación de reporte creado
   */
  reporteCreado: (numeroTicket, equipo, descripcion) =>
    '✅ *Reporte creado*\n\n' +
    `*Ticket:* ${numeroTicket}\n` +
    `*Equipo:* ${equipo.Modelo} (${equipo.CodigoSAP})\n` +
    `*Problema:* ${descripcion}\n\n` +
    'Un técnico te contactará pronto.\n\n' +
    '*Guarda tu número de ticket.*',

  /**
   * Genera mensaje de equipo no encontrado
   */
  equipoNoEncontrado: (codigoSAP) =>
    `❌ No encontré el código *${codigoSAP}*\n\n` + 'Verifica el número e intenta de nuevo.',
};

// ============================================
// MENSAJES DE VEHÍCULO
// ============================================

const VEHICULO = {
  TITLE: '🚗 Vehículo',

  REQUEST_EMPLEADO: '🚗 *Vehículo*\n\n' + 'Ingresa tu *Número de Empleado*:',

  REQUEST_EMPLEADO_BODY: 'Ingresa tu *Número de Empleado*:',

  EMPLEADO_REGISTERED: '✅ Empleado registrado.\n\n' + 'Ahora ingresa el *SAP del vehículo*:',

  EMPLEADO_REGISTERED_TITLE: '✅ Registrado',

  EMPLEADO_REGISTERED_BODY: 'Ahora ingresa el *SAP del vehículo*:',

  VEHICULO_REGISTERED:
    '✅ Vehículo registrado.\n\n' +
    'Describe el problema:\n' +
    '_Ejemplo: No enciende, hace ruido, frenos_',

  VEHICULO_REGISTERED_TITLE: '✅ Registrado',

  VEHICULO_REGISTERED_BODY:
    'Describe el problema:\n' + '_Ejemplo: No enciende, hace ruido, frenos_',

  /**
   * Genera mensaje de confirmación de reporte de vehículo creado
   * @param {string} numeroTicket - Número de ticket generado
   * @param {string} codigoSAPVehiculo - Código SAP del vehículo
   * @param {string} numeroEmpleado - Número de empleado
   * @param {string} descripcion - Descripción del problema
   * @param {string|null} ubicacion - Dirección o coordenadas
   * @param {Object|null} tiempoLlegada - Info de tiempo de llegada
   * @param {number} tiempoLlegada.tiempoEstimadoMin - Tiempo estimado en minutos
   * @param {number} tiempoLlegada.distanciaKm - Distancia en km
   * @param {string} tiempoLlegada.centroNombre - Nombre del centro de servicio
   */
  reporteCreado: (
    numeroTicket,
    codigoSAPVehiculo,
    numeroEmpleado,
    descripcion,
    ubicacion = null,
    tiempoLlegada = null
  ) => {
    let msg =
      '✅ *Reporte creado*\n\n' +
      `*Ticket:* ${numeroTicket}\n` +
      `*Vehículo:* ${codigoSAPVehiculo}\n` +
      `*Empleado:* ${numeroEmpleado}\n` +
      `*Problema:* ${descripcion}\n`;

    if (ubicacion) {
      msg += `*Ubicación:* ${ubicacion}\n`;
    }

    // Agregar tiempo estimado de llegada si está disponible
    if (tiempoLlegada) {
      const horas = Math.floor(tiempoLlegada.tiempoEstimadoMin / 60);
      const minutos = tiempoLlegada.tiempoEstimadoMin % 60;

      let tiempoStr;
      if (horas > 0) {
        tiempoStr = minutos > 0 ? `${horas}h ${minutos}min` : `${horas}h`;
      } else {
        tiempoStr = `${minutos} min`;
      }

      msg += `\n🚗 *Tiempo estimado de llegada:* ~${tiempoStr}\n`;
      msg += `📍 *Centro de servicio:* ${tiempoLlegada.centroNombre}\n`;
      msg += `📏 *Distancia:* ${tiempoLlegada.distanciaKm} km\n`;
    }

    msg += '\nUn técnico te contactará pronto.\n\n' + '*Guarda tu número de ticket.*';

    return msg;
  },

  // Mensajes de ubicación
  REQUEST_UBICACION_TITLE: '📍 Ubicación',

  REQUEST_UBICACION:
    '📍 *¿Dónde te encuentras?*\n\n' +
    'Envía tu *ubicación actual* usando WhatsApp.\n\n' +
    '_Toca + o 📎 → Ubicación → Enviar ubicación actual_',

  REQUEST_UBICACION_BODY:
    'Envía tu *ubicación actual* usando WhatsApp.\n\n' +
    '_Toca + o 📎 → Ubicación → Enviar ubicación actual_',

  UBICACION_REGISTERED: '✅ Ubicación registrada.\n\n' + 'Creando tu reporte...',

  UBICACION_REGISTERED_TITLE: '✅ Ubicación Registrada',

  UBICACION_INVALIDA:
    '❌ No pude obtener tu ubicación.\n\n' +
    'Por favor envía tu *ubicación actual* usando WhatsApp.\n\n' +
    '_Toca + o 📎 → Ubicación → Enviar ubicación actual_',
};

// ============================================
// MENSAJES DE DETECCIÓN INTELIGENTE
// ============================================

const DETECCION = {
  REFRIGERADOR_DETECTADO_TITLE: '✅ Entendido',
  VEHICULO_DETECTADO_TITLE: '✅ Entendido',

  /**
   * Genera mensaje cuando se detecta tipo de equipo y problema
   */
  refrigeradorDetectado: (problema, incluirSaludo = false) => {
    const greeting = incluirSaludo ? `${GENERAL.GREETING}\n\n` : '';
    const problemaPart = problema ? `*Refrigerador* - ${problema}\n\n` : '*Refrigerador*\n\n';
    return (
      `${greeting}${problemaPart}` +
      'Ingresa el *Número SAP*:\n\n' +
      'O envía *foto del código de barras*.'
    );
  },

  refrigeradorDetectadoBody: (problema, incluirSaludo = false) => {
    const greeting = incluirSaludo ? `${GENERAL.GREETING}\n\n` : '';
    const problemaPart = problema ? `*Refrigerador* - ${problema}\n\n` : '*Refrigerador*\n\n';
    return (
      `${greeting}${problemaPart}` +
      'Ingresa el *Número SAP*:\n\n' +
      'O envía *foto del código de barras*.'
    );
  },

  vehiculoDetectado: (problema, incluirSaludo = false) => {
    const greeting = incluirSaludo ? `${GENERAL.GREETING}\n\n` : '';
    const problemaPart = problema ? `*Vehículo* - ${problema}\n\n` : '*Vehículo*\n\n';
    return `${greeting}${problemaPart}` + 'Ingresa tu *Número de Empleado*:';
  },

  vehiculoDetectadoBody: (problema, incluirSaludo = false) => {
    const greeting = incluirSaludo ? `${GENERAL.GREETING}\n\n` : '';
    const problemaPart = problema ? `*Vehículo* - ${problema}\n\n` : '*Vehículo*\n\n';
    return `${greeting}${problemaPart}` + 'Ingresa tu *Número de Empleado*:';
  },

  CONFIRM_REFRIGERADOR_TITLE: '¿Es un Refrigerador?',
  confirmRefrigerador: (text) => `Mencionaste: "${text}"\n\n` + '¿Es un refrigerador?',

  CONFIRM_VEHICULO_TITLE: '¿Es un Vehículo?',
  confirmVehiculo: (text) => `Mencionaste: "${text}"\n\n` + '¿Es un vehículo?',

  // ---- Mensajes para extracción inteligente de datos ----

  DATOS_EXTRAIDOS_TITLE: '📋 Datos Detectados',

  /**
   * Mensaje cuando extraemos SAP de refrigerador y lo encontramos en BD
   */
  datosExtraidosRefrigerador: (equipo, problema, incluirSaludo = false) => {
    const greeting = incluirSaludo ? `${GENERAL.GREETING}\n\n` : '';
    return (
      `${greeting}*Refrigerador encontrado:*\n\n` +
      `*SAP:* ${equipo.CodigoSAP}\n` +
      `*Modelo:* ${equipo.Modelo}\n` +
      `*Cliente:* ${equipo.NombreCliente}\n` +
      `*Problema:* ${problema}\n\n` +
      '¿Es correcto?'
    );
  },

  VEHICULO_EMPLEADO_EXTRAIDO_TITLE: '✅ Detectado',

  /**
   * Mensaje cuando extraemos número de empleado para vehículo
   */
  vehiculoEmpleadoExtraido: (numeroEmpleado, problema, incluirSaludo = false) => {
    const greeting = incluirSaludo ? `${GENERAL.GREETING}\n\n` : '';
    return (
      `${greeting}*Vehículo*\n` +
      `*Empleado:* ${numeroEmpleado}\n` +
      `*Problema:* ${problema || 'Por definir'}\n\n` +
      'Ahora ingresa el *SAP del vehículo*:'
    );
  },

  /**
   * Mensaje cuando extraemos todos los datos del vehículo (empleado + SAP + problema)
   */
  datosExtraidosVehiculoCompleto: (numeroEmpleado, codigoSap, problema, incluirSaludo = false) => {
    const greeting = incluirSaludo ? `${GENERAL.GREETING}\n\n` : '';
    return (
      `${greeting}*Datos detectados:*\n\n` +
      `*Vehículo:* ${codigoSap}\n` +
      `*Empleado:* ${numeroEmpleado}\n` +
      `*Problema:* ${problema}\n\n` +
      'Creando reporte...'
    );
  },

  /**
   * Mensaje cuando el SAP extraído del mensaje no se encuentra en BD
   */
  sapExtraidoNoEncontrado: (codigoSap, problema, incluirSaludo = false) => {
    const greeting = incluirSaludo ? `${GENERAL.GREETING}\n\n` : '';
    const problemaPart = problema ? `*Refrigerador* - ${problema}\n\n` : '*Refrigerador*\n\n';
    return (
      `${greeting}${problemaPart}` +
      `❌ El código *${codigoSap}* no existe.\n\n` +
      'Ingresa el *SAP correcto*:\n\n' +
      'O envía *foto del código de barras*.'
    );
  },
};

// ============================================
// MENSAJES DE VALIDACIÓN Y ERRORES
// ============================================

const VALIDACION = {
  CODIGO_INVALIDO: '❌ Código inválido.\n\n' + 'Ingresa el SAP o envía foto del código de barras.',

  CODIGO_VEHICULO_INVALIDO: '❌ Código inválido.\n\n' + 'Ingresa el SAP del vehículo.',

  EMPLEADO_INVALIDO: '❌ Número de empleado inválido.\n\n' + 'Ingresa tu número de empleado.',

  ERROR_CREAR_REPORTE: '❌ Error al crear reporte.\n\n' + 'Intenta de nuevo.',

  NO_ENTIENDO:
    'No entendí tu mensaje.\n\n' +
    'Puedo ayudarte con:\n' +
    '• ❄️ Refrigeradores\n' +
    '• 🚗 Vehículos',

  CONFIRMAR_O_CORREGIR: 'Usa los botones para confirmar o corregir.\n\n' + 'O escribe "si" o "no".',
};

// ============================================
// MENSAJES DE CONSULTA DE TICKETS
// ============================================

const CONSULTA = {
  TITLE: '📋 Consulta de Ticket',

  SIN_TICKETS:
    '📋 No encontré reportes registrados con tu número.\n\n' + '¿Quieres crear un nuevo reporte?',

  TICKET_NO_AUTORIZADO:
    '❌ Este ticket no está asociado a tu número.\n\n' +
    'Solo puedes consultar tus propios reportes.',

  /**
   * Genera mensaje con lista de tickets del usuario
   */
  listaTickets: (tickets) => {
    let msg = '📋 *Tus reportes recientes:*\n\n';

    tickets.forEach((ticket, index) => {
      const estadoInfo = require('./sessionStates').getEstadoReporteInfo(ticket.Estado);
      const fecha = new Date(ticket.FechaCreacion).toLocaleDateString('es-MX', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

      msg += `${index + 1}. *${ticket.NumeroTicket}*\n`;
      msg += `   ${estadoInfo.emoji} ${estadoInfo.nombre}\n`;
      msg += `   📅 ${fecha}\n`;
      if (ticket.TipoReporte === 'REFRIGERADOR' && ticket.CodigoSAP) {
        msg += `   ❄️ SAP: ${ticket.CodigoSAP}\n`;
      } else if (ticket.TipoReporte === 'VEHICULO' && ticket.CodigoSAPVehiculo) {
        msg += `   🚗 SAP: ${ticket.CodigoSAPVehiculo}\n`;
      }
      msg += '\n';
    });

    msg += 'Escribe el *número de ticket* para ver más detalles.\n';
    msg += '_Ejemplo: TKT-BC671636_';

    return msg;
  },

  /**
   * Genera mensaje cuando no se encuentra un ticket
   */
  TICKET_NO_ENCONTRADO: (numeroTicket) =>
    `❌ No encontré el ticket *${numeroTicket}*\n\n` +
    'Verifica el número e intenta de nuevo.\n\n' +
    'Escribe "mis tickets" para ver tu lista de reportes.',

  /**
   * Genera mensaje con detalle completo de un ticket
   */
  detalleTicket: (ticket) => {
    const estadoInfo = require('./sessionStates').getEstadoReporteInfo(ticket.Estado);
    const fecha = new Date(ticket.FechaCreacion).toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    let msg = `📋 *Detalle del Ticket*\n\n`;
    msg += `*Número:* ${ticket.NumeroTicket}\n`;
    msg += `*Estado:* ${estadoInfo.emoji} ${estadoInfo.nombre}\n`;
    msg += `*Fecha:* ${fecha}\n`;
    msg += `*Tipo:* ${ticket.TipoReporte === 'REFRIGERADOR' ? '❄️ Refrigerador' : '🚗 Vehículo'}\n`;

    if (ticket.TipoReporte === 'REFRIGERADOR') {
      if (ticket.CodigoSAP) {
        msg += `*SAP:* ${ticket.CodigoSAP}\n`;
      }
      if (ticket.Modelo) {
        msg += `*Modelo:* ${ticket.Modelo}\n`;
      }
      if (ticket.NombreCliente) {
        msg += `*Cliente:* ${ticket.NombreCliente}\n`;
      }
    } else if (ticket.TipoReporte === 'VEHICULO') {
      if (ticket.CodigoSAPVehiculo) {
        msg += `*SAP Vehículo:* ${ticket.CodigoSAPVehiculo}\n`;
      }
      if (ticket.NumeroEmpleado) {
        msg += `*Empleado:* ${ticket.NumeroEmpleado}\n`;
      }
    }

    msg += `*Descripción:* ${ticket.Descripcion}\n\n`;
    msg += estadoInfo.mensaje;

    return msg;
  },
};

// ============================================
// BOTONES
// ============================================

const BUTTONS = {
  TIPO_REFRIGERADOR: { id: 'btn_tipo_refrigerador', title: '❄️ Refrigerador' },
  TIPO_VEHICULO: { id: 'btn_tipo_vehiculo', title: '🚗 Vehículo' },
  CONSULTAR_TICKET: { id: 'btn_consultar_ticket', title: '📋 Consultar Ticket' },
  CONFIRMAR_EQUIPO: { id: 'btn_confirmar_equipo', title: '✅ Sí' },
  CORREGIR_EQUIPO: { id: 'btn_corregir_equipo', title: '❌ No, corregir' },
  SI_REFRIGERADOR: { id: 'btn_tipo_refrigerador', title: '✅ Sí' },
  NO_ES_VEHICULO: { id: 'btn_tipo_vehiculo', title: '❌ No, es vehículo' },
  SI_VEHICULO: { id: 'btn_tipo_vehiculo', title: '✅ Sí' },
  NO_ES_REFRIGERADOR: { id: 'btn_tipo_refrigerador', title: '❌ No, es refri' },
  COMPARTIR_UBICACION: { id: 'btn_ubicacion_info', title: '📍 Enviar ubicación' },
  CANCELAR: { id: 'btn_cancelar', title: '🚫 Cancelar' },
};

// ============================================
// MENSAJES DE ENCUESTA DE SATISFACCION
// ============================================

const ENCUESTA = {
  // Títulos
  INVITACION_TITLE: 'Encuesta de Satisfaccion',
  PREGUNTA_TITLE: (numero) => `Pregunta ${numero}/6`,
  COMENTARIO_TITLE: 'Comentario Final',

  /**
   * Genera mensaje de invitación personalizado
   */
  invitacion: (nombreCliente, numeroTicket) =>
    `Hola${nombreCliente ? ` ${nombreCliente}` : ''},\n\n` +
    `Nos interesa conocer tu opinion sobre el servicio que te hemos brindado ` +
    `en tu reporte *${numeroTicket}*.\n\n` +
    `Ayudanos a mejorar llenando una breve encuesta.\n` +
    `Te llevara menos de un minuto.`,

  // Instrucciones de escala
  INSTRUCCIONES:
    '*Instrucciones:*\n' +
    'Indica tecleando un numero del *1 al 5* como consideras el servicio recibido:\n\n' +
    '5 = Excelente\n' +
    '4 = Bueno\n' +
    '3 = Regular\n' +
    '2 = Malo\n' +
    '1 = Pesimo\n\n' +
    '_Puedes usar los botones o escribir el numero._',

  // 6 Preguntas de la encuesta
  PREGUNTA_1:
    '*Pregunta 1 de 6:*\n\n' +
    '¿Como calificarias la atencion recibida al momento de reportar la falla?',

  PREGUNTA_2:
    '*Pregunta 2 de 6:*\n\n' +
    '¿Consideras que el tiempo de reparacion de tu unidad fue el adecuado?',

  PREGUNTA_3: '*Pregunta 3 de 6:*\n\n' + '¿Se cumplio la fecha compromiso de entrega?',

  PREGUNTA_4: '*Pregunta 4 de 6:*\n\n' + '¿Recibiste la unidad limpia?',

  PREGUNTA_5: '*Pregunta 5 de 6:*\n\n' + '¿Te informaron sobre la reparacion realizada?',

  PREGUNTA_6: '*Pregunta 6 de 6:*\n\n' + '¿Se corrigio la falla reportada?',

  // Pregunta de comentario
  PREGUNTA_COMENTARIO: '¡Casi terminamos!\n\n' + '¿Deseas agregar algun comentario?',

  ESPERA_COMENTARIO: 'Por favor, escribe tu comentario:',

  // Confirmaciones
  RESPUESTA_REGISTRADA: (numero, total) => `✅ Respuesta registrada (${numero}/${total})`,

  // Mensajes de cierre
  AGRADECIMIENTO:
    '¡Gracias por tus respuestas!\n\n' +
    'Tus comentarios nos ayudan a seguir mejorando nuestro servicio.\n\n' +
    '¡Hasta pronto!',

  AGRADECIMIENTO_CON_COMENTARIO:
    '¡Gracias por tus respuestas y comentarios!\n\n' +
    'Tu opinion nos ayuda a seguir mejorando nuestro servicio.\n\n' +
    '¡Hasta pronto!',

  // Rechazo
  ENCUESTA_RECHAZADA:
    'Entendido, no hay problema.\n\n' +
    '¡Gracias por usar AC FixBot!\n' +
    'Escribenos cuando necesites ayuda.',

  // Validacion
  RESPUESTA_INVALIDA:
    '❌ Por favor, ingresa un numero del *1 al 5*.\n\n' + 'O usa los botones de abajo.',

  SELECCIONA_OPCION: 'Por favor, usa los botones para responder:',

  // Encuesta expirada o no activa
  EXPIRADA:
    'Esta encuesta ya no esta activa.\n\n' +
    'Si tienes alguna otra consulta, envianos un mensaje.\n\n' +
    '¡Gracias!',
};

// Botones de encuesta
const BUTTONS_ENCUESTA = {
  ACEPTAR: { id: 'btn_encuesta_aceptar', title: '✅ Aceptar' },
  SALIR: { id: 'btn_encuesta_salir', title: '❌ Salir' },
  // WhatsApp permite maximo 3 botones, usamos 1, 3 y 5 como opciones rapidas
  RATING_1: { id: 'btn_rating_1', title: '1 - Pesimo' },
  RATING_2: { id: 'btn_rating_2', title: '2 - Malo' },
  RATING_3: { id: 'btn_rating_3', title: '3 - Regular' },
  RATING_4: { id: 'btn_rating_4', title: '4 - Bueno' },
  RATING_5: { id: 'btn_rating_5', title: '5 - Excelente' },
  SI_COMENTARIO: { id: 'btn_si_comentario', title: '✅ Si' },
  NO_COMENTARIO: { id: 'btn_no_comentario', title: '❌ No' },
};

// ============================================
// MENSAJES DE FLUJO FLEXIBLE (FASE 2b)
// ============================================

const FLEXIBLE = {
  // Mensajes de progreso
  PROGRESO: (completados, total) => `📊 Progreso: ${completados}/${total} campos`,

  // Confirmación de campo
  CAMPO_RECIBIDO: (nombreCampo) => `✅ ${nombreCampo} registrado`,

  // Solicitud de campos específicos
  SOLICITAR_SAP_REFRI:
    'Ingresa el *Número SAP* del refrigerador.\n\n' +
    'Está en la etiqueta del equipo.\n\n' +
    'También puedes enviar *foto del código de barras*.',

  SOLICITAR_SAP_VEHICULO: 'Ingresa el *Número SAP* del vehículo:',

  SOLICITAR_EMPLEADO: 'Ingresa tu *Número de Empleado*:',

  SOLICITAR_PROBLEMA_REFRI:
    'Describe el problema del refrigerador:\n' + '_Ejemplo: No enfría, gotea, hace ruido_',

  SOLICITAR_PROBLEMA_VEHICULO:
    'Describe el problema del vehículo:\n' + '_Ejemplo: No enciende, hace ruido, frenos_',

  SOLICITAR_UBICACION:
    '📍 *¿Dónde te encuentras?*\n\n' + 'Comparte tu ubicación o escribe la dirección.',

  // Mensajes según campo faltante con contexto
  mensajeCampoFaltante: (campo, tipoReporte, datosExistentes = {}) => {
    const tipoEquipo = tipoReporte === 'REFRIGERADOR' ? 'refrigerador' : 'vehículo';

    switch (campo) {
      case 'codigoSAP':
        if (datosExistentes.problema) {
          return (
            `Entendido: "${datosExistentes.problema}"\n\n` +
            `Ahora necesito el *código SAP* del ${tipoEquipo}:`
          );
        }
        return tipoReporte === 'REFRIGERADOR'
          ? FLEXIBLE.SOLICITAR_SAP_REFRI
          : FLEXIBLE.SOLICITAR_SAP_VEHICULO;

      case 'numeroEmpleado':
        return FLEXIBLE.SOLICITAR_EMPLEADO;

      case 'problema':
        if (datosExistentes.datosEquipo) {
          const equipo = datosExistentes.datosEquipo;
          return (
            `✅ Equipo encontrado: ${equipo.Modelo || equipo.CodigoSAP}\n\n` +
            `Describe el problema que presenta:`
          );
        }
        return tipoReporte === 'REFRIGERADOR'
          ? FLEXIBLE.SOLICITAR_PROBLEMA_REFRI
          : FLEXIBLE.SOLICITAR_PROBLEMA_VEHICULO;

      case 'ubicacion':
        return FLEXIBLE.SOLICITAR_UBICACION;

      default:
        return `Por favor, proporciona: ${campo}`;
    }
  },

  // Resumen de datos recibidos
  resumenDatos: (campos, _tipoReporte) => {
    let resumen = '📋 *Datos recibidos:*\n';

    if (campos.codigoSAP?.valor) {
      resumen += `• SAP: ${campos.codigoSAP.valor}\n`;
    }
    if (campos.numeroEmpleado?.valor) {
      resumen += `• Empleado: ${campos.numeroEmpleado.valor}\n`;
    }
    if (campos.problema?.valor) {
      const problemaCorto =
        campos.problema.valor.length > 50
          ? `${campos.problema.valor.substring(0, 50)}...`
          : campos.problema.valor;
      resumen += `• Problema: ${problemaCorto}\n`;
    }
    if (campos.ubicacion?.valor) {
      resumen += `• Ubicación: ${campos.ubicacion.valor}\n`;
    }

    return resumen;
  },

  // Imagen sin datos extraíbles
  IMAGEN_SIN_DATOS:
    'No pude extraer información de la imagen.\n\n' +
    'Por favor, intenta de nuevo o escribe los datos directamente.',
};

module.exports = {
  GENERAL,
  RATE_LIMIT,
  REFRIGERADOR,
  VEHICULO,
  DETECCION,
  VALIDACION,
  CONSULTA,
  BUTTONS,
  ENCUESTA,
  BUTTONS_ENCUESTA,
  FLEXIBLE, // FASE 2b
};
