/**
 * Unit Test: RequestTimeout utilities
 * Tests para TimeoutBudget y TimeoutError
 */

jest.mock('../../core/services/infrastructure/errorHandler', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../core/utils/promises', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
}));

const { TimeoutBudget, TimeoutError } = require('../../core/utils/requestTimeout');

describe('TimeoutBudget', () => {
  test('remaining() debe retornar tiempo restante positivo al inicio', () => {
    const budget = new TimeoutBudget(5000, 'test');
    expect(budget.remaining()).toBeGreaterThan(4900);
    expect(budget.remaining()).toBeLessThanOrEqual(5000);
  });

  test('elapsed() debe retornar tiempo transcurrido', () => {
    const budget = new TimeoutBudget(5000, 'test');
    expect(budget.elapsed()).toBeGreaterThanOrEqual(0);
    expect(budget.elapsed()).toBeLessThan(100);
  });

  test('isExpired() debe retornar false con presupuesto amplio', () => {
    const budget = new TimeoutBudget(5000, 'test');
    expect(budget.isExpired()).toBe(false);
  });

  test('isExpired() debe retornar true con presupuesto agotado', () => {
    const budget = new TimeoutBudget(0, 'test');
    expect(budget.isExpired()).toBe(true);
  });

  test('effectiveTimeout() retorna el menor entre solicitado y restante', () => {
    const budget = new TimeoutBudget(2000, 'test');
    // Con 2000ms restantes y 4000 solicitados, debe dar ~2000
    const effective = budget.effectiveTimeout(4000);
    expect(effective).toBeLessThanOrEqual(2000);
    expect(effective).toBeGreaterThan(1900);
  });

  test('effectiveTimeout() retorna solicitado si presupuesto es mayor', () => {
    const budget = new TimeoutBudget(10000, 'test');
    expect(budget.effectiveTimeout(3000)).toBe(3000);
  });

  test('effectiveTimeout() retorna 0 si presupuesto bajo mínimo', () => {
    const budget = new TimeoutBudget(500, 'test');
    // Con 500ms restante y minThreshold de 1000, debe retornar 0
    expect(budget.effectiveTimeout(3000, 1000)).toBe(0);
  });

  test('effectiveTimeout() retorna 0 con presupuesto agotado', () => {
    const budget = new TimeoutBudget(0, 'test');
    expect(budget.effectiveTimeout(3000)).toBe(0);
  });

  test('remaining() nunca retorna negativo', () => {
    const budget = new TimeoutBudget(0, 'test');
    expect(budget.remaining()).toBe(0);
  });

  test('usa defaults cuando no se pasan parámetros', () => {
    const budget = new TimeoutBudget();
    expect(budget.remaining()).toBeGreaterThan(239000);
    expect(budget.isExpired()).toBe(false);
  });
});

describe('TimeoutError', () => {
  test('debe crear error con propiedades correctas', () => {
    const error = new TimeoutError('testOp', 5000);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TimeoutError');
    expect(error.operation).toBe('testOp');
    expect(error.timeoutMs).toBe(5000);
    expect(error.code).toBe('ETIMEDOUT');
    expect(error.message).toContain('testOp');
    expect(error.message).toContain('5000');
  });
});
