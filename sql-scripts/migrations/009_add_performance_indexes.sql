-- ============================================================================
-- AC FIXBOT - Migración 009: Índices de Performance
-- ============================================================================
-- Fecha: 2026-02-05
-- Descripción: Agrega índices para mejorar rendimiento de queries frecuentes
-- Impacto: Reduce latencia ~50% en búsquedas por teléfono y estado
-- ============================================================================

-- ============================================================================
-- ÍNDICE: SesionesChat por Teléfono
-- Uso: Búsqueda de sesión activa por número de teléfono (cada mensaje)
-- Query: SELECT * FROM SesionesChat WHERE Telefono = @telefono
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SesionesChat_Telefono' AND object_id = OBJECT_ID('SesionesChat'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_SesionesChat_Telefono
    ON SesionesChat(Telefono)
    INCLUDE (SesionId, EstadoId, TipoReporteId, DatosTemp, UltimaActividad);

    PRINT 'Índice IX_SesionesChat_Telefono creado';
END
ELSE
BEGIN
    PRINT 'Índice IX_SesionesChat_Telefono ya existe';
END
GO

-- ============================================================================
-- ÍNDICE: Reportes por Estado y Fecha
-- Uso: Dashboard de reportes pendientes, consultas de tickets
-- Query: SELECT * FROM Reportes WHERE Estado = 'PENDIENTE' ORDER BY FechaCreacion
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Reportes_Estado_Fecha' AND object_id = OBJECT_ID('Reportes'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Reportes_Estado_Fecha
    ON Reportes(Estado, FechaCreacion DESC)
    INCLUDE (ReporteId, NumeroTicket, TipoReporteId, Telefono);

    PRINT 'Índice IX_Reportes_Estado_Fecha creado';
END
ELSE
BEGIN
    PRINT 'Índice IX_Reportes_Estado_Fecha ya existe';
END
GO

-- ============================================================================
-- ÍNDICE: Reportes por Teléfono
-- Uso: Consulta de tickets de un usuario específico
-- Query: SELECT * FROM Reportes WHERE Telefono = @telefono
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Reportes_Telefono' AND object_id = OBJECT_ID('Reportes'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Reportes_Telefono
    ON Reportes(Telefono)
    INCLUDE (ReporteId, NumeroTicket, Estado, FechaCreacion);

    PRINT 'Índice IX_Reportes_Telefono creado';
END
ELSE
BEGIN
    PRINT 'Índice IX_Reportes_Telefono ya existe';
END
GO

-- ============================================================================
-- ÍNDICE: Reportes por Número de Ticket
-- Uso: Búsqueda directa de ticket (TKT-XXXXXXXX)
-- Query: SELECT * FROM Reportes WHERE NumeroTicket = @ticket
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Reportes_NumeroTicket' AND object_id = OBJECT_ID('Reportes'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Reportes_NumeroTicket
    ON Reportes(NumeroTicket)
    INCLUDE (ReporteId, Estado, Telefono, FechaCreacion);

    PRINT 'Índice IX_Reportes_NumeroTicket creado';
END
ELSE
BEGIN
    PRINT 'Índice IX_Reportes_NumeroTicket ya existe';
END
GO

-- ============================================================================
-- ÍNDICE: MensajesProcessados por Teléfono y Fecha
-- Uso: Historial de mensajes, detección de spam
-- Query: SELECT * FROM MensajesProcessados WHERE Telefono = @tel ORDER BY FechaCreacion
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Mensajes_Telefono_Fecha' AND object_id = OBJECT_ID('MensajesProcessados'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Mensajes_Telefono_Fecha
    ON MensajesProcessados(Telefono, FechaCreacion DESC)
    INCLUDE (MensajeId, Tipo, Contenido);

    PRINT 'Índice IX_Mensajes_Telefono_Fecha creado';
END
ELSE
BEGIN
    PRINT 'Índice IX_Mensajes_Telefono_Fecha ya existe';
END
GO

-- ============================================================================
-- ÍNDICE: DeadLetterMessages por Estado y NextRetryAt
-- Uso: Procesador de reintentos (timer-dlq-processor)
-- Query: SELECT * FROM DeadLetterMessages WHERE Estado = 'PENDING' AND NextRetryAt <= GETDATE()
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DeadLetter_Estado_NextRetry' AND object_id = OBJECT_ID('DeadLetterMessages'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_DeadLetter_Estado_NextRetry
    ON DeadLetterMessages(Estado, NextRetryAt)
    INCLUDE (DeadLetterId, WhatsAppMessageId, Telefono, RetryCount);

    PRINT 'Índice IX_DeadLetter_Estado_NextRetry creado';
END
ELSE
BEGIN
    PRINT 'Índice IX_DeadLetter_Estado_NextRetry ya existe';
END
GO

-- ============================================================================
-- ÍNDICE: Encuestas por Estado y Teléfono
-- Uso: Búsqueda de encuestas pendientes por usuario
-- Query: SELECT * FROM Encuestas WHERE Telefono = @tel AND Estado = 'PENDIENTE'
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Encuestas_Telefono_Estado' AND object_id = OBJECT_ID('Encuestas'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Encuestas_Telefono_Estado
    ON Encuestas(Telefono, Estado)
    INCLUDE (EncuestaId, ReporteId, FechaEnvio, FechaExpiracion);

    PRINT 'Índice IX_Encuestas_Telefono_Estado creado';
END
ELSE
BEGIN
    PRINT 'Índice IX_Encuestas_Telefono_Estado ya existe';
END
GO

PRINT '';
PRINT '============================================================================';
PRINT 'Migración 009 completada: Índices de performance creados';
PRINT '============================================================================';
