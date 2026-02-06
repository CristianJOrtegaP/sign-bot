/**
 * AC FIXBOT - FlexibleFlowContext
 * Contexto para flujos flexibles/dinámicos (refrigerador, vehículo)
 *
 * Extiende BaseContext con métodos específicos para flujos
 * donde los campos pueden completarse en cualquier orden.
 *
 * @module core/flowEngine/contexts/FlexibleFlowContext
 */

const BaseContext = require('./BaseContext');
const db = require('../../services/storage/databaseService');
const { ORIGEN_ACCION } = require('../../../bot/constants/sessionStates');

/**
 * Contexto para flujos flexibles/dinámicos
 * Usado para: reportes de refrigerador, vehículo
 */
class FlexibleFlowContext extends BaseContext {
  /**
   * @param {string} from - Número de teléfono del usuario
   * @param {Object} session - Sesión actual del usuario
   * @param {Object} context - Contexto de Azure Functions
   * @param {Object} options - Opciones adicionales
   * @param {string} options.flowName - Nombre del flujo
   * @param {string} options.tipoReporte - REFRIGERADOR | VEHICULO
   */
  constructor(from, session, context, options = {}) {
    super(from, session, context, options);
    this.tipoReporte = options.tipoReporte || this.getDatos().tipoReporte;
  }

  // ==============================================================
  // MÉTODOS DE CAMPOS
  // ==============================================================

  /**
   * Obtiene los campos requeridos del flujo
   * @returns {Object} Mapa de campos requeridos
   */
  getCamposRequeridos() {
    const datos = this.getDatos();
    return datos.camposRequeridos || {};
  }

  /**
   * Verifica si un campo está completo
   * @param {string} nombreCampo - Nombre del campo
   * @returns {boolean}
   */
  campoEstaCompleto(nombreCampo) {
    const campos = this.getCamposRequeridos();
    return campos[nombreCampo]?.completo === true;
  }

  /**
   * Obtiene el valor de un campo
   * @param {string} nombreCampo - Nombre del campo
   * @returns {*} Valor del campo o null
   */
  getValorCampo(nombreCampo) {
    const campos = this.getCamposRequeridos();
    return campos[nombreCampo]?.valor ?? null;
  }

  /**
   * Actualiza un campo con nuevo valor
   * @param {string} nombreCampo - Nombre del campo
   * @param {*} valor - Nuevo valor
   * @param {Object} metadata - Metadata adicional (fuente, confianza, etc.)
   */
  async actualizarCampo(nombreCampo, valor, metadata = {}) {
    const datos = this.getDatos();
    if (!datos.camposRequeridos) {
      datos.camposRequeridos = {};
    }

    datos.camposRequeridos[nombreCampo] = {
      valor,
      completo: true,
      fuente: metadata.fuente || 'usuario',
      confianza: metadata.confianza || 1.0,
      timestamp: Date.now(),
      ...metadata,
    };

    await this.actualizarDatos(datos, `Campo ${nombreCampo} actualizado`);
    this.log(`Campo actualizado: ${nombreCampo} = ${JSON.stringify(valor).substring(0, 50)}`);
  }

  /**
   * Actualiza múltiples campos a la vez
   * @param {Object} campos - Objeto con {nombreCampo: {valor, metadata}}
   */
  async actualizarCampos(campos) {
    const datos = this.getDatos();
    if (!datos.camposRequeridos) {
      datos.camposRequeridos = {};
    }

    const nombresActualizados = [];
    for (const [nombre, info] of Object.entries(campos)) {
      datos.camposRequeridos[nombre] = {
        valor: info.valor,
        completo: true,
        fuente: info.fuente || 'usuario',
        confianza: info.confianza || 1.0,
        timestamp: Date.now(),
        ...info,
      };
      nombresActualizados.push(nombre);
    }

    await this.actualizarDatos(datos, `Campos actualizados: ${nombresActualizados.join(', ')}`);
    this.log(`Campos actualizados: ${nombresActualizados.join(', ')}`);
  }

  /**
   * Obtiene los campos faltantes
   * @returns {Array<Object>} Lista de campos faltantes con nombre y descripción
   */
  getCamposFaltantes() {
    const campos = this.getCamposRequeridos();
    return Object.entries(campos)
      .filter(([_, info]) => !info.completo)
      .map(([nombre, info]) => ({
        nombre,
        descripcion: info.descripcion || nombre,
        requerido: info.requerido !== false,
      }));
  }

  /**
   * Obtiene los datos temporales (alias de getDatos)
   * @returns {Object}
   */
  getDatosTemp() {
    return this.getDatos();
  }

  /**
   * Establece el campo que se está solicitando actualmente
   * @param {string} nombreCampo - Nombre del campo
   */
  async setCampoSolicitado(nombreCampo) {
    const datos = this.getDatos();
    datos.campoSolicitado = nombreCampo;
    await this.actualizarDatos(datos, `Solicitando campo: ${nombreCampo}`);
    this.log(`Campo solicitado establecido: ${nombreCampo}`);
  }

  /**
   * Obtiene el campo que se está solicitando
   * @returns {string|null}
   */
  getCampoSolicitado() {
    return this.getDatos().campoSolicitado || null;
  }

  /**
   * Calcula el porcentaje de completitud
   * @returns {Object} { completados, total, porcentaje }
   */
  getCompletitud() {
    const campos = this.getCamposRequeridos();
    const entries = Object.entries(campos);
    const total = entries.length;
    const completados = entries.filter(([_, info]) => info.completo).length;
    const porcentaje = total > 0 ? Math.round((completados / total) * 100) : 0;

    return { completados, total, porcentaje };
  }

  /**
   * Verifica si todos los campos requeridos están completos
   * @returns {boolean}
   */
  todosLosCamposCompletos() {
    return this.getCamposFaltantes().length === 0;
  }

  // ==============================================================
  // MÉTODOS DE EQUIPO (específicos de refrigerador/vehículo)
  // ==============================================================

  /**
   * Obtiene los datos del equipo asociado
   * @returns {Object|null}
   */
  getDatosEquipo() {
    const datos = this.getDatos();
    return datos.datosEquipo || null;
  }

  /**
   * Guarda los datos del equipo encontrado
   * @param {Object} equipo - Datos del equipo
   */
  async guardarDatosEquipo(equipo) {
    const datos = this.getDatos();
    datos.datosEquipo = equipo;
    datos.equipoIdTemp = equipo.EquipoId;
    await this.actualizarDatos(datos, 'Equipo asociado');
    this.log(`Equipo guardado: ${equipo.EquipoId}`);
  }

  /**
   * Busca un equipo por código SAP
   * @param {string} codigoSAP - Código SAP a buscar
   * @returns {Object|null} Equipo encontrado o null
   */
  async buscarEquipoPorSAP(codigoSAP) {
    const equipo = await db.getEquipoBySAP(codigoSAP);
    if (equipo) {
      this.log(`Equipo encontrado por SAP ${codigoSAP}: ${equipo.EquipoId}`);
    } else {
      this.log(`No se encontró equipo con SAP: ${codigoSAP}`);
    }
    return equipo;
  }

  // ==============================================================
  // MÉTODOS DE CONFIRMACIÓN
  // ==============================================================

  /**
   * Cambia a estado de confirmación
   * @param {string} estadoConfirmacion - Estado de confirmación
   * @param {Object} datosAConfirmar - Datos que se están confirmando
   */
  async solicitarConfirmacion(estadoConfirmacion, datosAConfirmar) {
    const datos = this.getDatos();
    datos.datosAConfirmar = datosAConfirmar;
    const version = this._getVersion();
    await db.updateSession(
      this.from,
      estadoConfirmacion,
      datos,
      this.session.EquipoId,
      ORIGEN_ACCION.BOT,
      'Esperando confirmación del usuario',
      null,
      version
    );
    this._incrementVersion();
    this.log(`Solicitando confirmación en estado: ${estadoConfirmacion}`);
  }

  /**
   * Procesa confirmación positiva
   * @param {string} estadoSiguiente - Estado después de confirmar
   */
  async confirmar(estadoSiguiente) {
    const datos = this.getDatos();
    delete datos.datosAConfirmar;
    await this.cambiarEstado(estadoSiguiente, datos, 'Usuario confirmó');
    this.log('Confirmación aceptada');
  }

  /**
   * Procesa rechazo de confirmación
   * @param {string} estadoRetorno - Estado al que volver
   */
  async rechazar(estadoRetorno) {
    const datos = this.getDatos();
    delete datos.datosAConfirmar;
    await this.cambiarEstado(estadoRetorno, datos, 'Usuario rechazó');
    this.log('Confirmación rechazada');
  }

  // ==============================================================
  // MÉTODOS DE RESUMEN
  // ==============================================================

  /**
   * Genera un resumen de los campos completados
   * @returns {string} Resumen formateado
   */
  generarResumen() {
    const campos = this.getCamposRequeridos();
    const lineas = [];

    for (const [nombre, info] of Object.entries(campos)) {
      if (info.completo && info.valor) {
        const valorStr =
          typeof info.valor === 'object' ? JSON.stringify(info.valor) : String(info.valor);
        lineas.push(`• *${this._formatearNombreCampo(nombre)}:* ${valorStr.substring(0, 100)}`);
      }
    }

    return lineas.join('\n');
  }

  /**
   * Formatea nombre de campo para mostrar
   * @private
   */
  _formatearNombreCampo(nombre) {
    const mapeo = {
      codigoSAP: 'Código SAP',
      problema: 'Problema',
      ubicacion: 'Ubicación',
      numeroEmpleado: 'Número de Empleado',
      imagenBarcode: 'Código de Barras',
      imagenEvidencia: 'Evidencia',
    };
    return mapeo[nombre] || nombre;
  }
}

/**
 * Factory function para crear FlexibleFlowContext
 * @param {string} from - Número de teléfono
 * @param {Object} session - Sesión del usuario
 * @param {Object} context - Contexto de Azure
 * @param {Object} options - Opciones adicionales
 * @returns {FlexibleFlowContext}
 */
function createFlexibleFlowContext(from, session, context, options = {}) {
  return new FlexibleFlowContext(from, session, context, options);
}

module.exports = FlexibleFlowContext;
module.exports.createFlexibleFlowContext = createFlexibleFlowContext;
