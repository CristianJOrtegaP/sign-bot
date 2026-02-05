-- ============================================================================
-- AC FIXBOT - Migration 004: Create AuditEvents Table
-- FASE 3: Compliance y análisis de seguridad
-- ============================================================================

-- Crear tabla de eventos de auditoría
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AuditEvents')
BEGIN
    CREATE TABLE AuditEvents (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        EventType NVARCHAR(50) NOT NULL,
        Severity NVARCHAR(20) NOT NULL DEFAULT 'INFO',
        CorrelationId NVARCHAR(50) NULL,
        Details NVARCHAR(MAX) NULL,
        RequestInfo NVARCHAR(MAX) NULL,
        Timestamp DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

        -- Índices para queries comunes
        INDEX IX_AuditEvents_Timestamp (Timestamp DESC),
        INDEX IX_AuditEvents_EventType (EventType),
        INDEX IX_AuditEvents_Severity (Severity),
        INDEX IX_AuditEvents_CorrelationId (CorrelationId)
    );

    PRINT 'Tabla AuditEvents creada exitosamente';
END
ELSE
BEGIN
    PRINT 'Tabla AuditEvents ya existe';
END
GO

-- ============================================================================
-- Stored Procedure: Limpieza de eventos antiguos
-- Retención: 90 días por defecto
-- ============================================================================
CREATE OR ALTER PROCEDURE sp_CleanupAuditEvents
    @DaysToKeep INT = 90
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @DeletedCount INT;
    DECLARE @CutoffDate DATETIME2 = DATEADD(DAY, -@DaysToKeep, GETUTCDATE());

    -- Eliminar eventos más viejos que el período de retención
    DELETE FROM AuditEvents
    WHERE Timestamp < @CutoffDate;

    SET @DeletedCount = @@ROWCOUNT;

    SELECT @DeletedCount AS DeletedCount;

    IF @DeletedCount > 0
    BEGIN
        PRINT CONCAT('Eliminados ', @DeletedCount, ' eventos de auditoría más antiguos que ', @DaysToKeep, ' días');
    END
END
GO

-- ============================================================================
-- Stored Procedure: Obtener eventos de seguridad recientes
-- Para dashboards y alertas
-- ============================================================================
CREATE OR ALTER PROCEDURE sp_GetSecurityEvents
    @Hours INT = 24,
    @SeverityFilter NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @CutoffTime DATETIME2 = DATEADD(HOUR, -@Hours, GETUTCDATE());

    SELECT
        EventType,
        Severity,
        CorrelationId,
        Details,
        RequestInfo,
        Timestamp
    FROM AuditEvents
    WHERE
        Timestamp >= @CutoffTime
        AND EventType IN (
            'AUTH_FAILURE',
            'SIGNATURE_INVALID',
            'RATE_LIMIT_EXCEEDED',
            'AUTH_SUCCESS'
        )
        AND (@SeverityFilter IS NULL OR Severity = @SeverityFilter)
    ORDER BY Timestamp DESC;
END
GO

-- ============================================================================
-- Stored Procedure: Resumen de auditoría por tipo de evento
-- ============================================================================
CREATE OR ALTER PROCEDURE sp_GetAuditSummary
    @Days INT = 7
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @CutoffDate DATETIME2 = DATEADD(DAY, -@Days, GETUTCDATE());

    SELECT
        EventType,
        Severity,
        COUNT(*) AS EventCount,
        MIN(Timestamp) AS FirstOccurrence,
        MAX(Timestamp) AS LastOccurrence
    FROM AuditEvents
    WHERE Timestamp >= @CutoffDate
    GROUP BY EventType, Severity
    ORDER BY EventCount DESC, EventType;
END
GO

PRINT 'Migration 004 completada: AuditEvents table y stored procedures creados';
