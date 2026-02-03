# ADR-001: Decisiones Arquitectónicas

**Estado:** Aceptado
**Fecha:** 2026-01-27
**Autor:** Equipo AC FixBot

---

## Resumen

Este documento registra las decisiones arquitectónicas importantes tomadas durante el desarrollo del proyecto AC FixBot, incluyendo justificaciones y alternativas consideradas.

---

## ADR-001.1: No Implementar Redis Cache

### Contexto

Durante la planificación de la Fase 3 (Infraestructura Avanzada), se evaluó implementar Azure Cache for Redis para:
- Cache distribuido entre instancias
- Rate limiting distribuido
- Session state compartido
- Message queue para procesamiento asíncrono

### Decisión

**NO implementar Redis** en esta fase del proyecto.

### Justificación

#### 1. Costo vs. Volumen

| Métrica | Valor Actual |
|---------|--------------|
| Reportes/día | ~100 |
| Reportes/mes | ~3,000 |
| Mensajes/mes | ~21,000 |
| Costo Azure Cache for Redis (C0) | $16-25 USD/mes |
| Aumento % del costo total | +50-70% |

El costo de Redis representa un aumento significativo (~50%) sobre el costo base del proyecto (~$30-35/mes) para un volumen que no lo justifica.

#### 2. Arquitectura Azure Functions Consumption

- **Stateless por diseño**: Cada invocación es independiente
- **Scaling automático**: Azure maneja la concurrencia
- **Baja probabilidad de colisiones**: Con ~100 reportes/día, es raro que el mismo usuario envíe mensajes simultáneos a diferentes instancias

#### 3. Soluciones Implementadas (Sin Costo Adicional)

Ya se implementaron alternativas que cubren los casos de uso principales:

| Necesidad | Solución Implementada |
|-----------|----------------------|
| Cache de sesiones | In-memory cache con TTL en BaseRepository |
| Rate limiting | Memoria + Base de datos (doble verificación) |
| Deduplicación | MessageId en memoria + BD |
| Resiliencia | Circuit Breaker pattern |
| Reintentos | Exponential backoff con jitter |
| Mensajes fallidos | Dead Letter Queue en SQL |

#### 4. Umbrales para Reconsiderar

Implementar Redis cuando:
- **Volumen**: >500 reportes/día (~15,000/mes)
- **Concurrencia**: Múltiples instancias activas simultáneamente
- **Latencia**: Requerimiento de <100ms en cache
- **Session state**: Necesidad de compartir estado entre instancias en tiempo real

### Alternativas Consideradas

| Alternativa | Costo | Decisión |
|-------------|-------|----------|
| Azure Cache for Redis (C0) | $16-25/mes | Rechazado por costo |
| Redis Labs Free Tier | $0 (30MB) | Rechazado por límites y latencia |
| In-memory cache | $0 | **Implementado** |
| SQL como cache | $0 | **Implementado** para deduplicación |

### Consecuencias

**Positivas:**
- Ahorro de ~$200/año en costos de infraestructura
- Menor complejidad operativa
- Menos dependencias externas

**Negativas (Aceptables):**
- Cache no compartido entre instancias (mitigado por baja concurrencia)
- Rate limiting no 100% exacto entre instancias (aceptable para el volumen)

---

## ADR-001.2: Circuit Breaker Local vs. Distribuido

### Decisión

Implementar **Circuit Breaker en memoria** (no distribuido).

### Justificación

- En Azure Functions Consumption, cada instancia vive ~10-20 minutos
- El circuit breaker se "reinicia" naturalmente con cada nueva instancia
- Para el volumen actual, esto es aceptable
- Con Redis, se podría compartir estado del breaker entre instancias

### Implementación

```javascript
// core/services/infrastructure/circuitBreaker.js
const SERVICES = {
    WHATSAPP: 'whatsapp',
    GEMINI: 'gemini',
    AZURE_OPENAI: 'azure-openai',
    AZURE_VISION: 'azure-vision',
    DATABASE: 'database'
};
```

---

## ADR-001.3: Dead Letter Queue en SQL vs. Azure Service Bus

### Decisión

Implementar **Dead Letter Queue en Azure SQL** en lugar de Azure Service Bus.

### Justificación

| Criterio | Azure SQL | Azure Service Bus |
|----------|-----------|-------------------|
| Costo adicional | $0 (ya pagamos SQL) | $10-15/mes |
| Complejidad | Baja | Media |
| Durabilidad | Alta | Alta |
| Reintentos automáticos | Manual (SP) | Automático |
| Suficiente para volumen | Sí | Sobredimensionado |

### Implementación

```sql
-- sql-scripts/add-dead-letter-table.sql
CREATE TABLE DeadLetterMessages (
    DeadLetterId INT IDENTITY PRIMARY KEY,
    WhatsAppMessageId NVARCHAR(100),
    Telefono NVARCHAR(20),
    TipoMensaje NVARCHAR(20),
    Contenido NVARCHAR(MAX),
    ErrorMessage NVARCHAR(1000),
    RetryCount INT DEFAULT 0,
    MaxRetries INT DEFAULT 3,
    NextRetryAt DATETIME,
    Estado NVARCHAR(20) DEFAULT 'PENDING'
);
```

---

## ADR-001.4: Gemini vs. Azure OpenAI para IA

### Decisión

Soportar **ambos proveedores** con configuración flexible.

### Justificación

| Proveedor | Pros | Contras |
|-----------|------|---------|
| Gemini | Más barato, fácil de configurar, API key simple | Menos control enterprise |
| Azure OpenAI | Enterprise-ready, mismo tenant, compliance | Requiere solicitar acceso, más setup |

### Configuración

```javascript
// Configuración via variables de entorno
AI_PROVIDER=gemini    // o 'azure-openai'
USE_AI=true
```

---

## ADR-001.5: Application Insights Opcional

### Decisión

**No incluir** Application Insights por defecto para mantener costo cero.

### Justificación

- Costo: ~$2.30/GB de logs
- Para volumen actual, los logs de Azure Functions (gratis) son suficientes
- Correlation IDs ya implementados para tracing manual
- Se puede agregar fácilmente cuando sea necesario

### Alternativa Implementada

```javascript
// core/services/infrastructure/correlationService.js
// Tracing distribuido usando AsyncLocalStorage
const correlationId = correlation.generateCorrelationId();
context.log(`[${correlationId}] Mensaje procesado`);
```

---

## Historial de Revisiones

| Versión | Fecha | Cambios |
|---------|-------|---------|
| 1.0 | 2026-01-27 | Documento inicial con decisiones de Fase 3-4 |

---

## Referencias

- [ARQUITECTURA_Y_RECURSOS.md](./ARQUITECTURA_Y_RECURSOS.md) - Diagrama de arquitectura completo
- [Azure Cache for Redis Pricing](https://azure.microsoft.com/pricing/details/cache/)
- [Azure Functions Consumption Plan](https://docs.microsoft.com/azure/azure-functions/consumption-plan)
