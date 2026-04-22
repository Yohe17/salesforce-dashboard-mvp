# Salesforce Dashboard MVP

MVP privado para calcular la tasa de conversion entre `Consultas` y `Solicitudes` usando:

- login del usuario final con `Salesforce My Domain + SSO Microsoft`
- consultas de datos con un `usuario de integracion` por `Client Credentials Flow`

## Requerimiento cubierto

Formula:

```txt
Solicitudes / Consultas * 100
```

Segmentaciones incluidas:

- Asesor (`Owner`)
- Programa
- Cruce Asesor x Programa

Objetos configurados:

- `Programa_de_Historial__c` como `Consultas`
- `hed__Application__c` como `Solicitudes`

## Arquitectura del MVP

- `server.js`
  Login OAuth del usuario, sesiones HTTP, client credentials y consultas a Salesforce
- `config/dashboard.config.json`
  Objetos, filtros, owners, campos y rango dinamico
- `public/`
  Panel HTML/CSS/JS con KPIs, tablas y barras

## Variables de entorno

Crea un `.env` a partir de `.env.example`.

Necesarias:

- `HOST`
- `APP_BASE_URL`
- `SESSION_SECRET`
- `SF_AUTH_BASE_URL`
- `SF_CLIENT_ID`
- `SF_CLIENT_SECRET`
- `SF_REDIRECT_PATH`

Opcional:

- `DASHBOARD_ALLOWED_USERS`
  Lista separada por comas de emails o usernames autorizados para entrar

## External Client App

La app debe soportar dos cosas:

1. `Authorization Code` para el login del usuario final
2. `Client Credentials Flow` para el usuario de integracion

Ademas:

- el callback debe incluir `http://localhost:3000/auth/callback`
- el usuario de integracion debe estar definido en las policies del `Client Credentials Flow`
- la app debe tener `client id` y `client secret` vigentes

## Filtros por defecto del MVP

### Consultas

- Objeto: `Programa_de_Historial__c`
- Fecha: `CreatedDate`
- `RecordType.Name = UCEMAX`
- `Origen_de_la_consulta__c in (Web, Advertisement, Anuncio)`
- `Owner.Name` en la lista fija definida en el JSON

### Solicitudes

- Objeto: `hed__Application__c`
- Fecha: `FechaPlazo__c`
- `Tipo_de_Programa__c = Programas Ejecutivos`
- `Owner.Name` en la misma lista fija

## Nota importante del calculo

`Consultas` y `Solicitudes` no tienen relacion directa entre si.

Por eso, la tasa en este MVP es:

- agregada por el mismo rango temporal
- agregada por el mismo filtro de owners
- agregada por el mismo programa cuando se analiza segmentado

## Suposicion actual del rango dinamico

El MVP usa por defecto:

- `Ano calendario actual`

Es decir:

- inicio: `1 Jan del ano actual`
- fin: `31 Dec del ano actual`

Si despues queres cambiarlo por `current FY`, rango academico o un selector manual, lo podemos ajustar sin rehacer la arquitectura.

## Arranque local

Con Node instalado:

```bash
node server.js
```

Abrir:

```txt
http://localhost:3000
```

## Seguridad

- No guardes secretos en el repositorio.
- Si un secreto ya fue compartido por fuera del entorno seguro, conviene rotarlo antes de usarlo en produccion.
