/**
 * Mock: SQL Server Connection Pool
 * Simula pool de mssql sin conexion real
 */

const mockRequest = {
  input: jest.fn().mockReturnThis(),
  output: jest.fn().mockReturnThis(),
  query: jest.fn(async () => ({ recordset: [], rowsAffected: [1] })),
  execute: jest.fn(async () => ({ recordset: [], rowsAffected: [1] })),
};

const mockPool = {
  request: jest.fn(() => ({
    ...mockRequest,
    input: jest.fn().mockReturnThis(),
    output: jest.fn().mockReturnThis(),
    query: mockRequest.query,
    execute: mockRequest.execute,
  })),
  close: jest.fn().mockResolvedValue(undefined),
  connected: true,
};

module.exports = {
  getPool: jest.fn(async () => mockPool),
  executeWithRetry: jest.fn(async (fn) => fn()),
  closePool: jest.fn().mockResolvedValue(undefined),
  isConnected: jest.fn(() => true),
  __mockPool: mockPool,
  __mockRequest: mockRequest,
};
