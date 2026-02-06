/**
 * AC FIXBOT - Flow Contexts
 * Exporta todos los contextos de flujo
 *
 * @module core/flowEngine/contexts
 */

const BaseContext = require('./BaseContext');
const StaticFlowContext = require('./StaticFlowContext');
const FlexibleFlowContext = require('./FlexibleFlowContext');

const { createStaticFlowContext } = StaticFlowContext;
const { createFlexibleFlowContext } = FlexibleFlowContext;

module.exports = {
  // Clases
  BaseContext,
  StaticFlowContext,
  FlexibleFlowContext,

  // Factory functions
  createStaticFlowContext,
  createFlexibleFlowContext,
};
