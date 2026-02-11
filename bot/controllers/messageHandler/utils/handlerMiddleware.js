/**
 * SIGN BOT - Middleware compartido para Handlers
 * Rate limiting y reactivacion de sesion
 */

const whatsapp = require('../../../../core/services/external/whatsappService');
const db = require('../../../../core/services/storage/databaseService');
const rateLimiter = require('../../../../core/services/infrastructure/rateLimiter');
const { ESTADO, ORIGEN_ACCION, esEstadoTerminal } = require('../../../constants/sessionStates');
const { ConcurrencyError } = require('../../../../core/errors');

/**
 * Verifica rate limit usando Redis (distribuido) con fallback a local.
 * Previene bypass de rate limit en deployments multi-instancia.
 * @param {string} from - Número de teléfono
 * @param {string} type - Tipo de rate limit ('message', 'image', 'audio')
 * @returns {Promise<{allowed: boolean}>} - Si allowed=false, ya se envió respuesta al usuario
 */
async function enforceRateLimit(from, type = 'message') {
  const check = await rateLimiter.checkRateLimitDistributed(from, type);
  if (!check.allowed) {
    await whatsapp.sendAndSaveText(from, `⏱️ ${check.reason}`);
    return { allowed: false };
  }
  // Solo registrar en local si no usamos Redis (Redis ya incrementó el contador)
  rateLimiter.recordRequest(from, type);
  return { allowed: true };
}

/**
 * Reactiva una sesión en estado terminal a INICIO con optimistic locking correcto.
 * Maneja ConcurrencyError internamente releyendo sesión fresca.
 * @param {string} from - Número de teléfono
 * @param {Object} session - Sesión actual (se modifica in-place)
 * @param {string} origen - Descripción del origen ('texto', 'botón', 'imagen')
 * @param {Object} context - Contexto de Azure Functions
 * @returns {Promise<void>}
 */
async function reactivateSessionIfTerminal(from, session, origen, context) {
  if (session.Estado === ESTADO.INICIO || !esEstadoTerminal(session.Estado)) {
    return;
  }

  context.log(`🔄 Reactivando sesión de ${from} desde estado ${session.Estado} (${origen})`);
  try {
    await db.updateSession(
      from,
      ESTADO.INICIO,
      null,
      null,
      ORIGEN_ACCION.USUARIO,
      `Sesión reactivada desde ${session.Estado} por ${origen}`,
      null,
      session.Version
    );
    session.Estado = ESTADO.INICIO;
    session.Version = (session.Version ?? 0) + 1;
  } catch (error) {
    if (error instanceof ConcurrencyError) {
      context.log(`⚡ Conflicto de concurrencia reactivando sesión (${origen}), releyendo...`);
      const freshSession = await db.getSessionFresh(from);
      Object.assign(session, freshSession);
    } else {
      throw error;
    }
  }
}

module.exports = {
  enforceRateLimit,
  reactivateSessionIfTerminal,
};
