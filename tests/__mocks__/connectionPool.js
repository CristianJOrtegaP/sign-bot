/**
 * Mock - Connection Pool
 * Simula el pool de conexiones a SQL Server
 */

const mockRequest = {
    input: jest.fn().mockReturnThis(),
    output: jest.fn().mockReturnThis(),
    query: jest.fn().mockResolvedValue({ recordset: [], rowsAffected: [0] }),
    execute: jest.fn().mockResolvedValue({ recordset: [], rowsAffected: [0] })
};

const mockPool = {
    request: jest.fn().mockReturnValue(mockRequest),
    close: jest.fn().mockResolvedValue(true),
    connected: true
};

const mockConnectionPool = {
    __mockRequest: mockRequest,
    __mockPool: mockPool,

    // Reset para tests
    __reset: () => {
        mockRequest.query.mockClear();
        mockRequest.execute.mockClear();
        mockRequest.input.mockClear();
        mockPool.request.mockClear();
    },

    // Configurar respuesta de query
    __setQueryResponse: (response) => {
        mockRequest.query.mockResolvedValue(response);
    },

    // Configurar error de query
    __setQueryError: (error) => {
        mockRequest.query.mockRejectedValue(error);
    },

    getPool: jest.fn().mockResolvedValue(mockPool),

    closePool: jest.fn().mockResolvedValue(true),

    isPoolConnected: jest.fn().mockReturnValue(true)
};

module.exports = mockConnectionPool;
