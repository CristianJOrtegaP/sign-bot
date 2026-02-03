# Guía de Contribución

## Workflow de Desarrollo

### 1. Nunca hacer push directo a `main`

Siempre usa Pull Requests:

\`\`\`bash
# Crear nueva rama
git checkout -b feature/mi-feature

# Hacer cambios y commit
git add .
git commit -m "feat: descripción del cambio"

# Push de la rama
git push origin feature/mi-feature

# Crear PR en GitHub
gh pr create --title "Feature: Mi feature" --body "Descripción detallada"
\`\`\`

### 2. Antes de hacer merge

Verificar que los checks de GitHub Actions pasen:
- ✅ Tests unitarios e integración
- ✅ Linting (ESLint)
- ✅ Análisis de seguridad (npm audit)
- ✅ Build verification

### 3. Commits

Usar conventional commits:
- \`feat:\` - Nueva funcionalidad
- \`fix:\` - Bug fix
- \`docs:\` - Cambios en documentación
- \`test:\` - Agregar o modificar tests
- \`refactor:\` - Refactorización de código
- \`ci:\` - Cambios en CI/CD
- \`chore:\` - Mantenimiento

### 4. Pull Requests

- Título descriptivo
- Descripción detallada de cambios
- Referenciar issues relacionados
- Esperar aprobación antes de merge

## Tests

Ejecutar tests localmente antes de push:

\`\`\`bash
npm test                    # Todos los tests
npm run test:coverage       # Tests con coverage
npm run lint                # Linting
npm run format:check        # Verificar formato
\`\`\`

## CI/CD

Los workflows automáticos se ejecutan en:
- Cada push a `main` o `develop`
- Cada Pull Request
- Deploys manuales (workflow_dispatch)
- Releases (tags)
