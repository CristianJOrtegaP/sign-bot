-- =============================================
-- AC FIXBOT - Agregar Estado de Consulta de Tickets
-- Version: 1.0
-- Fecha: 2026-02-03
-- =============================================
--
-- DESCRIPCION:
-- Agrega el nuevo estado CONSULTA_ESPERA_TICKET a la tabla CatEstadoSesion
-- para soportar el flujo de consulta de tickets existentes.
--
-- INSTRUCCIONES:
-- 1. Conectarse a Azure SQL Database
-- 2. Ejecutar este script
--
-- =============================================

USE [db-acfixbot];
GO

PRINT '';
PRINT '===============================================================';
PRINT '  AC FIXBOT - AGREGAR ESTADO DE CONSULTA DE TICKETS';
PRINT '  Version 1.0';
PRINT '===============================================================';
PRINT '';

-- Verificar si el estado ya existe
IF NOT EXISTS (SELECT 1 FROM [dbo].[CatEstadoSesion] WHERE [Codigo] = 'CONSULTA_ESPERA_TICKET')
BEGIN
    PRINT 'Agregando estado CONSULTA_ESPERA_TICKET...';

    INSERT INTO [dbo].[CatEstadoSesion] ([Codigo], [Nombre], [Descripcion], [EsTerminal], [Orden], [Activo])
    VALUES ('CONSULTA_ESPERA_TICKET', 'Esperando Ticket', 'Usuario consulta estado, esperando numero de ticket', 0, 50, 1);

    PRINT '   Estado CONSULTA_ESPERA_TICKET agregado correctamente';
END
ELSE
BEGIN
    PRINT '   Estado CONSULTA_ESPERA_TICKET ya existe, omitiendo...';
END
GO

PRINT '';
PRINT 'Migracion completada exitosamente!';
PRINT '';
GO
