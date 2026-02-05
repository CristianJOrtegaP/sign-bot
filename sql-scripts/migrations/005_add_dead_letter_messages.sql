-- =============================================
-- MIGRACION 005: Agregar tabla DeadLetterMessages
-- AC FIXBOT - Dead Letter Queue para mensajes fallidos
-- Fecha: 2026-02-04
-- =============================================

PRINT '';
PRINT '===============================================================';
PRINT '  MIGRACION 005: Dead Letter Messages';
PRINT '===============================================================';
PRINT '';

-- =============================================
-- CREAR TABLA DeadLetterMessages
-- =============================================

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'DeadLetterMessages')
BEGIN
    PRINT 'Creando tabla DeadLetterMessages...';

    CREATE TABLE [dbo].[DeadLetterMessages] (
        [DeadLetterId] INT IDENTITY(1,1) PRIMARY KEY,
        [WhatsAppMessageId] NVARCHAR(100) NOT NULL,
        [Telefono] NVARCHAR(20) NOT NULL,
        [TipoMensaje] NVARCHAR(20) NOT NULL,
        [Contenido] NVARCHAR(MAX) NULL,
        [CorrelationId] NVARCHAR(50) NULL,
        [ErrorMessage] NVARCHAR(1000) NOT NULL,
        [ErrorStack] NVARCHAR(MAX) NULL,
        [ErrorCode] NVARCHAR(50) NULL,
        [RetryCount] INT DEFAULT 0,
        [MaxRetries] INT DEFAULT 3,
        [NextRetryAt] DATETIME NULL,
        [LastRetryAt] DATETIME NULL,
        [Estado] NVARCHAR(20) DEFAULT 'PENDING',
        [ProcessedAt] DATETIME NULL,
        [FechaCreacion] DATETIME DEFAULT GETDATE(),
        [FechaActualizacion] DATETIME DEFAULT GETDATE(),
        CONSTRAINT [UQ_DeadLetter_MessageId] UNIQUE ([WhatsAppMessageId])
    );

    PRINT '   [OK] Tabla DeadLetterMessages creada';
END
ELSE
BEGIN
    PRINT '   [SKIP] Tabla DeadLetterMessages ya existe';
END
GO

-- =============================================
-- CREAR INDICES
-- =============================================

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_DeadLetter_PendingRetry')
BEGIN
    PRINT 'Creando indice IX_DeadLetter_PendingRetry...';

    CREATE NONCLUSTERED INDEX [IX_DeadLetter_PendingRetry]
    ON [dbo].[DeadLetterMessages] ([Estado], [NextRetryAt])
    INCLUDE ([Telefono], [TipoMensaje], [RetryCount]);

    PRINT '   [OK] Indice IX_DeadLetter_PendingRetry creado';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_DeadLetter_Telefono')
BEGIN
    PRINT 'Creando indice IX_DeadLetter_Telefono...';

    CREATE NONCLUSTERED INDEX [IX_DeadLetter_Telefono]
    ON [dbo].[DeadLetterMessages] ([Telefono], [FechaCreacion] DESC)
    INCLUDE ([TipoMensaje], [Estado], [ErrorMessage]);

    PRINT '   [OK] Indice IX_DeadLetter_Telefono creado';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_DeadLetter_Cleanup')
BEGIN
    PRINT 'Creando indice IX_DeadLetter_Cleanup...';

    CREATE NONCLUSTERED INDEX [IX_DeadLetter_Cleanup]
    ON [dbo].[DeadLetterMessages] ([Estado], [FechaCreacion]);

    PRINT '   [OK] Indice IX_DeadLetter_Cleanup creado';
END
GO

-- =============================================
-- CREAR STORED PROCEDURES
-- =============================================

IF OBJECT_ID('sp_GetDeadLettersForRetry', 'P') IS NOT NULL
    DROP PROCEDURE sp_GetDeadLettersForRetry;
GO

CREATE PROCEDURE [dbo].[sp_GetDeadLettersForRetry]
    @BatchSize INT = 10
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@BatchSize)
        DeadLetterId,
        WhatsAppMessageId,
        Telefono,
        TipoMensaje,
        Contenido,
        CorrelationId,
        ErrorMessage,
        ErrorCode,
        RetryCount,
        MaxRetries,
        FechaCreacion
    FROM [dbo].[DeadLetterMessages]
    WHERE Estado IN ('PENDING', 'RETRYING')
      AND (NextRetryAt IS NULL OR NextRetryAt <= GETDATE())
      AND RetryCount < MaxRetries
    ORDER BY FechaCreacion ASC;
END
GO

PRINT '   [OK] Stored procedure sp_GetDeadLettersForRetry creado';
GO

IF OBJECT_ID('sp_CleanOldDeadLetters', 'P') IS NOT NULL
    DROP PROCEDURE sp_CleanOldDeadLetters;
GO

CREATE PROCEDURE [dbo].[sp_CleanOldDeadLetters]
    @DaysToKeep INT = 30
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @CutoffDate DATETIME = DATEADD(DAY, -@DaysToKeep, GETDATE());
    DECLARE @DeletedCount INT;

    DELETE FROM [dbo].[DeadLetterMessages]
    WHERE Estado IN ('PROCESSED', 'FAILED')
      AND FechaCreacion < @CutoffDate;

    SET @DeletedCount = @@ROWCOUNT;

    SELECT @DeletedCount AS DeletedCount;
END
GO

PRINT '   [OK] Stored procedure sp_CleanOldDeadLetters creado';
GO

PRINT '';
PRINT '===============================================================';
PRINT '  MIGRACION 005 COMPLETADA';
PRINT '===============================================================';
PRINT '';
GO
