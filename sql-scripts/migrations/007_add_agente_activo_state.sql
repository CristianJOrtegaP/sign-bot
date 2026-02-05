-- =============================================
-- MIGRACION 007: Agregar estado AGENTE_ACTIVO y soporte para handoff
-- AC FIXBOT - Sistema de transferencia a agente humano
-- Fecha: 2026-02-04
-- =============================================

PRINT '';
PRINT '===============================================================';
PRINT '  MIGRACION 007: Estado AGENTE_ACTIVO y Handoff';
PRINT '===============================================================';
PRINT '';

-- =============================================
-- PASO 1: AGREGAR ESTADO AGENTE_ACTIVO
-- =============================================

IF NOT EXISTS (SELECT 1 FROM [dbo].[CatEstadoSesion] WHERE [Codigo] = 'AGENTE_ACTIVO')
BEGIN
    PRINT '   [1] Agregando estado AGENTE_ACTIVO...';

    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] ON;

    INSERT INTO [dbo].[CatEstadoSesion]
        ([EstadoId], [Codigo], [Nombre], [Descripcion], [EsTerminal], [Orden], [Activo])
    VALUES
        (28, 'AGENTE_ACTIVO', 'Atención por Agente',
         'Conversación tomada por un agente humano. El bot no procesa mensajes.',
         0, 28, 1);

    SET IDENTITY_INSERT [dbo].[CatEstadoSesion] OFF;

    PRINT '   OK Estado AGENTE_ACTIVO agregado con ID: 28';
END
ELSE
BEGIN
    PRINT '   Estado AGENTE_ACTIVO ya existe';
END
GO

-- =============================================
-- PASO 2: AGREGAR COLUMNAS PARA AGENTE EN SesionesChat
-- =============================================

-- Columna para ID del agente que tomó la conversación
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME = 'SesionesChat' AND COLUMN_NAME = 'AgenteId')
BEGIN
    PRINT '   [2] Agregando columna AgenteId a SesionesChat...';
    ALTER TABLE [dbo].[SesionesChat] ADD [AgenteId] NVARCHAR(100) NULL;
    PRINT '   OK Columna AgenteId agregada';
END
ELSE
BEGIN
    PRINT '   Columna AgenteId ya existe';
END
GO

-- Columna para nombre del agente
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME = 'SesionesChat' AND COLUMN_NAME = 'AgenteNombre')
BEGIN
    PRINT '   [3] Agregando columna AgenteNombre a SesionesChat...';
    ALTER TABLE [dbo].[SesionesChat] ADD [AgenteNombre] NVARCHAR(200) NULL;
    PRINT '   OK Columna AgenteNombre agregada';
END
ELSE
BEGIN
    PRINT '   Columna AgenteNombre ya existe';
END
GO

-- Columna para fecha en que el agente tomó la conversación
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME = 'SesionesChat' AND COLUMN_NAME = 'FechaTomaAgente')
BEGIN
    PRINT '   [4] Agregando columna FechaTomaAgente a SesionesChat...';
    ALTER TABLE [dbo].[SesionesChat] ADD [FechaTomaAgente] DATETIME NULL;
    PRINT '   OK Columna FechaTomaAgente agregada';
END
ELSE
BEGIN
    PRINT '   Columna FechaTomaAgente ya existe';
END
GO

-- =============================================
-- PASO 3: AGREGAR COLUMNA PARA IDENTIFICAR MENSAJES DE AGENTE
-- =============================================

-- Agregar tipo 'A' (Agente) a MensajesChat si la columna Tipo lo permite
-- Ya existe 'U' (Usuario) y 'B' (Bot)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME = 'MensajesChat' AND COLUMN_NAME = 'AgenteId')
BEGIN
    PRINT '   [5] Agregando columna AgenteId a MensajesChat...';
    ALTER TABLE [dbo].[MensajesChat] ADD [AgenteId] NVARCHAR(100) NULL;
    PRINT '   OK Columna AgenteId agregada a MensajesChat';
END
ELSE
BEGIN
    PRINT '   Columna AgenteId en MensajesChat ya existe';
END
GO

-- =============================================
-- PASO 4: CREAR INDICE PARA BUSCAR SESIONES CON AGENTE
-- =============================================

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SesionesChat_AgenteId')
BEGIN
    PRINT '   [6] Creando indice IX_SesionesChat_AgenteId...';
    CREATE NONCLUSTERED INDEX [IX_SesionesChat_AgenteId]
    ON [dbo].[SesionesChat] ([AgenteId])
    WHERE [AgenteId] IS NOT NULL;
    PRINT '   OK Indice creado';
END
ELSE
BEGIN
    PRINT '   Indice IX_SesionesChat_AgenteId ya existe';
END
GO

-- =============================================
-- VERIFICACION FINAL
-- =============================================

PRINT '';
PRINT '   Verificando estado:';

DECLARE @EstadoAgente INT;
SELECT @EstadoAgente = [EstadoId]
FROM [dbo].[CatEstadoSesion]
WHERE [Codigo] = 'AGENTE_ACTIVO';

IF @EstadoAgente IS NOT NULL
BEGIN
    PRINT '   OK Estado AGENTE_ACTIVO existe con ID: ' + CAST(@EstadoAgente AS VARCHAR);
END
ELSE
BEGIN
    PRINT '   ERROR: Estado AGENTE_ACTIVO no fue creado';
    RAISERROR('Migracion fallida: estado no fue creado', 16, 1);
END
GO

PRINT '';
PRINT '===============================================';
PRINT '  MIGRACION 007 COMPLETADA';
PRINT '===============================================';
PRINT '';
PRINT 'Cambios realizados:';
PRINT '  - Estado AGENTE_ACTIVO (ID: 28)';
PRINT '  - Columna AgenteId en SesionesChat';
PRINT '  - Columna AgenteNombre en SesionesChat';
PRINT '  - Columna FechaTomaAgente en SesionesChat';
PRINT '  - Columna AgenteId en MensajesChat';
PRINT '  - Indice IX_SesionesChat_AgenteId';
PRINT '';
PRINT 'Uso:';
PRINT '  - Cuando un agente toma una conversacion:';
PRINT '    UPDATE SesionesChat SET Estado=''AGENTE_ACTIVO'',';
PRINT '    AgenteId=@id, AgenteNombre=@nombre, FechaTomaAgente=GETDATE()';
PRINT '  - Para devolver al bot:';
PRINT '    UPDATE SesionesChat SET Estado=''INICIO'',';
PRINT '    AgenteId=NULL, AgenteNombre=NULL, FechaTomaAgente=NULL';
PRINT '';
GO
