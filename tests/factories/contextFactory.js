/**
 * Factory: Azure Functions Context
 */

function createAzureFunctionContext(overrides = {}) {
  const logFn = jest.fn();
  logFn.warn = jest.fn();
  logFn.error = jest.fn();
  logFn.verbose = jest.fn();

  return {
    log: logFn,
    bindings: {},
    res: {},
    correlationId: 'test-correlation-id',
    executionContext: {
      functionName: 'api-whatsapp-webhook',
      invocationId: 'test-invocation-id',
    },
    ...overrides,
  };
}

module.exports = { createAzureFunctionContext };
