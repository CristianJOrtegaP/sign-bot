-- =============================================
-- SIGN BOT - Base de Datos Completa
-- Firma digital de documentos via DocuSign + WhatsApp
-- =============================================

USE [db-signbot];
GO

SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

PRINT '===============================================================';
PRINT '  SIGN BOT - Instalacion de Base de Datos';
PRINT '  Fecha: ' + CONVERT(VARCHAR, GETDATE(), 120);
PRINT '===============================================================';
PRINT '';
GO

-- =============================================
-- PASO 1: CREAR CATALOGO DE ESTADOS DE SESION
-- =============================================

PRINT 'Paso 1: Creando CatEstadoSesion...';
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'CatEstadoSesion')
CREATE TABLE [dbo].[CatEstadoSesion] (
    [EstadoId] INT PRIMARY KEY,
    [Codigo] NVARCHAR(50) NOT NULL UNIQUE,
    [Nombre] NVARCHAR(100) NOT NULL,
    [Descripcion] NVARCHAR(500) NULL,
    [EsTerminal] BIT NOT NULL DEFAULT 0,
    [Orden] INT NOT NULL DEFAULT 0,
    [Activo] BIT NOT NULL DEFAULT 1
);
GO

PRINT '   CatEstadoSesion creada';
GO

-- =============================================
-- PASO 2: CREAR CATALOGO DE ESTADOS DE DOCUMENTO
-- =============================================

PRINT '';
PRINT 'Paso 2: Creando CatEstadoDocumento...';
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'CatEstadoDocumento')
CREATE TABLE [dbo].[CatEstadoDocumento] (
    [EstadoDocumentoId] INT IDENTITY(1,1) PRIMARY KEY,
    [Codigo] NVARCHAR(50) NOT NULL UNIQUE,
    [Nombre] NVARCHAR(100) NOT NULL,
    [Descripcion] NVARCHAR(500) NULL,
    [Emoji] NVARCHAR(10) NULL,
    [EsFinal] BIT NOT NULL DEFAULT 0,
    [Orden] INT NOT NULL DEFAULT 0,
    [Activo] BIT NOT NULL DEFAULT 1
);
GO

PRINT '   CatEstadoDocumento creada';
GO

-- =============================================
-- PASO 3: CREAR CATALOGO DE TIPOS DE DOCUMENTO
-- =============================================

PRINT '';
PRINT 'Paso 3: Creando CatTipoDocumento...';
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'CatTipoDocumento')
CREATE TABLE [dbo].[CatTipoDocumento] (
    [TipoDocumentoId] INT IDENTITY(1,1) PRIMARY KEY,
    [Codigo] NVARCHAR(50) NOT NULL UNIQUE,
    [Nombre] NVARCHAR(100) NOT NULL,
    [Descripcion] NVARCHAR(500) NULL,
    [Activo] BIT NOT NULL DEFAULT 1
);
GO

PRINT '   CatTipoDocumento creada';
GO

-- =============================================
-- PASO 4: CREAR TABLA SESIONES CHAT
-- =============================================

PRINT '';
PRINT 'Paso 4: Creando SesionesChat...';
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SesionesChat')
CREATE TABLE [dbo].[SesionesChat] (
    [SesionId] INT IDENTITY(1,1) PRIMARY KEY,
    [Telefono] NVARCHAR(20) NOT NULL,
    [EstadoId] INT NOT NULL DEFAULT 1,
    [DatosTemp] NVARCHAR(MAX) NULL,
    [ContadorMensajes] INT NOT NULL DEFAULT 0,
    [AdvertenciaEnviada] BIT NOT NULL DEFAULT 0,
    [FechaAdvertencia] DATETIME NULL,
    [NombreUsuario] NVARCHAR(200) NULL,
    [FechaCreacion] DATETIME NOT NULL DEFAULT GETDATE(),
    [UltimaActividad] DATETIME NOT NULL DEFAULT GETDATE(),
    [Version] INT NOT NULL DEFAULT 1,

    CONSTRAINT [UQ_SesionesChat_Telefono] UNIQUE ([Telefono]),
    CONSTRAINT [FK_SesionesChat_Estado] FOREIGN KEY ([EstadoId])
        REFERENCES [dbo].[CatEstadoSesion] ([EstadoId])
);

CREATE NONCLUSTERED INDEX [IX_SesionesChat_Estado] ON [dbo].[SesionesChat] ([EstadoId]);
CREATE NONCLUSTERED INDEX [IX_SesionesChat_UltimaActividad] ON [dbo].[SesionesChat] ([UltimaActividad]);
GO

PRINT '   SesionesChat creada';
GO

-- =============================================
-- PASO 5: CREAR TABLA DOCUMENTOS FIRMA
-- =============================================

PRINT '';
PRINT 'Paso 5: Creando DocumentosFirma...';
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DocumentosFirma')
CREATE TABLE [dbo].[DocumentosFirma] (
    [DocumentoFirmaId] INT IDENTITY(1,1) PRIMARY KEY,

    -- DocuSign
    [EnvelopeId] NVARCHAR(100) NULL,

    -- SAP Reference
    [SapDocumentId] NVARCHAR(100) NOT NULL,
    [SapCallbackUrl] NVARCHAR(500) NULL,

    -- Cliente
    [ClienteTelefono] NVARCHAR(20) NOT NULL,
    [ClienteNombre] NVARCHAR(200) NOT NULL,
    [ClienteEmail] NVARCHAR(200) NULL,

    -- Documento
    [TipoDocumentoId] INT NOT NULL,
    [EstadoDocumentoId] INT NOT NULL,
    [DocumentoNombre] NVARCHAR(500) NULL,
    [DocumentoOriginalUrl] NVARCHAR(1000) NULL,
    [DocumentoFirmadoUrl] NVARCHAR(1000) NULL,
    [SigningUrl] NVARCHAR(2000) NULL,

    -- Lifecycle timestamps
    [FechaCreacion] DATETIME NOT NULL DEFAULT GETDATE(),
    [FechaEnvioDocuSign] DATETIME NULL,
    [FechaEnvioWhatsApp] DATETIME NULL,
    [FechaVisto] DATETIME NULL,
    [FechaFirmado] DATETIME NULL,
    [FechaRechazo] DATETIME NULL,

    -- Rechazo
    [MotivoRechazo] NVARCHAR(1000) NULL,

    -- Recordatorios
    [IntentosRecordatorio] INT NOT NULL DEFAULT 0,
    [UltimoRecordatorio] DATETIME NULL,
    [UltimoReporteTeams] DATETIME NULL,

    -- WhatsApp tracking
    [WhatsAppMessageId] NVARCHAR(100) NULL,

    -- Envelope reutilizacion
    [EnvelopeReutilizado] BIT NOT NULL DEFAULT 0,
    [DocumentoAnteriorId] INT NULL,

    -- Error tracking
    [MensajeError] NVARCHAR(1000) NULL,
    [IntentosSap] INT NOT NULL DEFAULT 0,

    -- Metadata
    [DatosExtra] NVARCHAR(MAX) NULL,
    [Version] INT NOT NULL DEFAULT 1,
    [CreatedAt] DATETIME NOT NULL DEFAULT GETUTCDATE(),
    [UpdatedAt] DATETIME NOT NULL DEFAULT GETUTCDATE(),

    CONSTRAINT [FK_DocumentosFirma_TipoDocumento] FOREIGN KEY ([TipoDocumentoId])
        REFERENCES [dbo].[CatTipoDocumento] ([TipoDocumentoId]),
    CONSTRAINT [FK_DocumentosFirma_EstadoDocumento] FOREIGN KEY ([EstadoDocumentoId])
        REFERENCES [dbo].[CatEstadoDocumento] ([EstadoDocumentoId]),
    CONSTRAINT [FK_DocumentosFirma_DocumentoAnterior] FOREIGN KEY ([DocumentoAnteriorId])
        REFERENCES [dbo].[DocumentosFirma] ([DocumentoFirmaId])
);

CREATE NONCLUSTERED INDEX [IX_DocumentosFirma_EnvelopeId] ON [dbo].[DocumentosFirma] ([EnvelopeId]) WHERE [EnvelopeId] IS NOT NULL;
CREATE NONCLUSTERED INDEX [IX_DocumentosFirma_SapDocumentId] ON [dbo].[DocumentosFirma] ([SapDocumentId]);
CREATE NONCLUSTERED INDEX [IX_DocumentosFirma_ClienteTelefono] ON [dbo].[DocumentosFirma] ([ClienteTelefono], [EstadoDocumentoId]);
CREATE NONCLUSTERED INDEX [IX_DocumentosFirma_Estado] ON [dbo].[DocumentosFirma] ([EstadoDocumentoId]) INCLUDE ([ClienteTelefono], [EnvelopeId]);
CREATE NONCLUSTERED INDEX [IX_DocumentosFirma_Recordatorio] ON [dbo].[DocumentosFirma] ([EstadoDocumentoId], [IntentosRecordatorio], [UltimoRecordatorio]);
CREATE NONCLUSTERED INDEX [IX_DocumentosFirma_UpdatedAt] ON [dbo].[DocumentosFirma] ([UpdatedAt]) WHERE [EnvelopeId] IS NOT NULL;
GO

PRINT '   DocumentosFirma creada';
GO

-- =============================================
-- PASO 6: CREAR TABLA HISTORIAL SESIONES
-- =============================================

PRINT '';
PRINT 'Paso 6: Creando HistorialSesiones...';
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'HistorialSesiones')
CREATE TABLE [dbo].[HistorialSesiones] (
    [HistorialId] INT IDENTITY(1,1) PRIMARY KEY,
    [SesionId] INT NULL,
    [Telefono] NVARCHAR(20) NOT NULL,
    [EstadoAnteriorId] INT NULL,
    [EstadoNuevoId] INT NOT NULL,
    [OrigenAccion] NVARCHAR(20) NOT NULL DEFAULT 'SISTEMA',
    [Descripcion] NVARCHAR(500) NULL,
    [DocumentoFirmaId] INT NULL,
    [FechaAccion] DATETIME NOT NULL DEFAULT GETDATE(),

    CONSTRAINT [FK_Historial_EstadoAnterior] FOREIGN KEY ([EstadoAnteriorId])
        REFERENCES [dbo].[CatEstadoSesion] ([EstadoId]),
    CONSTRAINT [FK_Historial_EstadoNuevo] FOREIGN KEY ([EstadoNuevoId])
        REFERENCES [dbo].[CatEstadoSesion] ([EstadoId])
);

CREATE NONCLUSTERED INDEX [IX_Historial_Telefono] ON [dbo].[HistorialSesiones] ([Telefono], [FechaAccion] DESC);
CREATE NONCLUSTERED INDEX [IX_Historial_SesionId] ON [dbo].[HistorialSesiones] ([SesionId]);
CREATE NONCLUSTERED INDEX [IX_Historial_FechaAccion] ON [dbo].[HistorialSesiones] ([FechaAccion]);
GO

PRINT '   HistorialSesiones creada';
GO

-- =============================================
-- PASO 7: CREAR TABLA MENSAJES CHAT
-- =============================================

PRINT '';
PRINT 'Paso 7: Creando MensajesChat...';
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MensajesChat')
CREATE TABLE [dbo].[MensajesChat] (
    [MensajeId] INT IDENTITY(1,1) PRIMARY KEY,
    [SesionId] INT NULL,
    [Telefono] NVARCHAR(20) NOT NULL,
    [Tipo] CHAR(1) NOT NULL,
    [TipoContenido] NVARCHAR(20) NOT NULL DEFAULT 'TEXTO',
    [Contenido] NVARCHAR(MAX) NULL,
    [WhatsAppMessageId] NVARCHAR(100) NULL,
    [FechaCreacion] DATETIME NOT NULL DEFAULT GETDATE(),

    CONSTRAINT [FK_MensajesChat_Sesion] FOREIGN KEY ([SesionId])
        REFERENCES [dbo].[SesionesChat] ([SesionId])
);

CREATE NONCLUSTERED INDEX [IX_MensajesChat_Telefono] ON [dbo].[MensajesChat] ([Telefono], [FechaCreacion]);
CREATE NONCLUSTERED INDEX [IX_MensajesChat_SesionId] ON [dbo].[MensajesChat] ([SesionId]);
CREATE NONCLUSTERED INDEX [IX_MensajesChat_FechaCreacion] ON [dbo].[MensajesChat] ([FechaCreacion]);
CREATE NONCLUSTERED INDEX [IX_MensajesChat_Spam_Check]
    ON [dbo].[MensajesChat] ([Telefono], [Tipo], [FechaCreacion] DESC)
    INCLUDE ([MensajeId]);
GO

PRINT '   MensajesChat creada';
GO

-- =============================================
-- PASO 8: CREAR TABLA MENSAJES PROCESADOS (DEDUPLICACION)
-- =============================================

PRINT '';
PRINT 'Paso 8: Creando MensajesProcessados...';
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MensajesProcessados')
CREATE TABLE [dbo].[MensajesProcessados] (
    [Id] BIGINT IDENTITY(1,1) PRIMARY KEY,
    [WhatsAppMessageId] NVARCHAR(100) NOT NULL,
    [Telefono] NVARCHAR(20) NULL,
    [Reintentos] INT NOT NULL DEFAULT 0,
    [UltimoReintento] DATETIME NULL,
    [FechaCreacion] DATETIME DEFAULT GETDATE(),

    CONSTRAINT [UQ_MensajesProcessados_MessageId] UNIQUE ([WhatsAppMessageId])
);

CREATE NONCLUSTERED INDEX [IX_MensajesProcessados_FechaCreacion]
    ON [dbo].[MensajesProcessados] ([FechaCreacion]);
GO

PRINT '   MensajesProcessados creada';
GO

-- =============================================
-- PASO 9: CREAR TABLA DEAD LETTER MESSAGES
-- =============================================

PRINT '';
PRINT 'Paso 9: Creando DeadLetterMessages...';
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DeadLetterMessages')
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

CREATE NONCLUSTERED INDEX [IX_DeadLetter_PendingRetry]
    ON [dbo].[DeadLetterMessages] ([Estado], [NextRetryAt])
    INCLUDE ([Telefono], [TipoMensaje], [RetryCount])
    WHERE [Estado] IN ('PENDING', 'RETRYING');
GO

PRINT '   DeadLetterMessages creada';
GO

-- =============================================
-- PASO 10: CREAR TABLA EVENTOS DOCUSIGN PROCESADOS
-- =============================================

PRINT '';
PRINT 'Paso 10: Creando EventosDocuSignProcessados...';
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'EventosDocuSignProcessados')
CREATE TABLE [dbo].[EventosDocuSignProcessados] (
    [Id] BIGINT IDENTITY(1,1) PRIMARY KEY,
    [EventId] NVARCHAR(200) NOT NULL,
    [EnvelopeId] NVARCHAR(100) NOT NULL,
    [EventType] NVARCHAR(50) NOT NULL,
    [FechaCreacion] DATETIME DEFAULT GETDATE(),

    CONSTRAINT [UQ_EventosDocuSign_EventId] UNIQUE ([EventId])
);

CREATE NONCLUSTERED INDEX [IX_EventosDocuSign_EnvelopeId]
    ON [dbo].[EventosDocuSignProcessados] ([EnvelopeId]);
CREATE NONCLUSTERED INDEX [IX_EventosDocuSign_FechaCreacion]
    ON [dbo].[EventosDocuSignProcessados] ([FechaCreacion]);
GO

PRINT '   EventosDocuSignProcessados creada';
GO

-- =============================================
-- PASO 10b: CREAR TABLA AUDIT EVENTS
-- =============================================

PRINT '';
PRINT 'Paso 10b: Creando AuditEvents...';
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AuditEvents')
CREATE TABLE [dbo].[AuditEvents] (
    [AuditEventId] BIGINT IDENTITY(1,1) PRIMARY KEY,
    [EventType] NVARCHAR(100) NOT NULL,
    [Severity] NVARCHAR(20) NOT NULL DEFAULT 'INFO',
    [CorrelationId] NVARCHAR(50) NULL,
    [Details] NVARCHAR(MAX) NULL,
    [RequestInfo] NVARCHAR(MAX) NULL,
    [Timestamp] DATETIME NOT NULL DEFAULT GETUTCDATE(),
    [FechaCreacion] DATETIME NOT NULL DEFAULT GETUTCDATE()
);

CREATE NONCLUSTERED INDEX [IX_AuditEvents_EventType] ON [dbo].[AuditEvents] ([EventType], [Timestamp] DESC);
CREATE NONCLUSTERED INDEX [IX_AuditEvents_Severity] ON [dbo].[AuditEvents] ([Severity]) WHERE [Severity] IN ('ERROR', 'CRITICAL');
CREATE NONCLUSTERED INDEX [IX_AuditEvents_CorrelationId] ON [dbo].[AuditEvents] ([CorrelationId]) WHERE [CorrelationId] IS NOT NULL;
CREATE NONCLUSTERED INDEX [IX_AuditEvents_Timestamp] ON [dbo].[AuditEvents] ([Timestamp] DESC);
GO

PRINT '   AuditEvents creada';
GO

-- =============================================
-- PASO 11: INSERTAR DATOS EN CATALOGOS
-- =============================================

PRINT '';
PRINT 'Paso 11: Insertando datos en catalogos...';
GO

-- Estados de Sesion (no tiene IDENTITY, insert directo)
INSERT INTO [dbo].[CatEstadoSesion] ([EstadoId], [Codigo], [Nombre], [Descripcion], [EsTerminal], [Orden], [Activo]) VALUES
(1,  'INICIO',                  'Inicio',                  'Sesion nueva o idle, sin flujo activo',               1, 0,  1),
(2,  'CANCELADO',               'Cancelado',               'Sesion cancelada por el usuario',                     1, 100, 1),
(3,  'FINALIZADO',              'Finalizado',              'Flujo completado exitosamente',                       1, 101, 1),
(4,  'TIMEOUT',                 'Timeout',                 'Sesion cerrada por inactividad',                      1, 102, 1),
(10, 'CONSULTA_DOCUMENTOS',     'Consulta Documentos',     'Usuario consultando sus documentos pendientes',       0, 10, 1),
(11, 'CONSULTA_DETALLE',        'Consulta Detalle',        'Usuario viendo detalle de un documento',              0, 11, 1),
(12, 'ESPERANDO_CONFIRMACION',  'Esperando Confirmacion',  'Bot pregunto algo, esperando respuesta del usuario',  0, 12, 1),
(20, 'AGENTE_ACTIVO',           'Atencion por Agente',     'Conversacion tomada por agente humano (v2)',          0, 60, 1);

PRINT '   CatEstadoSesion: 8 registros';
GO

-- Estados de Documento (IDs match documentStates.js ESTADO_DOCUMENTO_ID)
SET IDENTITY_INSERT [dbo].[CatEstadoDocumento] ON;

INSERT INTO [dbo].[CatEstadoDocumento] ([EstadoDocumentoId], [Codigo], [Nombre], [Descripcion], [Emoji], [EsFinal], [Orden]) VALUES
(1, 'PENDIENTE_ENVIO',  'Pendiente de envio',  'Documento recibido, pendiente de enviar a DocuSign',            N'📤', 0, 1),
(2, 'ENVIADO',          'Enviado',             'Envelope creado en DocuSign, link enviado al cliente',           N'📨', 0, 2),
(3, 'ENTREGADO',        'Entregado',           'WhatsApp confirmo entrega del mensaje al cliente',              N'✅', 0, 3),
(4, 'VISTO',            'Visto',               'Cliente abrio el documento en DocuSign',                        N'👁️', 0, 4),
(5, 'FIRMADO',          'Firmado',             'Documento firmado exitosamente por el cliente',                  N'✍️', 1, 5),
(6, 'RECHAZADO',        'Rechazado',           'Cliente rechazo firmar (envelope vivo, reutilizable)',           N'❌', 0, 6),
(7, 'ANULADO',          'Anulado',             'Envelope anulado por SAP o housekeeping',                       N'🚫', 1, 7),
(8, 'ERROR',            'Error',               'Error en algun paso del proceso (reintentable)',                 N'⚠️', 0, 8);

SET IDENTITY_INSERT [dbo].[CatEstadoDocumento] OFF;

PRINT '   CatEstadoDocumento: 8 registros';
GO

-- Tipos de Documento (IDs match documentStates.js TIPO_DOCUMENTO_ID)
SET IDENTITY_INSERT [dbo].[CatTipoDocumento] ON;

INSERT INTO [dbo].[CatTipoDocumento] ([TipoDocumentoId], [Codigo], [Nombre], [Descripcion]) VALUES
(1, 'CONTRATO',  'Contrato',  'Contrato general'),
(2, 'ADENDUM',   'Adendum',   'Adendum a contrato existente'),
(3, 'PAGARE',    'Pagare',    'Pagare'),
(4, 'OTRO',      'Otro',      'Otro tipo de documento');

SET IDENTITY_INSERT [dbo].[CatTipoDocumento] OFF;

PRINT '   CatTipoDocumento: 4 registros';
GO

-- =============================================
-- PASO 12: CREAR STORED PROCEDURES
-- =============================================

PRINT '';
PRINT 'Paso 12: Creando Stored Procedures...';
GO

-- SP: Detectar spam
CREATE OR ALTER PROCEDURE [dbo].[sp_CheckSpam]
    @Telefono NVARCHAR(20),
    @UmbralMensajesPorHora INT = 30,
    @EsSpam BIT OUTPUT,
    @TotalMensajes INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT @TotalMensajes = COUNT(*)
    FROM MensajesChat
    WHERE Telefono = @Telefono
      AND Tipo = 'U'
      AND FechaCreacion > DATEADD(HOUR, -1, GETDATE());

    SET @EsSpam = CASE WHEN @TotalMensajes >= @UmbralMensajesPorHora THEN 1 ELSE 0 END;
END;
GO

PRINT '   sp_CheckSpam creado';
GO

-- SP: Historial de telefono
CREATE OR ALTER PROCEDURE [dbo].[sp_GetHistorialTelefono]
    @Telefono NVARCHAR(20),
    @TopN INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@TopN)
        h.HistorialId,
        h.FechaAccion,
        ea.Codigo AS EstadoAnterior,
        en.Codigo AS EstadoNuevo,
        h.OrigenAccion,
        h.Descripcion,
        h.DocumentoFirmaId
    FROM HistorialSesiones h
    LEFT JOIN CatEstadoSesion ea ON h.EstadoAnteriorId = ea.EstadoId
    INNER JOIN CatEstadoSesion en ON h.EstadoNuevoId = en.EstadoId
    WHERE h.Telefono = @Telefono
    ORDER BY h.FechaAccion DESC;
END;
GO

PRINT '   sp_GetHistorialTelefono creado';
GO

-- SP: Metricas de sesiones
CREATE OR ALTER PROCEDURE [dbo].[sp_GetMetricasSesiones]
    @FechaInicio DATETIME = NULL,
    @FechaFin DATETIME = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @FechaInicio IS NULL SET @FechaInicio = DATEADD(DAY, -30, GETDATE());
    IF @FechaFin IS NULL SET @FechaFin = GETDATE();

    SELECT
        en.Codigo AS EstadoFinal,
        COUNT(*) AS Total
    FROM HistorialSesiones h
    INNER JOIN CatEstadoSesion en ON h.EstadoNuevoId = en.EstadoId
    WHERE h.FechaAccion BETWEEN @FechaInicio AND @FechaFin
      AND en.EsTerminal = 1
    GROUP BY en.Codigo
    ORDER BY Total DESC;

    SELECT
        CAST(FechaAccion AS DATE) AS Fecha,
        COUNT(DISTINCT Telefono) AS UsuariosUnicos,
        COUNT(*) AS TotalAcciones
    FROM HistorialSesiones
    WHERE FechaAccion BETWEEN @FechaInicio AND @FechaFin
    GROUP BY CAST(FechaAccion AS DATE)
    ORDER BY Fecha;
END;
GO

PRINT '   sp_GetMetricasSesiones creado';
GO

-- SP: Sesiones que necesitan warning
CREATE OR ALTER PROCEDURE [dbo].[sp_GetSesionesNeedingWarning]
    @MinutosInactividad INT = 10
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        s.SesionId,
        s.Telefono,
        es.Codigo AS Estado,
        s.UltimaActividad,
        DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) AS MinutosInactivo
    FROM SesionesChat s
    INNER JOIN CatEstadoSesion es ON s.EstadoId = es.EstadoId
    WHERE es.EsTerminal = 0
      AND s.AdvertenciaEnviada = 0
      AND DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) >= @MinutosInactividad
      AND DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) < (@MinutosInactividad + 5);
END;
GO

PRINT '   sp_GetSesionesNeedingWarning creado';
GO

-- SP: Sesiones a cerrar por timeout
CREATE OR ALTER PROCEDURE [dbo].[sp_GetSesionesToClose]
    @MinutosTimeout INT = 15
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        s.SesionId,
        s.Telefono,
        es.Codigo AS Estado,
        s.UltimaActividad,
        DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) AS MinutosInactivo
    FROM SesionesChat s
    INNER JOIN CatEstadoSesion es ON s.EstadoId = es.EstadoId
    WHERE es.EsTerminal = 0
      AND s.AdvertenciaEnviada = 1
      AND DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) >= @MinutosTimeout;
END;
GO

PRINT '   sp_GetSesionesToClose creado';
GO

-- SP: Dead Letters para reintentar
CREATE OR ALTER PROCEDURE [dbo].[sp_GetDeadLettersForRetry]
    @MaxMessages INT = 10
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@MaxMessages)
        DeadLetterId,
        WhatsAppMessageId,
        Telefono,
        TipoMensaje,
        Contenido,
        CorrelationId,
        RetryCount,
        MaxRetries
    FROM DeadLetterMessages
    WHERE Estado IN ('PENDING', 'RETRYING')
      AND (NextRetryAt IS NULL OR NextRetryAt <= GETDATE())
      AND RetryCount < MaxRetries
    ORDER BY FechaCreacion ASC;
END;
GO

PRINT '   sp_GetDeadLettersForRetry creado';
GO

-- SP: Limpiar dead letters antiguos
CREATE OR ALTER PROCEDURE [dbo].[sp_CleanOldDeadLetters]
    @DaysToKeep INT = 7
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM DeadLetterMessages
    WHERE FechaCreacion < DATEADD(DAY, -@DaysToKeep, GETDATE())
      AND Estado IN ('PROCESSED', 'FAILED', 'SKIPPED');

    SELECT @@ROWCOUNT AS DeletedCount;
END;
GO

PRINT '   sp_CleanOldDeadLetters creado';
GO

-- SP: Limpiar audit events antiguos
CREATE OR ALTER PROCEDURE [dbo].[sp_CleanOldAuditEvents]
    @DaysToKeep INT = 90
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM AuditEvents
    WHERE [Timestamp] < DATEADD(DAY, -@DaysToKeep, GETUTCDATE())
      AND Severity IN ('INFO', 'WARNING');

    SELECT @@ROWCOUNT AS DeletedCount;
END;
GO

PRINT '   sp_CleanOldAuditEvents creado';
GO

-- =============================================
-- PASO 13: STORED PROCEDURES DE DOCUMENTOS
-- =============================================

PRINT '';
PRINT 'Paso 13: Creando Stored Procedures de Documentos...';
GO

-- SP: Crear documento de firma
CREATE OR ALTER PROCEDURE [dbo].[sp_CrearDocumentoFirma]
    @SapDocumentId NVARCHAR(100),
    @SapCallbackUrl NVARCHAR(500) = NULL,
    @ClienteTelefono NVARCHAR(20),
    @ClienteNombre NVARCHAR(200),
    @ClienteEmail NVARCHAR(200) = NULL,
    @TipoDocumentoId INT,
    @DocumentoNombre NVARCHAR(500) = NULL,
    @DocumentoOriginalUrl NVARCHAR(1000) = NULL,
    @DatosExtra NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @EstadoPendienteId INT = 1; -- PENDIENTE_ENVIO

    INSERT INTO DocumentosFirma (
        SapDocumentId, SapCallbackUrl, ClienteTelefono, ClienteNombre, ClienteEmail,
        TipoDocumentoId, EstadoDocumentoId, DocumentoNombre, DocumentoOriginalUrl, DatosExtra
    )
    VALUES (
        @SapDocumentId, @SapCallbackUrl, @ClienteTelefono, @ClienteNombre, @ClienteEmail,
        @TipoDocumentoId, @EstadoPendienteId, @DocumentoNombre, @DocumentoOriginalUrl, @DatosExtra
    );

    SELECT
        df.*,
        ed.Codigo AS EstadoDocumento,
        td.Codigo AS TipoDocumento
    FROM DocumentosFirma df
    INNER JOIN CatEstadoDocumento ed ON df.EstadoDocumentoId = ed.EstadoDocumentoId
    INNER JOIN CatTipoDocumento td ON df.TipoDocumentoId = td.TipoDocumentoId
    WHERE df.DocumentoFirmaId = SCOPE_IDENTITY();
END;
GO

PRINT '   sp_CrearDocumentoFirma creado';
GO

-- SP: Actualizar estado de documento (con optimistic locking)
CREATE OR ALTER PROCEDURE [dbo].[sp_ActualizarEstadoDocumento]
    @DocumentoFirmaId INT,
    @NuevoEstadoId INT,
    @Version INT,
    @EnvelopeId NVARCHAR(100) = NULL,
    @SigningUrl NVARCHAR(2000) = NULL,
    @DocumentoFirmadoUrl NVARCHAR(1000) = NULL,
    @MotivoRechazo NVARCHAR(1000) = NULL,
    @WhatsAppMessageId NVARCHAR(100) = NULL,
    @MensajeError NVARCHAR(1000) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE DocumentosFirma
    SET EstadoDocumentoId = @NuevoEstadoId,
        EnvelopeId = COALESCE(@EnvelopeId, EnvelopeId),
        SigningUrl = COALESCE(@SigningUrl, SigningUrl),
        DocumentoFirmadoUrl = COALESCE(@DocumentoFirmadoUrl, DocumentoFirmadoUrl),
        MotivoRechazo = COALESCE(@MotivoRechazo, MotivoRechazo),
        WhatsAppMessageId = COALESCE(@WhatsAppMessageId, WhatsAppMessageId),
        MensajeError = @MensajeError,
        FechaEnvioDocuSign = CASE WHEN @NuevoEstadoId = 2 THEN GETUTCDATE() ELSE FechaEnvioDocuSign END,
        FechaEnvioWhatsApp = CASE WHEN @NuevoEstadoId IN (2, 3) AND FechaEnvioWhatsApp IS NULL THEN GETUTCDATE() ELSE FechaEnvioWhatsApp END,
        FechaVisto = CASE WHEN @NuevoEstadoId = 4 THEN GETUTCDATE() ELSE FechaVisto END,
        FechaFirmado = CASE WHEN @NuevoEstadoId = 5 THEN GETUTCDATE() ELSE FechaFirmado END,
        FechaRechazo = CASE WHEN @NuevoEstadoId = 6 THEN GETUTCDATE() ELSE FechaRechazo END,
        Version = Version + 1,
        UpdatedAt = GETUTCDATE()
    WHERE DocumentoFirmaId = @DocumentoFirmaId
      AND Version = @Version;

    IF @@ROWCOUNT = 0
    BEGIN
        -- Check if document exists
        IF NOT EXISTS (SELECT 1 FROM DocumentosFirma WHERE DocumentoFirmaId = @DocumentoFirmaId)
            RAISERROR('Documento no encontrado: %d', 16, 1, @DocumentoFirmaId);
        ELSE
            RAISERROR('Conflicto de concurrencia para documento: %d', 16, 2, @DocumentoFirmaId);
        RETURN;
    END

    SELECT
        df.*,
        ed.Codigo AS EstadoDocumento,
        td.Codigo AS TipoDocumento
    FROM DocumentosFirma df
    INNER JOIN CatEstadoDocumento ed ON df.EstadoDocumentoId = ed.EstadoDocumentoId
    INNER JOIN CatTipoDocumento td ON df.TipoDocumentoId = td.TipoDocumentoId
    WHERE df.DocumentoFirmaId = @DocumentoFirmaId;
END;
GO

PRINT '   sp_ActualizarEstadoDocumento creado';
GO

-- SP: Obtener documento por ID
CREATE OR ALTER PROCEDURE [dbo].[sp_ObtenerDocumentoPorId]
    @DocumentoFirmaId INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        df.*,
        ed.Codigo AS EstadoDocumento,
        ed.Nombre AS EstadoNombre,
        ed.Emoji AS EstadoEmoji,
        td.Codigo AS TipoDocumento,
        td.Nombre AS TipoDocumentoNombre
    FROM DocumentosFirma df
    INNER JOIN CatEstadoDocumento ed ON df.EstadoDocumentoId = ed.EstadoDocumentoId
    INNER JOIN CatTipoDocumento td ON df.TipoDocumentoId = td.TipoDocumentoId
    WHERE df.DocumentoFirmaId = @DocumentoFirmaId;
END;
GO

PRINT '   sp_ObtenerDocumentoPorId creado';
GO

-- SP: Obtener documento por EnvelopeId (para DocuSign webhooks)
CREATE OR ALTER PROCEDURE [dbo].[sp_ObtenerDocumentoPorEnvelope]
    @EnvelopeId NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        df.*,
        ed.Codigo AS EstadoDocumento,
        ed.Nombre AS EstadoNombre,
        td.Codigo AS TipoDocumento,
        td.Nombre AS TipoDocumentoNombre
    FROM DocumentosFirma df
    INNER JOIN CatEstadoDocumento ed ON df.EstadoDocumentoId = ed.EstadoDocumentoId
    INNER JOIN CatTipoDocumento td ON df.TipoDocumentoId = td.TipoDocumentoId
    WHERE df.EnvelopeId = @EnvelopeId;
END;
GO

PRINT '   sp_ObtenerDocumentoPorEnvelope creado';
GO

-- SP: Obtener documentos por telefono
CREATE OR ALTER PROCEDURE [dbo].[sp_ObtenerDocumentosPorTelefono]
    @Telefono NVARCHAR(20),
    @TopN INT = 20
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@TopN)
        df.DocumentoFirmaId,
        df.EnvelopeId,
        df.SapDocumentId,
        df.ClienteNombre,
        df.DocumentoNombre,
        td.Codigo AS TipoDocumento,
        td.Nombre AS TipoDocumentoNombre,
        ed.Codigo AS EstadoDocumento,
        ed.Nombre AS EstadoNombre,
        ed.Emoji AS EstadoEmoji,
        ed.EsFinal,
        df.SigningUrl,
        df.FechaCreacion,
        df.FechaFirmado,
        df.FechaRechazo,
        df.MotivoRechazo,
        df.IntentosRecordatorio
    FROM DocumentosFirma df
    INNER JOIN CatEstadoDocumento ed ON df.EstadoDocumentoId = ed.EstadoDocumentoId
    INNER JOIN CatTipoDocumento td ON df.TipoDocumentoId = td.TipoDocumentoId
    WHERE df.ClienteTelefono = @Telefono
    ORDER BY df.FechaCreacion DESC;
END;
GO

PRINT '   sp_ObtenerDocumentosPorTelefono creado';
GO

-- SP: Documentos pendientes de recordatorio
CREATE OR ALTER PROCEDURE [dbo].[sp_ObtenerDocumentosPendientesRecordatorio]
    @HorasDesdeUltimoRecordatorio INT = 48,
    @MaxRecordatorios INT = 5
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        df.DocumentoFirmaId,
        df.EnvelopeId,
        df.ClienteTelefono,
        df.ClienteNombre,
        df.DocumentoNombre,
        df.SigningUrl,
        td.Codigo AS TipoDocumento,
        td.Nombre AS TipoDocumentoNombre,
        df.IntentosRecordatorio,
        df.UltimoRecordatorio,
        df.FechaCreacion,
        df.Version,
        DATEDIFF(DAY, df.FechaCreacion, GETUTCDATE()) AS DiasPendientes
    FROM DocumentosFirma df
    INNER JOIN CatEstadoDocumento ed ON df.EstadoDocumentoId = ed.EstadoDocumentoId
    INNER JOIN CatTipoDocumento td ON df.TipoDocumentoId = td.TipoDocumentoId
    WHERE ed.Codigo IN ('ENVIADO', 'ENTREGADO', 'VISTO', 'RECHAZADO')
      AND df.IntentosRecordatorio < @MaxRecordatorios
      AND (
        df.UltimoRecordatorio IS NULL
        OR DATEDIFF(HOUR, df.UltimoRecordatorio, GETUTCDATE()) >= @HorasDesdeUltimoRecordatorio
      )
    ORDER BY df.FechaCreacion ASC;
END;
GO

PRINT '   sp_ObtenerDocumentosPendientesRecordatorio creado';
GO

-- SP: Documentos pendientes de reporte Teams/SAP
CREATE OR ALTER PROCEDURE [dbo].[sp_ObtenerDocumentosPendientesReporteTeams]
    @DiasDesdeUltimoReporte INT = 7
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        df.DocumentoFirmaId,
        df.EnvelopeId,
        df.SapDocumentId,
        df.ClienteTelefono,
        df.ClienteNombre,
        df.DocumentoNombre,
        td.Codigo AS TipoDocumento,
        ed.Codigo AS EstadoDocumento,
        df.IntentosRecordatorio,
        df.UltimoReporteTeams,
        df.FechaCreacion,
        df.Version,
        DATEDIFF(DAY, df.FechaCreacion, GETUTCDATE()) AS DiasPendientes
    FROM DocumentosFirma df
    INNER JOIN CatEstadoDocumento ed ON df.EstadoDocumentoId = ed.EstadoDocumentoId
    INNER JOIN CatTipoDocumento td ON df.TipoDocumentoId = td.TipoDocumentoId
    WHERE ed.Codigo IN ('ENVIADO', 'ENTREGADO', 'VISTO', 'RECHAZADO')
      AND (
        df.UltimoReporteTeams IS NULL
        OR DATEDIFF(DAY, df.UltimoReporteTeams, GETUTCDATE()) >= @DiasDesdeUltimoReporte
      )
    ORDER BY df.FechaCreacion ASC;
END;
GO

PRINT '   sp_ObtenerDocumentosPendientesReporteTeams creado';
GO

-- SP: Documentos para housekeeping (void envelopes inactivos)
CREATE OR ALTER PROCEDURE [dbo].[sp_ObtenerDocumentosParaHousekeeping]
    @DiasInactividad INT = 30
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        df.DocumentoFirmaId,
        df.EnvelopeId,
        df.ClienteTelefono,
        df.ClienteNombre,
        df.DocumentoNombre,
        ed.Codigo AS EstadoDocumento,
        df.UpdatedAt,
        df.Version,
        DATEDIFF(DAY, df.UpdatedAt, GETUTCDATE()) AS DiasInactivo
    FROM DocumentosFirma df
    INNER JOIN CatEstadoDocumento ed ON df.EstadoDocumentoId = ed.EstadoDocumentoId
    WHERE ed.Codigo IN ('ENVIADO', 'ENTREGADO', 'VISTO', 'RECHAZADO', 'ERROR')
      AND df.EnvelopeId IS NOT NULL
      AND DATEDIFF(DAY, df.UpdatedAt, GETUTCDATE()) >= @DiasInactividad
    ORDER BY df.UpdatedAt ASC;
END;
GO

PRINT '   sp_ObtenerDocumentosParaHousekeeping creado';
GO

-- SP: Incrementar recordatorio
CREATE OR ALTER PROCEDURE [dbo].[sp_IncrementarRecordatorio]
    @DocumentoFirmaId INT,
    @Version INT
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE DocumentosFirma
    SET IntentosRecordatorio = IntentosRecordatorio + 1,
        UltimoRecordatorio = GETUTCDATE(),
        Version = Version + 1,
        UpdatedAt = GETUTCDATE()
    WHERE DocumentoFirmaId = @DocumentoFirmaId
      AND Version = @Version;

    IF @@ROWCOUNT = 0
        RAISERROR('Conflicto de concurrencia para documento: %d', 16, 2, @DocumentoFirmaId);

    SELECT Version FROM DocumentosFirma WHERE DocumentoFirmaId = @DocumentoFirmaId;
END;
GO

PRINT '   sp_IncrementarRecordatorio creado';
GO

-- SP: Actualizar reporte Teams
CREATE OR ALTER PROCEDURE [dbo].[sp_ActualizarReporteTeams]
    @DocumentoFirmaId INT,
    @Version INT
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE DocumentosFirma
    SET UltimoReporteTeams = GETUTCDATE(),
        Version = Version + 1,
        UpdatedAt = GETUTCDATE()
    WHERE DocumentoFirmaId = @DocumentoFirmaId
      AND Version = @Version;

    IF @@ROWCOUNT = 0
        RAISERROR('Conflicto de concurrencia para documento: %d', 16, 2, @DocumentoFirmaId);
END;
GO

PRINT '   sp_ActualizarReporteTeams creado';
GO

-- SP: Estadisticas de documentos (dashboard)
CREATE OR ALTER PROCEDURE [dbo].[sp_GetEstadisticasDocumentos]
    @FechaInicio DATETIME = NULL,
    @FechaFin DATETIME = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @FechaInicio IS NULL SET @FechaInicio = DATEADD(DAY, -30, GETDATE());
    IF @FechaFin IS NULL SET @FechaFin = GETDATE();

    -- Resumen por estado
    SELECT
        ed.Codigo AS Estado,
        ed.Nombre AS EstadoNombre,
        ed.Emoji,
        COUNT(df.DocumentoFirmaId) AS Total,
        ed.EsFinal
    FROM CatEstadoDocumento ed
    LEFT JOIN DocumentosFirma df ON ed.EstadoDocumentoId = df.EstadoDocumentoId
        AND df.FechaCreacion BETWEEN @FechaInicio AND @FechaFin
    WHERE ed.Activo = 1
    GROUP BY ed.Codigo, ed.Nombre, ed.Emoji, ed.EsFinal, ed.Orden
    ORDER BY ed.Orden;

    -- Resumen por tipo
    SELECT
        td.Codigo AS TipoDocumento,
        td.Nombre AS TipoDocumentoNombre,
        COUNT(df.DocumentoFirmaId) AS Total
    FROM CatTipoDocumento td
    LEFT JOIN DocumentosFirma df ON td.TipoDocumentoId = df.TipoDocumentoId
        AND df.FechaCreacion BETWEEN @FechaInicio AND @FechaFin
    WHERE td.Activo = 1
    GROUP BY td.Codigo, td.Nombre
    ORDER BY Total DESC;

    -- Tasa de firma
    SELECT
        COUNT(*) AS TotalDocumentos,
        SUM(CASE WHEN ed.Codigo = 'FIRMADO' THEN 1 ELSE 0 END) AS Firmados,
        SUM(CASE WHEN ed.Codigo = 'RECHAZADO' THEN 1 ELSE 0 END) AS Rechazados,
        SUM(CASE WHEN ed.Codigo = 'ANULADO' THEN 1 ELSE 0 END) AS Anulados,
        CAST(
            SUM(CASE WHEN ed.Codigo = 'FIRMADO' THEN 1 ELSE 0 END) * 100.0 /
            NULLIF(COUNT(*), 0)
        AS DECIMAL(5,2)) AS TasaFirma
    FROM DocumentosFirma df
    INNER JOIN CatEstadoDocumento ed ON df.EstadoDocumentoId = ed.EstadoDocumentoId
    WHERE df.FechaCreacion BETWEEN @FechaInicio AND @FechaFin;

    -- Documentos por dia
    SELECT
        CAST(FechaCreacion AS DATE) AS Fecha,
        COUNT(*) AS TotalRecibidos,
        SUM(CASE WHEN ed.Codigo = 'FIRMADO' THEN 1 ELSE 0 END) AS TotalFirmados
    FROM DocumentosFirma df
    INNER JOIN CatEstadoDocumento ed ON df.EstadoDocumentoId = ed.EstadoDocumentoId
    WHERE df.FechaCreacion BETWEEN @FechaInicio AND @FechaFin
    GROUP BY CAST(FechaCreacion AS DATE)
    ORDER BY Fecha;
END;
GO

PRINT '   sp_GetEstadisticasDocumentos creado';
GO

-- SP: Obtener documento activo por SapDocumentId (para reuso de envelope)
CREATE OR ALTER PROCEDURE [dbo].[sp_ObtenerDocumentoActivoPorSapId]
    @SapDocumentId NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP 1
        df.*,
        ed.Codigo AS EstadoDocumento,
        td.Codigo AS TipoDocumento
    FROM DocumentosFirma df
    INNER JOIN CatEstadoDocumento ed ON df.EstadoDocumentoId = ed.EstadoDocumentoId
    INNER JOIN CatTipoDocumento td ON df.TipoDocumentoId = td.TipoDocumentoId
    WHERE df.SapDocumentId = @SapDocumentId
      AND ed.EsFinal = 0
      AND df.EnvelopeId IS NOT NULL
    ORDER BY df.FechaCreacion DESC;
END;
GO

PRINT '   sp_ObtenerDocumentoActivoPorSapId creado';
GO

-- =============================================
-- PASO 14: CREAR VISTAS
-- =============================================

PRINT '';
PRINT 'Paso 14: Creando vistas...';
GO

CREATE OR ALTER VIEW [dbo].[vw_SesionesActivas]
AS
SELECT
    s.SesionId,
    s.Telefono,
    es.Codigo AS Estado,
    es.Nombre AS EstadoNombre,
    es.EsTerminal,
    s.DatosTemp,
    s.ContadorMensajes,
    s.AdvertenciaEnviada,
    s.FechaCreacion,
    s.UltimaActividad,
    s.NombreUsuario,
    DATEDIFF(MINUTE, s.UltimaActividad, GETDATE()) AS MinutosInactivo
FROM SesionesChat s
INNER JOIN CatEstadoSesion es ON s.EstadoId = es.EstadoId;
GO

CREATE OR ALTER VIEW [dbo].[vw_DocumentosFirma]
AS
SELECT
    df.DocumentoFirmaId,
    df.EnvelopeId,
    df.SapDocumentId,
    df.ClienteTelefono,
    df.ClienteNombre,
    df.ClienteEmail,
    td.Codigo AS TipoDocumento,
    td.Nombre AS TipoDocumentoNombre,
    ed.Codigo AS EstadoDocumento,
    ed.Nombre AS EstadoNombre,
    ed.Emoji AS EstadoEmoji,
    ed.EsFinal,
    df.DocumentoOriginalUrl,
    df.DocumentoFirmadoUrl,
    df.SigningUrl,
    df.FechaCreacion,
    df.FechaEnvioDocuSign,
    df.FechaEnvioWhatsApp,
    df.FechaVisto,
    df.FechaFirmado,
    df.FechaRechazo,
    df.MotivoRechazo,
    df.IntentosRecordatorio,
    df.UltimoRecordatorio,
    df.EnvelopeReutilizado,
    df.DocumentoAnteriorId,
    df.MensajeError,
    df.Version,
    df.CreatedAt,
    df.UpdatedAt,
    CASE
        WHEN df.FechaFirmado IS NOT NULL AND df.FechaEnvioWhatsApp IS NOT NULL
        THEN DATEDIFF(HOUR, df.FechaEnvioWhatsApp, df.FechaFirmado)
        ELSE NULL
    END AS HorasHastaFirma,
    CASE
        WHEN df.FechaEnvioWhatsApp IS NOT NULL AND df.FechaFirmado IS NULL AND ed.EsFinal = 0
        THEN DATEDIFF(HOUR, df.FechaEnvioWhatsApp, GETUTCDATE())
        ELSE NULL
    END AS HorasPendiente
FROM DocumentosFirma df
INNER JOIN CatEstadoDocumento ed ON df.EstadoDocumentoId = ed.EstadoDocumentoId
INNER JOIN CatTipoDocumento td ON df.TipoDocumentoId = td.TipoDocumentoId;
GO

PRINT '   2 vistas creadas (vw_SesionesActivas, vw_DocumentosFirma)';
GO

-- =============================================
-- VERIFICACION FINAL
-- =============================================

PRINT '';
PRINT '===============================================================';
PRINT '  INSTALACION COMPLETADA';
PRINT '===============================================================';
PRINT '';
GO

SELECT 'CatEstadoSesion' AS Tabla, COUNT(*) AS Registros FROM [dbo].[CatEstadoSesion]
UNION ALL SELECT 'CatEstadoDocumento', COUNT(*) FROM [dbo].[CatEstadoDocumento]
UNION ALL SELECT 'CatTipoDocumento', COUNT(*) FROM [dbo].[CatTipoDocumento]
UNION ALL SELECT 'SesionesChat', COUNT(*) FROM [dbo].[SesionesChat]
UNION ALL SELECT 'DocumentosFirma', COUNT(*) FROM [dbo].[DocumentosFirma]
UNION ALL SELECT 'HistorialSesiones', COUNT(*) FROM [dbo].[HistorialSesiones]
UNION ALL SELECT 'MensajesChat', COUNT(*) FROM [dbo].[MensajesChat]
UNION ALL SELECT 'MensajesProcessados', COUNT(*) FROM [dbo].[MensajesProcessados]
UNION ALL SELECT 'DeadLetterMessages', COUNT(*) FROM [dbo].[DeadLetterMessages]
UNION ALL SELECT 'EventosDocuSignProcessados', COUNT(*) FROM [dbo].[EventosDocuSignProcessados]
UNION ALL SELECT 'AuditEvents', COUNT(*) FROM [dbo].[AuditEvents];
GO

PRINT '';
PRINT 'Catalogos:';
PRINT '   - CatEstadoSesion: 8 estados';
PRINT '   - CatEstadoDocumento: 8 estados';
PRINT '   - CatTipoDocumento: 4 tipos';
PRINT '';
PRINT 'Tablas: SesionesChat, DocumentosFirma, HistorialSesiones,';
PRINT '        MensajesChat, MensajesProcessados, DeadLetterMessages,';
PRINT '        EventosDocuSignProcessados, AuditEvents';
PRINT '';
PRINT 'Stored Procedures: 18';
PRINT 'Vistas: 2 (vw_SesionesActivas, vw_DocumentosFirma)';
PRINT '';
PRINT '===============================================================';
GO
