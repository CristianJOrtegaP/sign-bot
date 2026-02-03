# 🚀 PROPUESTA: Flujo Conversacional Flexible (Form-Filling State Machine)

## Objetivo

Permitir que el usuario proporcione datos en **cualquier orden** durante un reporte, haciendo el chatbot más natural y fluido.

---

## Arquitectura Propuesta

### 1. Estados Simplificados

```javascript
// bot/constants/sessionStates.js - NUEVOS ESTADOS

const ESTADO = {
    // Estados terminales
    INICIO: 'INICIO',
    FINALIZADO: 'FINALIZADO',
    CANCELADO: 'CANCELADO',
    TIMEOUT: 'TIMEOUT',

    // Estados de flujo activo (form-filling)
    REFRIGERADOR_ACTIVO: 'REFRIGERADOR_ACTIVO',
    VEHICULO_ACTIVO: 'VEHICULO_ACTIVO',
    ENCUESTA_ACTIVA: 'ENCUESTA_ACTIVA',
    CONSULTA_ACTIVA: 'CONSULTA_ACTIVA'
};
```

**Ventajas:**
- ✅ Solo 4 estados activos vs. 11 anteriores
- ✅ Más fácil de mantener
- ✅ Más natural para el usuario

---

### 2. Modelo de Datos: Campos Requeridos

#### Refrigerador
```javascript
{
    tipoReporte: "REFRIGERADOR",
    camposRequeridos: {
        codigoSAP: {
            valor: null,
            completo: false,
            validado: false,
            equipoEncontrado: null  // Objeto equipo de BD
        },
        equipoConfirmado: {
            valor: false,
            completo: false
        },
        descripcion: {
            valor: null,
            completo: false
        },
        imagenUrl: {
            valor: null,
            completo: false,
            opcional: true  // Campo opcional
        }
    }
}
```

#### Vehículo
```javascript
{
    tipoReporte: "VEHICULO",
    camposRequeridos: {
        numeroEmpleado: {
            valor: null,
            completo: false,
            validado: false
        },
        codigoSAP: {
            valor: null,
            completo: false,
            validado: false
        },
        descripcion: {
            valor: null,
            completo: false
        },
        ubicacion: {
            valor: null,  // { latitud, longitud, direccion }
            completo: false
        }
    }
}
```

---

### 3. Extractor Universal de Campos

```javascript
// bot/services/fieldExtractor.js (NUEVO ARCHIVO)

/**
 * Extrae TODOS los campos posibles de un mensaje
 * Usa IA + Regex para detectar múltiples campos en un solo mensaje
 */
async function extractAllFields(text, tipoReporte, session) {
    const campos = {};

    if (tipoReporte === TIPO_REPORTE.REFRIGERADOR) {
        // Extraer código SAP (regex + IA)
        const sapMatch = text.match(/\b([A-Z0-9]{5,10})\b/i);
        if (sapMatch) {
            campos.codigoSAP = {
                valor: sapMatch[1],
                fuente: 'regex',
                confianza: 0.9
            };
        }

        // Extraer descripción del problema (IA)
        const descripcionIA = await aiService.extractProblema(text);
        if (descripcionIA && descripcionIA.length > 5) {
            campos.descripcion = {
                valor: descripcionIA,
                fuente: 'ia',
                confianza: 0.8
            };
        }

        // Detectar confirmación de equipo
        const confirmacionMatch = /^(s[ií]|ok|correcto|confirmo|exacto)/i.test(text);
        if (confirmacionMatch) {
            campos.equipoConfirmado = {
                valor: true,
                fuente: 'regex',
                confianza: 1.0
            };
        }
    }

    if (tipoReporte === TIPO_REPORTE.VEHICULO) {
        // Extraer número de empleado
        const empleadoMatch = text.match(/\b(\d{4,6})\b/);
        if (empleadoMatch) {
            campos.numeroEmpleado = {
                valor: empleadoMatch[1],
                fuente: 'regex',
                confianza: 0.85
            };
        }

        // Extraer código SAP vehículo
        const sapMatch = text.match(/\b([A-Z0-9]{5,10})\b/i);
        if (sapMatch) {
            campos.codigoSAP = {
                valor: sapMatch[1],
                fuente: 'regex',
                confianza: 0.9
            };
        }

        // Extraer descripción (IA)
        const descripcionIA = await aiService.extractProblema(text);
        if (descripcionIA && descripcionIA.length > 5) {
            campos.descripcion = {
                valor: descripcionIA,
                fuente: 'ia',
                confianza: 0.8
            };
        }
    }

    return campos;
}

module.exports = { extractAllFields };
```

---

### 4. Gestor de Campos (Field Manager)

```javascript
// bot/services/fieldManager.js (NUEVO ARCHIVO)

/**
 * Merge inteligente de campos extraídos con campos existentes
 * Prioriza campos con mayor confianza y más recientes
 */
function mergeCampos(camposActuales, camposExtraidos) {
    const merged = { ...camposActuales };

    for (const [campo, data] of Object.entries(camposExtraidos)) {
        // Si el campo NO está completo aún, actualizar
        if (!merged[campo]?.completo) {
            merged[campo] = {
                ...merged[campo],
                valor: data.valor,
                fuente: data.fuente,
                confianza: data.confianza,
                completo: false  // Aún necesita validación
            };
        }
    }

    return merged;
}

/**
 * Valida campos según reglas de negocio
 */
async function validarCampo(nombreCampo, valor, tipoReporte) {
    if (nombreCampo === 'codigoSAP') {
        const validation = validateSAPCode(valor);
        if (!validation.valid) {
            return { valido: false, error: 'Código SAP inválido' };
        }

        // Buscar equipo en BD
        const equipo = await db.getEquipoBySAP(validation.cleaned);
        if (!equipo) {
            return {
                valido: false,
                error: `Código ${valor} no encontrado en sistema`,
                sugerencia: 'Verifica el código o envía una foto del equipo'
            };
        }

        return {
            valido: true,
            valor: validation.cleaned,
            equipoEncontrado: equipo
        };
    }

    if (nombreCampo === 'numeroEmpleado') {
        const validation = validateEmployeeNumber(valor);
        return validation.valid
            ? { valido: true, valor: validation.cleaned }
            : { valido: false, error: 'Número de empleado inválido (4-6 dígitos)' };
    }

    if (nombreCampo === 'descripcion') {
        if (valor.length < 5) {
            return { valido: false, error: 'Descripción muy corta (mínimo 5 caracteres)' };
        }
        return { valido: true, valor: sanitizeDescription(valor) };
    }

    if (nombreCampo === 'ubicacion') {
        if (!valor.latitude || !valor.longitude) {
            return { valido: false, error: 'Ubicación inválida' };
        }
        return { valido: true, valor };
    }

    return { valido: true, valor };
}

/**
 * Obtiene los campos faltantes para completar el reporte
 */
function getCamposFaltantes(campos) {
    const faltantes = [];

    for (const [nombre, data] of Object.entries(campos)) {
        // Saltar campos opcionales
        if (data.opcional) continue;

        if (!data.completo) {
            faltantes.push({
                nombre,
                prioridad: getPrioridad(nombre),
                tieneValor: !!data.valor
            });
        }
    }

    // Ordenar por prioridad (campos sin valor primero)
    return faltantes
        .sort((a, b) => {
            if (a.tieneValor !== b.tieneValor) {
                return a.tieneValor ? 1 : -1;  // Sin valor primero
            }
            return a.prioridad - b.prioridad;
        })
        .map(f => f.nombre);
}

function getPrioridad(nombreCampo) {
    // Orden de prioridad para pedir campos
    const prioridades = {
        // Refrigerador
        'codigoSAP': 1,
        'equipoConfirmado': 2,
        'descripcion': 3,

        // Vehículo
        'numeroEmpleado': 1,
        'codigoSAP': 2,
        'descripcion': 3,
        'ubicacion': 4
    };

    return prioridades[nombreCampo] || 99;
}

module.exports = {
    mergeCampos,
    validarCampo,
    getCamposFaltantes
};
```

---

### 5. Flujo Principal (Refactorizado)

```javascript
// bot/controllers/flows/flexibleFlowManager.js (NUEVO)

const fieldExtractor = require('../../services/fieldExtractor');
const fieldManager = require('../../services/fieldManager');

/**
 * Procesa mensaje en flujo activo con form-filling
 */
async function processFlexibleFlow(from, text, session, context) {
    const datosTemp = safeParseJSON(session.DatosTemp);
    const tipoReporte = datosTemp.tipoReporte;
    const estado = session.Estado;

    // Solo procesar si está en flujo activo
    if (!['REFRIGERADOR_ACTIVO', 'VEHICULO_ACTIVO'].includes(estado)) {
        return false;
    }

    context.log(`[FlexibleFlow] Procesando mensaje en ${estado}`);

    // 1. Extraer TODOS los campos posibles del mensaje
    const camposExtraidos = await fieldExtractor.extractAllFields(
        text,
        tipoReporte,
        session
    );

    context.log(`[FlexibleFlow] Campos extraídos:`, camposExtraidos);

    // 2. Merge con campos actuales
    let camposActualizados = fieldManager.mergeCampos(
        datosTemp.camposRequeridos,
        camposExtraidos
    );

    // 3. Validar cada campo extraído
    for (const [nombreCampo, data] of Object.entries(camposExtraidos)) {
        const validacion = await fieldManager.validarCampo(
            nombreCampo,
            data.valor,
            tipoReporte
        );

        if (validacion.valido) {
            camposActualizados[nombreCampo].completo = true;
            camposActualizados[nombreCampo].valor = validacion.valor;

            // Guardar datos adicionales (ej: equipo encontrado)
            if (validacion.equipoEncontrado) {
                camposActualizados[nombreCampo].equipoEncontrado = validacion.equipoEncontrado;
            }

            context.log(`✅ Campo ${nombreCampo} completado: ${validacion.valor}`);
        } else {
            // Informar error de validación al usuario
            await whatsapp.sendText(from, validacion.error);
            if (validacion.sugerencia) {
                await whatsapp.sendText(from, `💡 ${validacion.sugerencia}`);
            }

            // Actualizar sesión y salir (esperar corrección)
            await db.updateSession(
                from,
                estado,
                { ...datosTemp, camposRequeridos: camposActualizados },
                null,
                ORIGEN_ACCION.BOT,
                `Validación fallida: ${nombreCampo}`
            );
            return true;
        }
    }

    // 4. Actualizar sesión con campos actualizados
    await db.updateSession(
        from,
        estado,
        { ...datosTemp, camposRequeridos: camposActualizados },
        null,
        ORIGEN_ACCION.BOT,
        `Campos actualizados`
    );

    // 5. Verificar si está completo
    const camposFaltantes = fieldManager.getCamposFaltantes(camposActualizados);

    if (camposFaltantes.length === 0) {
        // ✅ TODOS LOS CAMPOS COMPLETOS - Crear reporte
        context.log(`[FlexibleFlow] ✅ Todos los campos completos, creando reporte`);

        if (tipoReporte === TIPO_REPORTE.REFRIGERADOR) {
            await crearReporteRefrigerador(from, camposActualizados, context);
        } else if (tipoReporte === TIPO_REPORTE.VEHICULO) {
            await crearReporteVehiculo(from, camposActualizados, context);
        }
    } else {
        // ⏳ FALTAN CAMPOS - Pedir siguiente
        context.log(`[FlexibleFlow] Campos faltantes: ${camposFaltantes.join(', ')}`);
        await pedirSiguienteCampo(from, camposFaltantes[0], camposActualizados, tipoReporte);
    }

    return true;
}

/**
 * Pide el siguiente campo faltante de forma natural
 */
async function pedirSiguienteCampo(from, nombreCampo, campos, tipoReporte) {
    // Generar mensaje contextual según qué campos ya tenemos
    let mensaje = '';

    if (tipoReporte === TIPO_REPORTE.REFRIGERADOR) {
        if (nombreCampo === 'codigoSAP') {
            mensaje = '📝 ¿Cuál es el código SAP del refrigerador?\n\n' +
                      'Lo encuentras en una etiqueta en el equipo (5-10 caracteres).';
        } else if (nombreCampo === 'equipoConfirmado') {
            const equipo = campos.codigoSAP.equipoEncontrado;
            mensaje = `🔍 Encontré este equipo:\n\n` +
                      `📍 Ubicación: ${equipo.Ubicacion}\n` +
                      `🏢 Cliente: ${equipo.ClienteNombre}\n\n` +
                      `¿Es correcto?`;
        } else if (nombreCampo === 'descripcion') {
            mensaje = '📝 ¿Qué problema tiene el refrigerador?\n\n' +
                      'Descríbelo brevemente (ej: "no enfría", "hace ruido", etc.)';
        }
    }

    if (tipoReporte === TIPO_REPORTE.VEHICULO) {
        if (nombreCampo === 'numeroEmpleado') {
            mensaje = '👤 ¿Cuál es tu número de empleado?\n\n' +
                      '(4-6 dígitos)';
        } else if (nombreCampo === 'codigoSAP') {
            mensaje = '🚗 ¿Cuál es el código SAP del vehículo?\n\n' +
                      'Ejemplo: VH1234';
        } else if (nombreCampo === 'descripcion') {
            mensaje = '📝 ¿Qué problema tiene el vehículo?';
        } else if (nombreCampo === 'ubicacion') {
            mensaje = '📍 Por favor envía tu ubicación actual.\n\n' +
                      'Usa el botón de ubicación 📎 de WhatsApp.';
        }
    }

    await whatsapp.sendInteractiveMessage(
        from,
        '📋 Completemos el reporte',
        mensaje,
        [MSG.BUTTONS.CANCELAR]
    );
}

/**
 * Crea el reporte de refrigerador
 */
async function crearReporteRefrigerador(from, campos, context) {
    const equipo = campos.codigoSAP.equipoEncontrado;
    const descripcion = campos.descripcion.valor;
    const imagenUrl = campos.imagenUrl?.valor || null;

    const numeroTicket = await db.createReporte(
        equipo.EquipoId,
        equipo.ClienteId,
        from,
        descripcion,
        imagenUrl
    );

    // Finalizar sesión
    await db.updateSession(
        from,
        ESTADO.FINALIZADO,
        null,
        null,
        ORIGEN_ACCION.BOT,
        `Reporte creado: ${numeroTicket}`
    );

    const mensaje = MSG.REFRIGERADOR.reporteCreado(numeroTicket, equipo, descripcion);
    await whatsapp.sendText(from, mensaje);
}

/**
 * Crea el reporte de vehículo
 */
async function crearReporteVehiculo(from, campos, context) {
    const numeroEmpleado = campos.numeroEmpleado.valor;
    const codigoSAP = campos.codigoSAP.valor;
    const descripcion = campos.descripcion.valor;
    const ubicacion = campos.ubicacion.valor;

    // Calcular centro más cercano y tiempo
    const centroMasCercano = await CentroServicioRepository.findNearest(
        ubicacion.latitude,
        ubicacion.longitude
    );

    const numeroTicket = await db.createReporteVehiculo(
        codigoSAP,
        numeroEmpleado,
        from,
        descripcion,
        null,
        ubicacion,
        centroMasCercano?.CentroServicioId,
        centroMasCercano?.tiempoEstimadoMin,
        centroMasCercano?.DistanciaKm
    );

    // Finalizar sesión
    await db.updateSession(
        from,
        ESTADO.FINALIZADO,
        null,
        null,
        ORIGEN_ACCION.BOT,
        `Reporte vehículo creado: ${numeroTicket}`
    );

    const mensaje = MSG.VEHICULO.reporteCreado(
        numeroTicket,
        codigoSAP,
        numeroEmpleado,
        descripcion,
        ubicacion,
        centroMasCercano
    );
    await whatsapp.sendText(from, mensaje);
}

module.exports = {
    processFlexibleFlow,
    pedirSiguienteCampo,
    crearReporteRefrigerador,
    crearReporteVehiculo
};
```

---

### 6. Integración con messageHandler

```javascript
// bot/controllers/messageHandler.js - MODIFICACIÓN

const flexibleFlowManager = require('./flows/flexibleFlowManager');

async function handleText(from, text, context) {
    // ... código existente ...

    // Obtener sesión
    const session = await db.getSession(from);

    // Si está en estado terminal, detectar intención
    if (esEstadoTerminal(session.Estado)) {
        const intent = await detectIntent(text);

        if (intent === 'REFRIGERADOR' || intent === 'VEHICULO') {
            // Iniciar flujo flexible
            await iniciarFlujoFlexible(from, intent, text, context);
            return;
        }
    }

    // Si está en flujo activo, procesar con form-filling
    if (['REFRIGERADOR_ACTIVO', 'VEHICULO_ACTIVO'].includes(session.Estado)) {
        await flexibleFlowManager.processFlexibleFlow(from, text, session, context);
        return;
    }

    // Fallback: flujo antiguo (encuestas, consultas)
    await FlowManager.processSessionState(from, text, session, context);
}

async function iniciarFlujoFlexible(from, tipoReporte, mensajeInicial, context) {
    context.log(`[FlexibleFlow] Iniciando flujo ${tipoReporte}`);

    // Crear estructura de campos según tipo
    let camposRequeridos = {};

    if (tipoReporte === TIPO_REPORTE.REFRIGERADOR) {
        camposRequeridos = {
            codigoSAP: { valor: null, completo: false },
            equipoConfirmado: { valor: null, completo: false },
            descripcion: { valor: null, completo: false },
            imagenUrl: { valor: null, completo: false, opcional: true }
        };
    } else if (tipoReporte === TIPO_REPORTE.VEHICULO) {
        camposRequeridos = {
            numeroEmpleado: { valor: null, completo: false },
            codigoSAP: { valor: null, completo: false },
            descripcion: { valor: null, completo: false },
            ubicacion: { valor: null, completo: false }
        };
    }

    // Cambiar a estado activo
    await db.updateSession(
        from,
        tipoReporte === TIPO_REPORTE.REFRIGERADOR
            ? ESTADO.REFRIGERADOR_ACTIVO
            : ESTADO.VEHICULO_ACTIVO,
        {
            tipoReporte,
            camposRequeridos
        },
        null,
        ORIGEN_ACCION.BOT,
        `Flujo flexible ${tipoReporte} iniciado`
    );

    // Procesar el mensaje inicial (puede ya contener datos)
    const session = await db.getSessionFresh(from);
    await flexibleFlowManager.processFlexibleFlow(from, mensajeInicial, session, context);
}
```

---

## Ejemplos de Conversaciones

### Ejemplo 1: Usuario da TODO de una vez

```
Usuario: "Mi refrigerador ABC123 no enfría bien"

Bot extrae:
- codigoSAP: "ABC123" ✅
- descripcion: "no enfría bien" ✅

Bot busca equipo ABC123 → encontrado ✅

Bot: "🔍 Encontré este equipo:
      📍 Ubicación: Sucursal Centro
      🏢 Cliente: Oxxo

      ¿Es correcto?"

Usuario: "Sí"

Bot: "✅ Reporte #12345 creado exitosamente.
      Un técnico te contactará pronto."
```

### Ejemplo 2: Usuario da datos en desorden

```
Usuario: "Tengo un problema"

Bot: "¿Qué tipo de equipo?
      1️⃣ Refrigerador
      2️⃣ Vehículo"

Usuario: "Refrigerador"

Bot: "📝 ¿Cuál es el código SAP del refrigerador?"

Usuario: "No enfría bien"  ← Da descripción en vez de SAP

Bot extrae:
- descripcion: "no enfría bien" ✅

Bot: "👍 Entendido, el problema es 'no enfría bien'.

      📝 ¿Cuál es el código SAP del refrigerador?"

Usuario: "ABC123"

Bot extrae:
- codigoSAP: "ABC123" ✅

Bot busca equipo → encontrado ✅

Bot: "🔍 Encontré este equipo:
      📍 Ubicación: Sucursal Centro

      ¿Es correcto?"

Usuario: "Sí"

Bot: "✅ Reporte #12346 creado."
```

### Ejemplo 3: Usuario da múltiples datos mezclados

```
Usuario: "Vehículo V1234 no enciende, soy empleado 54321"

Bot extrae:
- codigoSAP: "V1234" ✅
- descripcion: "no enciende" ✅
- numeroEmpleado: "54321" ✅

Bot: "👍 Perfecto, tengo:
      🚗 Vehículo: V1234
      👤 Empleado: 54321
      📝 Problema: no enciende

      📍 Por favor envía tu ubicación actual."

Usuario: [envía ubicación]

Bot: "✅ Reporte #12347 creado.
      🚗 Técnico llegará en ~25 minutos."
```

---

## Ventajas de Esta Arquitectura

### ✅ Para el Usuario:
1. **Conversación natural:** Puede hablar como lo haría con un humano
2. **Menos pasos:** Si da todo de una vez, se crea el reporte inmediatamente
3. **Flexible:** Puede corregir o agregar datos en cualquier momento
4. **Menos frustrante:** No tiene que seguir un script rígido

### ✅ Para el Desarrollo:
1. **Menos estados:** 4 estados vs. 11 anteriores
2. **Más mantenible:** Lógica centralizada en `fieldManager`
3. **Extensible:** Agregar nuevos campos es trivial
4. **Testeable:** Cada función tiene responsabilidad única

### ✅ Para el Negocio:
1. **Mayor satisfacción:** UX más natural
2. **Más rápido:** Menos mensajes = menos tiempo
3. **Menos abandono:** Usuarios no se frustran con pasos rígidos

---

## Migración Gradual

### Fase 1: Implementar sin romper existente
```javascript
// messageHandler.js
if (FEATURE_FLAGS.FLEXIBLE_FLOWS_ENABLED) {
    await flexibleFlowManager.processFlexibleFlow(...);
} else {
    await FlowManager.processSessionState(...);  // Flujo antiguo
}
```

### Fase 2: A/B Testing
- 50% de usuarios usan flujo flexible
- 50% usa flujo antiguo
- Medir: tiempo promedio, abandono, satisfacción

### Fase 3: Rollout completo
- Migrar todos los usuarios
- Deprecar estados antiguos

---

## Consideraciones

### ⚠️ Complejidad de IA
- Extracción de múltiples campos requiere IA robusta
- Puede haber falsos positivos (extraer código SAP donde no hay)
- **Solución:** Validar siempre antes de marcar campo como completo

### ⚠️ Confirmaciones Ambiguas
Usuario: "Sí" → ¿Confirma qué?
- **Solución:** Siempre mostrar contexto en mensajes

### ⚠️ Campos Conflictivos
Usuario: "ABC123" → ¿Es empleado o código SAP?
- **Solución:** Priorizar por contexto del flujo activo

---

## Siguiente Paso

¿Quieres que implemente esta arquitectura en tu código actual?

Puedo:
1. Crear los nuevos archivos (`fieldExtractor.js`, `fieldManager.js`, `flexibleFlowManager.js`)
2. Refactorizar `messageHandler.js` para integrar
3. Crear tests unitarios para cada componente
4. Documentar con ejemplos

¿Procedemos? 🚀
