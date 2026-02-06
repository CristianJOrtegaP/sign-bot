/**
 * AC FIXBOT - Flujo de Consulta de Tickets (FlowEngine v2)
 * Permite a usuarios consultar el estado de sus reportes
 *
 * MIGRADO al nuevo FlowEngine con inyección de dependencias
 *
 * @module bot/flows/consultaFlow
 */

const db = require('../../core/services/storage/databaseService');
const MSG = require('../constants/messages');
const { ESTADO, TIPO_REPORTE } = require('../constants/sessionStates');

// Patrón para detectar número de ticket
const TICKET_PATTERN = /^TKT-[A-Z0-9]{8}$/i;

/**
 * Definición del flujo de consulta
 * Se registra en el FlowRegistry
 */
const consultaFlow = {
  nombre: 'CONSULTA',

  // Estados que maneja este flujo
  estados: [ESTADO.CONSULTA_ESPERA_TICKET],

  // Botones que activan acciones de este flujo
  botones: {
    btn_consultar_ticket: 'iniciar',
  },

  // Mapeo de estados a handlers específicos
  handlers: {
    [ESTADO.CONSULTA_ESPERA_TICKET]: 'procesarTicketInput',
  },

  /**
   * Inicia el flujo de consulta
   * Muestra lista de tickets del usuario
   * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx
   */
  async iniciar(ctx) {
    ctx.log('Iniciando flujo de consulta');
    ctx.iniciarTimer('consulta_iniciar');

    try {
      // Buscar tickets del usuario
      const tickets = await db.getReportesByTelefono(ctx.from, 5);

      if (tickets.length === 0) {
        await ctx.responder(MSG.CONSULTA.SIN_TICKETS);
        ctx.terminarTimer({ resultado: 'sin_tickets' });
        return;
      }

      // Mostrar lista de tickets
      const msgLista = MSG.CONSULTA.listaTickets(tickets);
      await ctx.responder(msgLista);

      // Cambiar estado para esperar selección
      await ctx.cambiarEstado(ESTADO.CONSULTA_ESPERA_TICKET, {
        tipoReporte: TIPO_REPORTE.CONSULTA,
      });

      ctx.terminarTimer({ resultado: 'tickets_listados', count: tickets.length });
    } catch (error) {
      ctx.registrarError('Error iniciando consulta', error);
      await ctx.responder(
        '❌ Hubo un error al buscar tus reportes. Por favor, intenta nuevamente.'
      );
      ctx.terminarTimer({ resultado: 'error' });
    }
  },

  /**
   * Procesa la entrada del usuario cuando espera un ticket
   * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx
   * @param {string} mensaje - Texto del usuario
   */
  async procesarTicketInput(ctx, mensaje) {
    const cleanText = mensaje.trim().toUpperCase();
    ctx.log(`Procesando entrada de ticket: ${cleanText}`);
    ctx.iniciarTimer('consulta_ticket');

    // Si pide lista de tickets
    if (/^(mis\s*tickets?|ver\s*tickets?|listar?|todos?)$/i.test(mensaje.trim())) {
      await this.iniciar(ctx);
      return;
    }

    // Normalizar número de ticket
    let numeroTicket = cleanText;
    if (/^[A-Z0-9]{8}$/i.test(cleanText)) {
      numeroTicket = `TKT-${cleanText}`;
    }

    // Validar formato
    if (!TICKET_PATTERN.test(numeroTicket)) {
      const match = mensaje.match(/TKT-[A-Z0-9]{8}/i);
      if (match) {
        numeroTicket = match[0].toUpperCase();
      } else {
        await ctx.responder(
          '❌ El formato del ticket no es válido.\n\n' +
            'Por favor, ingresa un número de ticket válido (ej: TKT-BC671636) o escribe "mis tickets" para ver tu lista.'
        );
        ctx.terminarTimer({ resultado: 'formato_invalido' });
        return;
      }
    }

    // Buscar ticket
    await this._mostrarDetalleTicket(ctx, numeroTicket);
  },

  /**
   * Consulta directa de un ticket (sin cambio de estado previo)
   * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx
   * @param {string} numeroTicket
   */
  async consultarDirecto(ctx, numeroTicket) {
    ctx.log(`Consulta directa de ticket: ${numeroTicket}`);
    ctx.iniciarTimer('consulta_directa');
    await this._mostrarDetalleTicket(ctx, numeroTicket);
  },

  /**
   * Muestra el detalle de un ticket
   * @private
   * @param {import('../../core/flowEngine/contexts/StaticFlowContext')} ctx
   * @param {string} numeroTicket
   */
  async _mostrarDetalleTicket(ctx, numeroTicket) {
    try {
      const ticket = await db.getReporteByTicket(numeroTicket.toUpperCase());

      if (!ticket) {
        await ctx.responder(MSG.CONSULTA.TICKET_NO_ENCONTRADO(numeroTicket));
        ctx.terminarTimer({ resultado: 'no_encontrado' });
        return;
      }

      // Verificar autorización
      if (ticket.TelefonoReportante !== ctx.from) {
        ctx.warn(`Usuario intentó acceder a ticket de otro usuario`, {
          ticketOwner: ticket.TelefonoReportante,
        });
        await ctx.responder(MSG.CONSULTA.TICKET_NO_AUTORIZADO);
        ctx.terminarTimer({ resultado: 'no_autorizado' });
        return;
      }

      // Mostrar detalle
      const msgDetalle = MSG.CONSULTA.detalleTicket(ticket);
      await ctx.responder(msgDetalle);

      // Finalizar flujo
      await ctx.finalizar(`Consulta de ticket completada: ${numeroTicket}`);
      ctx.terminarTimer({ resultado: 'detalle_mostrado', ticket: numeroTicket });
    } catch (error) {
      ctx.registrarError('Error consultando ticket', error);
      await ctx.responder('❌ Hubo un error al buscar el ticket. Por favor, intenta nuevamente.');
      ctx.terminarTimer({ resultado: 'error' });
    }
  },
};

// ============================================================
// FUNCIONES STANDALONE (para uso directo sin FlowEngine)
// Usadas por textHandler para consultas directas de tickets
// ============================================================

const { createStaticFlowContext } = require('../../core/flowEngine');

/**
 * Inicia el flujo de consulta (standalone)
 * @param {string} from - Número de teléfono del usuario
 * @param {Object} context - Contexto de Azure Functions
 */
async function iniciarFlujo(from, context) {
  const session = await db.getSession(from);
  const ctx = createStaticFlowContext(from, session, context, { flowName: 'CONSULTA' });
  await consultaFlow.iniciar(ctx);
}

/**
 * Consulta directa de un ticket específico (standalone)
 * @param {string} from - Número de teléfono del usuario
 * @param {string} numeroTicket - Número de ticket a consultar
 * @param {Object} context - Contexto de Azure Functions
 */
async function consultarTicketDirecto(from, numeroTicket, context) {
  const session = await db.getSession(from);
  const ctx = createStaticFlowContext(from, session, context, { flowName: 'CONSULTA' });
  await consultaFlow.consultarDirecto(ctx, numeroTicket);
}

module.exports = consultaFlow;
module.exports.iniciarFlujo = iniciarFlujo;
module.exports.consultarTicketDirecto = consultarTicketDirecto;
