/**
 * AC FIXBOT - Flujo de Consulta de Estado de Tickets V2
 * Permite a los usuarios consultar el estado de sus reportes existentes
 * Compatible con nuevos estados normalizados
 */

const whatsapp = require('../../../core/services/external/whatsappService');
const db = require('../../../core/services/storage/databaseService');
const metrics = require('../../../core/services/infrastructure/metricsService');
const MSG = require('../../constants/messages');
const {
    ESTADO,
    TIPO_REPORTE,
    ORIGEN_ACCION,
    TIPO_MENSAJE,
    TIPO_CONTENIDO
} = require('../../constants/sessionStates');

// Patrón para detectar número de ticket
// Formato real: TKT-XXXXXXXX (8 caracteres alfanuméricos)
const TICKET_PATTERN = /^TKT-[A-Z0-9]{8}$/i;

/**
 * Inicia el flujo de consulta de estado
 * Busca automáticamente los tickets del usuario por teléfono
 * @param {string} from - Número de teléfono del usuario
 * @param {Object} context - Contexto de Azure Functions
 */
async function iniciarFlujo(from, context) {
    const timer = metrics.startTimer('consulta_estado_flujo');
    context.log(`Iniciando flujo de consulta de estado para ${from}`);

    try {
        // Buscar tickets del usuario por teléfono
        const tickets = await db.getReportesByTelefono(from, 5);

        if (tickets.length === 0) {
            await whatsapp.sendText(from, MSG.CONSULTA.SIN_TICKETS);
            await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.CONSULTA.SIN_TICKETS, TIPO_CONTENIDO.TEXTO);
            timer.end({ result: 'sin_tickets' });
            return;
        }

        // Mostrar lista de tickets
        const msgListaTickets = MSG.CONSULTA.listaTickets(tickets);
        await whatsapp.sendText(from, msgListaTickets);
        await db.saveMessage(from, TIPO_MENSAJE.BOT, msgListaTickets, TIPO_CONTENIDO.TEXTO);

        // Actualizar estado de sesión para esperar selección de ticket
        await db.updateSession(
            from,
            ESTADO.CONSULTA_ESPERA_TICKET,
            { tipoReporte: TIPO_REPORTE.CONSULTA },
            null,
            ORIGEN_ACCION.USUARIO,
            'Flujo consulta iniciado'
        );

        timer.end({ result: 'tickets_listados', count: tickets.length });
    } catch (error) {
        context.log.error('Error en flujo de consulta de estado:', error);
        metrics.recordError('consulta_estado_error', error.message);
        const msgError = '❌ Hubo un error al buscar tus reportes. Por favor, intenta nuevamente.';
        await whatsapp.sendText(from, msgError);
        await db.saveMessage(from, TIPO_MENSAJE.BOT, msgError, TIPO_CONTENIDO.TEXTO);
        timer.end({ result: 'error' });
    }
}

/**
 * Maneja la entrada del usuario cuando se espera un número de ticket
 * @param {string} from - Número de teléfono del usuario
 * @param {string} text - Texto ingresado por el usuario
 * @param {Object} session - Sesión actual del usuario
 * @param {Object} context - Contexto de Azure Functions
 */
async function handleTicketInput(from, text, session, context) {
    const timer = metrics.startTimer('consulta_ticket_detalle');
    const cleanText = text.trim().toUpperCase();

    context.log(`Procesando entrada de ticket: ${cleanText}`);

    // Si el usuario escribe "mis tickets" o similar, mostrar lista
    if (/^(mis\s*tickets?|ver\s*tickets?|listar?|todos?)$/i.test(text.trim())) {
        await iniciarFlujo(from, context);
        timer.end({ result: 'lista_refresh' });
        return;
    }

    // Validar formato de ticket
    let numeroTicket = cleanText;

    // Si no tiene el prefijo TKT-, intentar agregarlo (formato: 8 caracteres alfanuméricos)
    if (/^[A-Z0-9]{8}$/i.test(cleanText)) {
        numeroTicket = `TKT-${cleanText}`;
    }

    // Validar que sea un número de ticket válido
    if (!TICKET_PATTERN.test(numeroTicket)) {
        // Buscar si el texto contiene un número de ticket válido
        const match = text.match(/TKT-[A-Z0-9]{8}/i);
        if (match) {
            numeroTicket = match[0].toUpperCase();
        } else {
            const msgFormatoInvalido = '❌ El formato del ticket no es válido.\n\n' +
                'Por favor, ingresa un número de ticket válido (ej: TKT-BC671636) o escribe "mis tickets" para ver tu lista.';
            await whatsapp.sendText(from, msgFormatoInvalido);
            await db.saveMessage(from, TIPO_MENSAJE.BOT, msgFormatoInvalido, TIPO_CONTENIDO.TEXTO);
            timer.end({ result: 'formato_invalido' });
            return;
        }
    }

    try {
        // Buscar el ticket específico
        const ticket = await db.getReporteByTicket(numeroTicket);

        if (!ticket) {
            const msgNoEncontrado = MSG.CONSULTA.TICKET_NO_ENCONTRADO(numeroTicket);
            await whatsapp.sendText(from, msgNoEncontrado);
            await db.saveMessage(from, TIPO_MENSAJE.BOT, msgNoEncontrado, TIPO_CONTENIDO.TEXTO);
            timer.end({ result: 'ticket_no_encontrado' });
            return;
        }

        // Verificar que el ticket pertenezca al usuario
        if (ticket.TelefonoReportante !== from) {
            context.log.warn(`Usuario ${from} intentó acceder a ticket de ${ticket.TelefonoReportante}`);
            await whatsapp.sendText(from, MSG.CONSULTA.TICKET_NO_AUTORIZADO);
            await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.CONSULTA.TICKET_NO_AUTORIZADO, TIPO_CONTENIDO.TEXTO);
            timer.end({ result: 'no_autorizado' });
            return;
        }

        // Mostrar detalle del ticket
        const msgDetalle = MSG.CONSULTA.detalleTicket(ticket);
        await whatsapp.sendText(from, msgDetalle);
        await db.saveMessage(from, TIPO_MENSAJE.BOT, msgDetalle, TIPO_CONTENIDO.TEXTO);

        // Reiniciar sesión después de mostrar detalle (FINALIZADO porque completó la consulta)
        await db.updateSession(
            from,
            ESTADO.FINALIZADO,
            null,
            null,
            ORIGEN_ACCION.BOT,
            `Consulta de ticket completada: ${numeroTicket}`
        );

        timer.end({ result: 'detalle_mostrado', ticket: numeroTicket });
    } catch (error) {
        context.log.error('Error consultando ticket:', error);
        metrics.recordError('consulta_ticket_error', error.message);
        const msgError = '❌ Hubo un error al buscar el ticket. Por favor, intenta nuevamente.';
        await whatsapp.sendText(from, msgError);
        await db.saveMessage(from, TIPO_MENSAJE.BOT, msgError, TIPO_CONTENIDO.TEXTO);
        timer.end({ result: 'error' });
    }
}

/**
 * Consulta directa de un ticket específico (cuando viene en el mensaje inicial)
 * @param {string} from - Número de teléfono del usuario
 * @param {string} numeroTicket - Número de ticket a consultar
 * @param {Object} context - Contexto de Azure Functions
 */
async function consultarTicketDirecto(from, numeroTicket, context) {
    const timer = metrics.startTimer('consulta_ticket_directo');
    context.log(`Consulta directa de ticket: ${numeroTicket}`);

    try {
        const ticket = await db.getReporteByTicket(numeroTicket.toUpperCase());

        if (!ticket) {
            const msgNoEncontrado = MSG.CONSULTA.TICKET_NO_ENCONTRADO(numeroTicket);
            await whatsapp.sendText(from, msgNoEncontrado);
            await db.saveMessage(from, TIPO_MENSAJE.BOT, msgNoEncontrado, TIPO_CONTENIDO.TEXTO);
            timer.end({ result: 'ticket_no_encontrado' });
            return;
        }

        // Verificar que el ticket pertenezca al usuario
        if (ticket.TelefonoReportante !== from) {
            context.log.warn(`Usuario ${from} intentó acceder a ticket de ${ticket.TelefonoReportante}`);
            await whatsapp.sendText(from, MSG.CONSULTA.TICKET_NO_AUTORIZADO);
            await db.saveMessage(from, TIPO_MENSAJE.BOT, MSG.CONSULTA.TICKET_NO_AUTORIZADO, TIPO_CONTENIDO.TEXTO);
            timer.end({ result: 'no_autorizado' });
            return;
        }

        // Mostrar detalle del ticket
        const msgDetalle = MSG.CONSULTA.detalleTicket(ticket);
        await whatsapp.sendText(from, msgDetalle);
        await db.saveMessage(from, TIPO_MENSAJE.BOT, msgDetalle, TIPO_CONTENIDO.TEXTO);
        timer.end({ result: 'detalle_mostrado', ticket: numeroTicket });
    } catch (error) {
        context.log.error('Error en consulta directa de ticket:', error);
        metrics.recordError('consulta_directa_error', error.message);
        const msgError = '❌ Hubo un error al buscar el ticket. Por favor, intenta nuevamente.';
        await whatsapp.sendText(from, msgError);
        await db.saveMessage(from, TIPO_MENSAJE.BOT, msgError, TIPO_CONTENIDO.TEXTO);
        timer.end({ result: 'error' });
    }
}

module.exports = {
    iniciarFlujo,
    handleTicketInput,
    consultarTicketDirecto,
    TICKET_PATTERN
};
