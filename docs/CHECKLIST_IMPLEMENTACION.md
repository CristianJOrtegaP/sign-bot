# ✅ CHECKLIST DE IMPLEMENTACIÓN

## Progreso General

- [ ] **FASE 1: FIXES CRÍTICOS** (3-5 días)
- [ ] **FASE 2: ARQUITECTURA FLEXIBLE** (5-7 días)
- [ ] **FASE 3: TESTING** (2-3 días)
- [ ] **FASE 4: ROLLOUT** (3-5 días)

---

# FASE 1: FIXES CRÍTICOS 🔥

## 1.1 Optimistic Locking ⚡ PRIORIDAD MÁXIMA

### Setup
- [ ] Crear script SQL `sql-scripts/migrations/001_add_version_column.sql`
- [ ] Ejecutar migración en BD de desarrollo
- [ ] Verificar columna `Version` existe en tabla `SesionesChat`

### Código
- [ ] Crear `core/errors/ConcurrencyError.js`
- [ ] Modificar `SesionRepository.updateSession()` - agregar parámetro `expectedVersion`
- [ ] Crear método `SesionRepository.getSessionWithVersion()`
- [ ] Implementar retry logic en `messageHandler.js`

### Testing
- [ ] Test unitario: `updateSession()` con versión correcta → éxito
- [ ] Test unitario: `updateSession()` con versión incorrecta → ConcurrencyError
- [ ] Test integración: 2 webhooks concurrentes → uno falla y reintenta
- [ ] Verificar logs: debe mostrar `[ConcurrencyRetry] Intento X/3`

### Validación
- [ ] Simular 2 mensajes del mismo usuario en <100ms
- [ ] Verificar que NO hay reportes duplicados
- [ ] Verificar métricas en Application Insights

---

## 1.2 Deduplicación Idempotente ⚡ PRIORIDAD MÁXIMA

### Setup
- [ ] Crear script SQL `sql-scripts/migrations/create_mensajes_procesados.sql`
- [ ] Ejecutar migración en BD de desarrollo
- [ ] Verificar tabla `MensajesProcesados` existe

### Código
- [ ] Implementar `databaseService.registerMessageAtomic()`
- [ ] Crear función `checkAndRegisterMessage()` en webhook
- [ ] Reemplazar `checkDuplicates()` con nueva función
- [ ] Garantizar que siempre devuelve 200 OK

### Testing
- [ ] Test: Enviar mismo mensaje 3 veces → solo procesa 1 vez
- [ ] Test: Verificar que mensaje se guarda en `MensajesProcesados`
- [ ] Test: Verificar que reintentos incrementan contador `Reintentos`
- [ ] Test: Meta webhook retry → no duplica reporte

### Validación
- [ ] Simular reintentos de Meta (delay 5s entre mensajes iguales)
- [ ] Verificar que usuario ve mensaje en historial
- [ ] Verificar BD: solo 1 registro en tabla principal

---

## 1.3 Timeouts Explícitos en IA ⚡ ALTA

### Código
- [ ] Crear `core/utils/promises.js` con `withTimeout()`
- [ ] Crear `withTimeoutAndFallback()`
- [ ] Aplicar timeout en `intentService.detectIntent()` (3s)
- [ ] Aplicar timeout en `intentService.extractStructuredData()` (4s)
- [ ] Aplicar timeout en `messageHandler.handleText()` (5s)

### Testing
- [ ] Test: Mock IA con delay 10s → debe fallar con fallback
- [ ] Test: Verificar que no bloquea Azure Function
- [ ] Test: Verificar logs muestran "Timeout, usando fallback"

### Validación
- [ ] Load test: 50 req/s durante 2 min
- [ ] Verificar p95 latency < 2s
- [ ] Verificar que ninguna request tarda >5s

---

## 1.4 Circuit Breaker Fix 🟡 MEDIA

### Código
- [ ] Modificar `circuitBreaker.recordFailure()` - detectar HALF_OPEN
- [ ] Modificar `circuitBreaker.recordSuccess()` - reset correcto
- [ ] Agregar método `circuitBreaker.getState()` para observabilidad

### Testing
- [ ] Test: Simular fallo en HALF_OPEN → debe volver a OPEN
- [ ] Test: Verificar logs muestran "going back to OPEN"
- [ ] Test: Múltiples éxitos en HALF_OPEN → debe cerrar

### Validación
- [ ] Monitorear logs en producción
- [ ] Verificar transiciones de estado correctas

---

## 1.5 Promise.all Cleanup 🟡 MEDIA

### Código
- [ ] Cambiar `Promise.all` por `Promise.allSettled` en messageHandler
- [ ] Verificar status de cada promesa
- [ ] Agregar logs para errores de `saveMessage()`

### Testing
- [ ] Test: `saveMessage()` falla → continúa procesando
- [ ] Test: `getSession()` falla → rechaza request

---

# FASE 2: ARQUITECTURA FLEXIBLE 🚀

## 2.1 Migración de Base de Datos

- [ ] Crear `sql-scripts/migrations/002_add_flexible_flow_support.sql`
- [ ] Agregar estados `REFRIGERADOR_ACTIVO`, `VEHICULO_ACTIVO`
- [ ] Crear tabla `CamposExtraidosLog` (opcional)
- [ ] Crear view `vw_ProgresoSesiones` (opcional)
- [ ] Ejecutar migración en desarrollo
- [ ] Verificar en BD: nuevos estados existen

---

## 2.2 Field Extractor

- [ ] Crear `bot/services/fieldExtractor.js`
- [ ] Implementar `extractAllFields(text, tipoReporte, session, context)`
- [ ] Implementar `extractFieldsFromImage()` (opcional)
- [ ] Implementar `extractLocationField()`
- [ ] Tests: extraer SAP de "Mi refri ABC123 no enfría"
- [ ] Tests: extraer empleado de "Soy el 12345"
- [ ] Tests: extraer descripción con IA
- [ ] Tests: detectar confirmación "sí" / "ok"

---

## 2.3 Field Manager

- [ ] Crear `bot/services/fieldManager.js`
- [ ] Implementar `initializeCamposRequeridos(tipoReporte)`
- [ ] Implementar `mergeCampos(camposActuales, camposExtraidos)`
- [ ] Implementar `validarCampo(nombreCampo, valor, tipoReporte)`
- [ ] Implementar `getCamposFaltantes(campos)`
- [ ] Implementar `getProgresoCompletitud(campos)`
- [ ] Implementar `estaCompleto(campos)`
- [ ] Tests: merge campos sin conflicto
- [ ] Tests: validar SAP inválido → error
- [ ] Tests: validar SAP válido → busca en BD
- [ ] Tests: detectar campos faltantes correctamente

---

## 2.4 Flexible Flow Manager

- [ ] Crear `bot/controllers/flows/flexibleFlowManager.js`
- [ ] Implementar `processFlexibleFlow(from, text, session, context)`
- [ ] Implementar `pedirSiguienteCampo(from, campo, campos, tipoReporte)`
- [ ] Implementar `crearReporteRefrigerador(from, campos, context)`
- [ ] Implementar `crearReporteVehiculo(from, campos, context)`
- [ ] Tests: flujo completo refrigerador
- [ ] Tests: flujo completo vehículo
- [ ] Tests: datos en desorden

---

## 2.5 Integración messageHandler

- [ ] Agregar feature flag `FLEXIBLE_FLOWS_ENABLED`
- [ ] Modificar `handleText()` para detectar flujos activos
- [ ] Implementar `iniciarFlujoFlexible()`
- [ ] Mantener flujos legacy como fallback
- [ ] Tests: transición INICIO → REFRIGERADOR_ACTIVO
- [ ] Tests: procesar mensaje en REFRIGERADOR_ACTIVO

---

## 2.6 Actualizar Estados

- [ ] Modificar `bot/constants/sessionStates.js`
- [ ] Agregar estados flexibles
- [ ] Crear helper `esEstadoFlexible(estado)`
- [ ] Actualizar IDs en `ESTADO_ID`

---

## 2.7 Mensajes Contextuales

- [ ] Crear `MSG.FLEXIBLE` en `bot/constants/messages.js`
- [ ] Implementar `pedirSAP(tieneDescripcion)`
- [ ] Implementar `confirmarEquipo(equipo, descripcion)`
- [ ] Implementar `pedirDescripcion(tieneSAP)`
- [ ] Implementar `progresoReporte(progreso)`
- [ ] Implementar `resumenDatosCapturados(campos)`

---

## 2.8 Tests de Integración

- [ ] Crear `tests/integration/flexibleFlow.test.js`
- [ ] Test: Usuario da TODO en 1 mensaje
- [ ] Test: Usuario da datos en desorden
- [ ] Test: Usuario corrige datos
- [ ] Test: Validación falla en medio del flujo
- [ ] Test: Timeout de IA durante extracción

---

# FASE 3: TESTING 🧪

## 3.1 Tests Unitarios

- [ ] `fieldExtractor.test.js` - 10+ casos
- [ ] `fieldManager.test.js` - 15+ casos
- [ ] `flexibleFlowManager.test.js` - 20+ casos
- [ ] `optimisticLocking.test.js` - 5+ casos
- [ ] `deduplication.test.js` - 5+ casos
- [ ] `timeouts.test.js` - 5+ casos
- [ ] Cobertura de código >80%

---

## 3.2 Tests de Carga

- [ ] Crear `tests/load/flexible-flow-load.yml`
- [ ] Ejecutar load test: 10 usuarios/s durante 1 min
- [ ] Ejecutar load test: 50 usuarios/s durante 2 min
- [ ] Verificar p95 latency < 2s
- [ ] Verificar error rate < 1%
- [ ] Verificar BD no tiene deadlocks

---

## 3.3 Tests de Concurrencia

- [ ] Test: 2 mensajes simultáneos mismo usuario
- [ ] Test: 10 mensajes simultáneos diferentes usuarios
- [ ] Test: Spike de 100 mensajes en 5 segundos
- [ ] Verificar: 0 reportes duplicados
- [ ] Verificar: 0 race conditions

---

## 3.4 Monitoreo

- [ ] Configurar Application Insights queries
- [ ] Dashboard: Tasa de reintentos (optimistic locking)
- [ ] Dashboard: Tiempo de extracción de campos
- [ ] Dashboard: Campos extraídos por IA vs. Regex
- [ ] Dashboard: Mensajes promedio por reporte
- [ ] Alertas: Error rate > 2%
- [ ] Alertas: Latency p95 > 3s

---

# FASE 4: ROLLOUT 🚢

## 4.1 Feature Flags

- [ ] Configurar `FLEXIBLE_FLOWS_ENABLED=false` en prod
- [ ] Configurar `FLEXIBLE_FLOWS_ROLLOUT=0` en prod
- [ ] Agregar función `shouldUseFlexibleFlow(telefono)`
- [ ] Whitelist: agregar teléfonos de equipo interno

---

## 4.2 Canary Rollout (5%)

- [ ] Activar feature flag: `FLEXIBLE_FLOWS_ROLLOUT=5`
- [ ] Deploy a producción
- [ ] Monitorear durante 48 horas
- [ ] Verificar error rate < 1%
- [ ] Verificar p95 latency < 2s
- [ ] Recolectar feedback de usuarios

---

## 4.3 Early Adopters (25%)

- [ ] Aumentar rollout: `FLEXIBLE_FLOWS_ROLLOUT=25`
- [ ] Monitorear durante 72 horas
- [ ] Medir satisfacción del usuario (NPS)
- [ ] Verificar tasa de abandono < 10%
- [ ] Ajustar mensajes si hay confusión

---

## 4.4 Majority (50%)

- [ ] Aumentar rollout: `FLEXIBLE_FLOWS_ROLLOUT=50`
- [ ] Monitorear durante 72 horas
- [ ] Comparar métricas: flexible vs. legacy
- [ ] Verificar mejora en mensajes promedio
- [ ] Verificar mejora en tiempo promedio

---

## 4.5 Full Rollout (100%)

- [ ] Aumentar rollout: `FLEXIBLE_FLOWS_ROLLOUT=100`
- [ ] Monitorear durante 48 horas
- [ ] Verificar estabilidad
- [ ] Comunicar a stakeholders: "Flujo flexible live"
- [ ] Celebrar 🎉

---

## 4.6 Deprecar Flujos Legacy

- [ ] Esperar 2 semanas sin incidentes
- [ ] Analizar métricas finales
- [ ] Remover código legacy de `refrigeradorFlow.js`
- [ ] Remover código legacy de `vehiculoFlow.js`
- [ ] Remover estados legacy de BD (opcional)
- [ ] Actualizar documentación

---

# ROLLBACK PLAN 🔄

Si algo sale mal:

- [ ] Desactivar feature flag: `FLEXIBLE_FLOWS_ENABLED=false`
- [ ] Verificar que todos los flujos usan legacy
- [ ] Investigar logs de Application Insights
- [ ] Identificar root cause
- [ ] Fix en desarrollo
- [ ] Re-testear completamente
- [ ] Re-deploy y reiniciar rollout desde 5%

---

# MÉTRICAS DE ÉXITO 📊

Comparar antes/después:

| Métrica | Baseline | Target | Actual | ✅/❌ |
|---------|----------|--------|--------|-------|
| Mensajes promedio por reporte | 5-7 | 2-4 | ___ | ___ |
| Tiempo promedio (minutos) | 3-5 | 1-3 | ___ | ___ |
| Tasa de abandono (%) | 20 | <10 | ___ | ___ |
| Error rate (%) | 2-3 | <1 | ___ | ___ |
| Latency p95 (ms) | ??? | <2000 | ___ | ___ |
| Race conditions/día | 5-10 | 0 | ___ | ___ |
| User satisfaction (NPS) | ??? | >80 | ___ | ___ |

---

# NOTAS IMPORTANTES ⚠️

1. **NUNCA** hacer cambios directamente en producción
2. **SIEMPRE** testear en desarrollo primero
3. **SIEMPRE** hacer backup de BD antes de migración
4. **SIEMPRE** monitorear métricas después de cada deploy
5. **SIEMPRE** tener rollback plan listo

---

# CONTACTOS DE EMERGENCIA 📞

En caso de incident crítico en producción:

- [ ] DevOps: ___________________
- [ ] Database Admin: ___________________
- [ ] Product Owner: ___________________
- [ ] Stakeholder: ___________________

---

# CRONOGRAMA VISUAL

```
Semana 1:  [████████████░░░░░░░░░░░░] FASE 1
Semana 2:  [░░░░░░░░████████████░░░░] FASE 2
Semana 3:  [░░░░░░░░░░░░░░██████░░░░] FASE 2 + FASE 3
Semana 4:  [░░░░░░░░░░░░░░░░░░██████] FASE 4 (Rollout)
```

**Fecha de inicio:** _______________
**Fecha estimada de completion:** _______________
**Fecha real de completion:** _______________

---

# APROBACIONES

- [ ] Tech Lead: ___________________  Fecha: _____
- [ ] Product Owner: _______________ Fecha: _____
- [ ] Cliente: _____________________ Fecha: _____

---

¡Vamos a hacer esto! 🚀💪
