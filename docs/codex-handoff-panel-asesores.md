# Handoff Codex - Panel asesores UCEMAX

Ultima actualizacion: 2026-08-19

Este documento es para pasar el mantenimiento del panel a otra persona que use Codex. La idea es que pueda abrir este archivo junto con el repositorio, entender que se hizo, que tocar para cambios frecuentes, como validar contra Salesforce y como publicar en Render.

## Accesos necesarios

La persona que tome el mantenimiento deberia tener acceso a:

- GitHub repo: `https://github.com/Yohe17/salesforce-dashboard-mvp`
- Render service: `https://salesforce-dashboard-mvp.onrender.com/`
- Salesforce UCEMA prod: `https://ucema2.my.salesforce.com`
- Asana, proyecto `Mantenimiento UCEMA`, si va a revisar tickets funcionales.

No compartir secretos por chat ni en el repo. Las variables sensibles deben quedar solo en Render o en un `.env` local no versionado.

## Que es este panel

Es un dashboard privado para UCEMAX que calcula y muestra:

- Consultas
- Solicitudes
- Tasa de conversion
- Objetivo general de solicitudes
- Segmentacion por asesor
- Segmentacion por programa
- Detalle por asesor
- Detalle por programa
- Comparativo historico de solicitudes por programa
- Muestras recientes de consultas y solicitudes

Formula principal:

```txt
Tasa de conversion = Solicitudes / Consultas * 100
```

Objetivo general actual:

```txt
7500 solicitudes
```

El objetivo se muestra como barra de progreso debajo de los KPIs principales.

## Arquitectura

Archivos principales:

- `server.js`
  Servidor Node.js. Maneja login, sesiones, OAuth, client credentials, queries a Salesforce y armado del payload del dashboard.

- `config/dashboard.config.json`
  Configuracion funcional del dashboard: objetos Salesforce, campos, filtros de asesores, objetivo general y opciones forzadas de selectores.

- `public/index.html`
  Estructura visual del panel.

- `public/app.js`
  Render del dashboard en navegador, filtros, recalculo del panel en cliente, KPIs, tablas y barras.

- `public/styles.css`
  Estilos del panel.

- `.env.example`
  Ejemplo de variables de entorno necesarias.

- `README.md`
  Resumen corto del proyecto.

## Flujo de autenticacion y datos

El panel usa dos mecanismos:

1. Login del usuario final
   - Salesforce My Domain + SSO Microsoft.
   - Endpoint del panel: `/auth/login` y `/auth/callback`.

2. Consulta de datos
   - Se realiza con el usuario de integracion via `Client Credentials Flow`.
   - Las credenciales estan en variables de entorno de Render.

Endpoints internos relevantes:

- `GET /api/session`
  Devuelve estado de sesion.

- `GET /api/dashboard/config`
  Devuelve titulo, subtitulo, objetivo general y opciones configuradas de asesores.

- `GET /api/dashboard/refresh`
  Ejecuta queries en Salesforce y devuelve todo el payload del dashboard.

## Variables de entorno

Base en `.env.example`:

```txt
PORT=3000
HOST=127.0.0.1
APP_BASE_URL=http://localhost:3000
SESSION_SECRET=change-this-secret

SF_AUTH_BASE_URL=https://ucema2.my.salesforce.com
SF_CLIENT_ID=your-connected-app-client-id
SF_CLIENT_SECRET=your-connected-app-client-secret
SF_REDIRECT_PATH=/auth/callback
SF_API_VERSION=61.0

DASHBOARD_ALLOWED_USERS=
DASHBOARD_CONFIG_PATH=./config/dashboard.config.json
```

En Render, `APP_BASE_URL` debe apuntar al dominio productivo:

```txt
https://salesforce-dashboard-mvp.onrender.com
```

No versionar `.env`.

## Objetos Salesforce usados

Consultas:

- Objeto: `Programa_de_Historial__c`
- Fecha: `CreatedDate`
- Programa: `Programa__c`
- Nombre del programa: `Programa__r.Name`
- Asesor: `Programa__r.Asesor_responsable__r.Name`
- Email del asesor: `Programa__r.Asesor_responsable__r.Email`
- Filtros actuales:
  - `RecordType.Name = UCEMAX`
  - `Programa__r.Asesor_responsable__r.Email IN (...)`

Solicitudes:

- Objeto: `hed__Application__c`
- Fecha: `FechaPlazo__c`
- Programa: `hed__Applying_To__c`
- Nombre del programa: `hed__Applying_To__r.Name`
- Asesor: `hed__Applying_To__r.Asesor_responsable__r.Name`
- Email del asesor: `hed__Applying_To__r.Asesor_responsable__r.Email`
- Filtros actuales:
  - `Tipo_de_Programa__c = Programas Ejecutivos`
  - `hed__Application_Status__c IN (Admitido, Admision, Admit, Baja)`
  - `hed__Applying_To__r.Asesor_responsable__r.Email IN (...)`

Importante: el panel usa el asesor responsable del programa, no el `Owner` de la solicitud.

## Ventanas de fechas

Las ventanas se calculan en `server.js`:

- Solicitudes:
  - Funcion: `buildSolicitudesOperationalDateWindow(currentYear)`
  - Rango: `01/01/currentYear` a `31/12/currentYear`
  - Campo: `FechaPlazo__c`

- Consultas:
  - Funcion: `buildConsultasOperationalDateWindow(currentYear)`
  - Rango: `20/10/(currentYear - 1)` a `31/12/currentYear`
  - Campo: `CreatedDate`

- Comparativo historico:
  - Funcion: `buildProgramComparisonDateWindow(currentYear)`
  - Rango: desde `01/01/(currentYear - 2)` hasta `31/12/currentYear`

## Lista actual de asesores

El filtro funcional se hace por email del asesor:

```txt
v-aschmidt@ucema.edu.ar
v-faliano@ucema.edu.ar
v-pgraces@ucema.edu.ar
v-sivaldis@ucema.edu.ar
v-brebollini@ucema.edu.ar
v-mdsanto@ucema.edu.ar
v-esalom@ucema.edu.ar
v-svilamajo@ucema.edu.ar
```

Se eligio email porque hubo un caso donde el `Username` no coincidia con el email real esperado:

- Ezequiel Salom tenia `Email = v-esalom@ucema.edu.ar`
- Pero su `Username` en Salesforce seguia siendo `asesorejecutivos5@ucema.edu.ar`

Si se filtra por username, Ezequiel aparece mal o no trae registros. Por eso la clave operativa del panel es ahora `Asesor_responsable__r.Email`.

## ownerOptions

En `config/dashboard.config.json` existe `ownerOptions`.

Sirve para forzar que algunos asesores aparezcan en el selector aunque todavia no tengan registros en el dataset cargado:

```json
"ownerOptions": [
  {
    "email": "v-mdsanto@ucema.edu.ar",
    "name": "Mateo De Santo"
  },
  {
    "email": "v-esalom@ucema.edu.ar",
    "name": "Ezequiel Salom"
  }
]
```

Esto afecta la picklist del panel. Para que tambien entren en graficos y tablas, el email debe estar en los filtros de `consultas.filters` y `solicitudes.filters`.

## Cambios historicos importantes

Estos son los commits recientes mas importantes:

```txt
d550b96 Use advisor email for dashboard filters
f4926b5 Replace advisor username in dashboard filters
e9357e6 Show configured advisors in filter
5c0966d Add Mateo De Santo to advisor filters
267ff82 Add general solicitudes goal progress
d740088 Allow inactive programs in consultations
68607b6 Show compliance as semaphore in program detail
c993287 Use calendar years in program comparison
edc2f84 Remove active-program filter from applications
ec175b7 Use rolling consultation window for advisor panels
```

Resumen funcional:

- Se agrego objetivo general de `7500` solicitudes.
- Se agrego barra de progreso para ese objetivo.
- Se agrego Mateo De Santo al selector y filtros.
- Se reemplazo el asesor viejo por Ezequiel Salom.
- Se corrigio el criterio de asesor para usar email en vez de username.
- Se saco el filtro de programas activos en consultas para no perder registros.
- Se muestra semaforo para tasa de cumplimiento por programa.
- Se agrego comparativo historico por anio.

## Incidente de Ezequiel Salom

Ticket Asana:

```txt
https://app.asana.com/1/1208004864741940/project/1208004926880281/task/1217637626171709
```

Sintoma reportado:

- Ezequiel Salom aparecia en el filtro.
- Pero no aparecia en graficos ni tablas.
- Las solicitudes no coincidian con el reporte Salesforce.

Reporte Salesforce de referencia:

```txt
https://ucema2.lightning.force.com/lightning/r/Report/00OVJ0000067Vy52AE/view
```

Causa:

- El panel filtraba por `Username`.
- Salesforce tenia a Ezequiel con:
  - `Email = v-esalom@ucema.edu.ar`
  - `Username = asesorejecutivos5@ucema.edu.ar`
- Como el panel buscaba `v-esalom@ucema.edu.ar` en `Username`, no encontraba sus registros.

Fix:

- Cambiar `ownerUsernameField` por `ownerEmailField`.
- Cambiar filtros de `Username` a `Email`.
- Cambiar `ownerOptions` para usar `email`.
- Cambiar `public/app.js` y `server.js` para usar `ownerEmail` como clave primaria del filtro.

Validacion realizada:

```txt
Solicitudes del reporte Salesforce: 4634
Solicitudes con filtro por email del panel: 4634
Ezequiel Salom: 608 solicitudes
```

## Como agregar o sacar asesores

1. Confirmar el usuario en Salesforce.

Ejemplo:

```bash
sf data query --target-org ucema-prod --query "SELECT Id, Name, Username, Email, IsActive FROM User WHERE Email = 'nuevo@email.com' OR Username = 'nuevo@email.com'"
```

2. Usar siempre el `Email` del asesor como clave del panel.

3. Editar `config/dashboard.config.json`.

Agregar o quitar el email en:

- `consultas.filters[].values`
- `solicitudes.filters[].values`

Si se quiere que aparezca en el selector aunque todavia no tenga registros, agregarlo tambien en:

```json
"ownerOptions": [
  {
    "email": "nuevo@email.com",
    "name": "Nombre Apellido"
  }
]
```

4. Validar que Salesforce devuelve datos.

Consulta para solicitudes:

```bash
sf data query --target-org ucema-prod --query "SELECT hed__Applying_To__r.Asesor_responsable__r.Name asesor, hed__Applying_To__r.Asesor_responsable__r.Email email, COUNT(Id) total FROM hed__Application__c WHERE Tipo_de_Programa__c = 'Programas Ejecutivos' AND hed__Application_Status__c IN ('Admitido','Admision','Admit','Baja') AND FechaPlazo__c >= 2026-01-01 AND FechaPlazo__c <= 2026-12-31 AND hed__Applying_To__r.Asesor_responsable__r.Email IN ('nuevo@email.com') GROUP BY hed__Applying_To__r.Asesor_responsable__r.Name, hed__Applying_To__r.Asesor_responsable__r.Email"
```

Consulta para consultas:

```bash
sf data query --target-org ucema-prod --query "SELECT Programa__r.Asesor_responsable__r.Name asesor, Programa__r.Asesor_responsable__r.Email email, COUNT(Id) total FROM Programa_de_Historial__c WHERE RecordType.Name = 'UCEMAX' AND CreatedDate >= 2025-10-20T00:00:00Z AND CreatedDate <= 2026-12-31T23:59:59Z AND Programa__r.Asesor_responsable__r.Email IN ('nuevo@email.com') GROUP BY Programa__r.Asesor_responsable__r.Name, Programa__r.Asesor_responsable__r.Email"
```

5. Validar sintaxis local.

```bash
npm run check
```

Si no hay `npm`, usar:

```bash
node --check server.js
node --check public/app.js
node -e "JSON.parse(require('fs').readFileSync('config/dashboard.config.json','utf8')); console.log('config ok')"
```

6. Commit y push.

```bash
git status --short
git add config/dashboard.config.json server.js public/app.js README.md docs/codex-handoff-panel-asesores.md
git commit -m "Describe el cambio"
git push origin main
```

Render redeploya automaticamente al recibir cambios en `main`.

## Como cambiar el objetivo general

Archivo:

```txt
config/dashboard.config.json
```

Campo:

```json
"solicitudesGoal": 7500
```

El frontend toma ese valor desde `/api/dashboard/config`.

La barra se renderiza en:

- `public/index.html`: contenedor `#solicitudes-goal`
- `public/app.js`: `renderSolicitudesGoalProgress()`
- `public/styles.css`: clases `.goal-progress*`

## Como cambiar filtros funcionales

Todos los filtros de Salesforce estan en:

```txt
config/dashboard.config.json
```

Tipos soportados por `server.js`:

- `eq`
- `in`
- `between`

Si se necesita otro operador, hay que extender `buildFilterClause()` en `server.js`.

## Como comparar contra Salesforce

Reporte usado para validar solicitudes:

```txt
00OVJ0000067Vy52AE - UCEMAX Inscripciones 2026
```

El reporte usa:

- Objeto: `hed__Application__c`
- `Tipo_de_Programa__c = Programas Ejecutivos`
- `hed__Application_Status__c = Admision, Admit, Admitido, Baja`
- Term con 2026

En el panel, la validacion reciente dio el mismo total usando `FechaPlazo__c` de 2026:

```txt
4634 solicitudes
```

SOQL de control:

```bash
sf data query --target-org ucema-prod --query "SELECT COUNT() FROM hed__Application__c WHERE Tipo_de_Programa__c = 'Programas Ejecutivos' AND hed__Application_Status__c IN ('Admitido','Admision','Admit','Baja') AND FechaPlazo__c >= 2026-01-01 AND FechaPlazo__c <= 2026-12-31 AND hed__Applying_To__r.Asesor_responsable__r.Email IN ('v-aschmidt@ucema.edu.ar','v-faliano@ucema.edu.ar','v-pgraces@ucema.edu.ar','v-sivaldis@ucema.edu.ar','v-brebollini@ucema.edu.ar','v-mdsanto@ucema.edu.ar','v-esalom@ucema.edu.ar','v-svilamajo@ucema.edu.ar')"
```

## Deploy en Render

Flujo normal:

1. Hacer cambios en repo.
2. Validar localmente.
3. Commit.
4. Push a `main`.
5. Render inicia redeploy automatico.
6. Revisar `https://salesforce-dashboard-mvp.onrender.com/`.

En Render, revisar:

- Deploy logs.
- Variables de entorno.
- Branch conectada: `main`.
- Build/start command.

El proyecto Node usa:

```txt
node server.js
```

## Checklist antes de entregar un cambio

- El repo esta limpio: `git status --short`.
- `config/dashboard.config.json` parsea bien.
- `server.js` pasa `node --check`.
- `public/app.js` pasa `node --check`.
- No hay secretos en el diff.
- No quedan emails/usuarios viejos si el cambio era un reemplazo.
- Se valido al menos una query SOQL contra Salesforce.
- Se pusheo a `main`.
- Se espero el redeploy de Render.
- Se probo el panel en navegador.

## Problemas comunes

### El asesor aparece en la picklist pero no en graficos

Probable causa:

- El asesor esta en `ownerOptions`, pero no entra en la query real.

Revisar:

- Que su email este en `consultas.filters[].values`.
- Que su email este en `solicitudes.filters[].values`.
- Que Salesforce tenga programas con `Asesor_responsable__r.Email = ese email`.

### Los totales no coinciden con Salesforce

Revisar:

- Fecha usada por el panel.
- Filtros de estado.
- Tipo de programa.
- Lista de asesores.
- Si el reporte Salesforce usa otra fecha o agrupacion.

### Render no muestra el cambio

Revisar:

- El commit llego a GitHub.
- Render esta conectado a `main`.
- El deploy termino exitosamente.
- El navegador no esta mostrando cache viejo. Probar refresh fuerte.

### No se puede correr npm

Usar `node --check` directo:

```bash
node --check server.js
node --check public/app.js
```

## Reglas de mantenimiento

- No versionar secretos.
- No hardcodear Salesforce IDs salvo que el usuario lo pida explicitamente.
- Para asesores, preferir email antes que username.
- Cambios funcionales simples deben ir primero por `config/dashboard.config.json`.
- Tocar `server.js` solo si falta soporte tecnico para una nueva regla.
- Tocar `public/app.js` cuando cambie el comportamiento visual/interactivo del panel.
- Validar contra Salesforce antes de asumir que el panel esta mal.

