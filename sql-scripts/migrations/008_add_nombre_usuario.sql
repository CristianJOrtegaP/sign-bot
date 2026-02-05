-- =============================================
-- MIGRACION 008: Agregar columna NombreUsuario a SesionesChat
-- AC FIXBOT - Almacena el nombre de perfil de WhatsApp del usuario
-- Fecha: 2026-02-05
-- =============================================

PRINT '';
PRINT '===============================================================';
PRINT '  MIGRACION 008: NombreUsuario en SesionesChat';
PRINT '===============================================================';
PRINT '';

-- =============================================
-- PASO 1: AGREGAR COLUMNA NombreUsuario
-- =============================================

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME = 'SesionesChat' AND COLUMN_NAME = 'NombreUsuario')
BEGIN
    PRINT '   [1] Agregando columna NombreUsuario a SesionesChat...';
    ALTER TABLE [dbo].[SesionesChat] ADD [NombreUsuario] NVARCHAR(200) NULL;
    PRINT '   OK Columna NombreUsuario agregada';
END
ELSE
BEGIN
    PRINT '   Columna NombreUsuario ya existe';
END
GO

-- =============================================
-- VERIFICACION FINAL
-- =============================================

PRINT '';
PRINT '   Verificando columna:';

IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_NAME = 'SesionesChat' AND COLUMN_NAME = 'NombreUsuario')
BEGIN
    PRINT '   OK Columna NombreUsuario existe';
END
ELSE
BEGIN
    PRINT '   ERROR: Columna NombreUsuario no fue creada';
    RAISERROR('Migracion fallida: columna no fue creada', 16, 1);
END
GO

PRINT '';
PRINT '===============================================';
PRINT '  MIGRACION 008 COMPLETADA';
PRINT '===============================================';
PRINT '';
PRINT 'Cambios realizados:';
PRINT '  - Columna NombreUsuario (NVARCHAR 200) en SesionesChat';
PRINT '';
PRINT 'Uso:';
PRINT '  - Se extrae del payload de WhatsApp: contacts[0].profile.name';
PRINT '  - Se muestra en el dashboard junto con el telefono enmascarado';
PRINT '';
GO
