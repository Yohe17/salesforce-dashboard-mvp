const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DEFAULT_ENV_PATH = path.join(ROOT_DIR, ".env");

loadEnv(DEFAULT_ENV_PATH);

const env = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "127.0.0.1",
  appBaseUrl: normalizeUrl(process.env.APP_BASE_URL || "http://localhost:3000"),
  sessionSecret: process.env.SESSION_SECRET || "dev-session-secret",
  salesforceAuthBaseUrl: normalizeUrl(process.env.SF_AUTH_BASE_URL || "https://login.salesforce.com"),
  salesforceClientId: process.env.SF_CLIENT_ID || "",
  salesforceClientSecret: process.env.SF_CLIENT_SECRET || "",
  salesforceRedirectPath: process.env.SF_REDIRECT_PATH || "/auth/callback",
  salesforceApiVersion: process.env.SF_API_VERSION || "61.0",
  dashboardAllowedUsers: parseCsv(process.env.DASHBOARD_ALLOWED_USERS || ""),
  dashboardConfigPath: path.resolve(ROOT_DIR, process.env.DASHBOARD_CONFIG_PATH || "./config/dashboard.config.json")
};

const sessions = new Map();
const oauthStates = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const STATIC_FILES = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/app.js": "app.js"
};

setInterval(cleanupExpiredEntries, 5 * 60 * 1000).unref();

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, env.appBaseUrl);

    if (requestUrl.pathname in STATIC_FILES && req.method === "GET") {
      return serveStaticFile(res, STATIC_FILES[requestUrl.pathname]);
    }

    if (requestUrl.pathname === "/health" && req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        time: new Date().toISOString(),
        authConfigReady: isUserAuthConfigReady(),
        dataAccessMode: "salesforce_user",
        configLoaded: fs.existsSync(env.dashboardConfigPath)
      });
    }

    if (requestUrl.pathname === "/api/session" && req.method === "GET") {
      return handleSession(req, res);
    }

    if (requestUrl.pathname === "/api/dashboard/config" && req.method === "GET") {
      return handleDashboardConfig(req, res);
    }

    if (requestUrl.pathname === "/api/dashboard/refresh" && req.method === "GET") {
      return handleDashboardRefresh(req, res);
    }

    if (requestUrl.pathname === "/auth/login" && req.method === "GET") {
      return handleAuthLogin(res);
    }

    if (requestUrl.pathname === env.salesforceRedirectPath && req.method === "GET") {
      return handleAuthCallback(requestUrl, res);
    }

    if (requestUrl.pathname === "/auth/logout" && req.method === "POST") {
      return handleLogout(req, res);
    }

    sendJson(res, 404, {
      error: "Not Found"
    });
  } catch (error) {
    console.error("Unhandled server error", error);
    sendJson(res, 500, {
      error: "Internal server error"
    });
  }
});

server.listen(env.port, env.host, () => {
  console.log(`Salesforce dashboard MVP listening on ${env.appBaseUrl}`);
});

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function normalizeUrl(value) {
  if (!value) {
    return "";
  }

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/$/, "");
}

async function serveStaticFile(res, fileName) {
  const filePath = path.join(PUBLIC_DIR, fileName);
  const contentType = getContentType(filePath);

  try {
    const content = await fsp.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
    res.end(content);
  } catch (error) {
    sendJson(res, 404, {
      error: "Static file not found"
    });
  }
}

function getContentType(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }
  return "application/octet-stream";
}

function handleSession(req, res) {
  const session = getSessionFromRequest(req);

  if (!session) {
    return sendJson(res, 200, {
      authenticated: false,
      authConfigReady: isUserAuthConfigReady(),
      allowlistEnabled: env.dashboardAllowedUsers.length > 0,
      user: null
    });
  }

  session.lastSeenAt = Date.now();
  sessions.set(session.id, session);

  sendJson(res, 200, {
    authenticated: true,
    authConfigReady: isUserAuthConfigReady(),
    allowlistEnabled: env.dashboardAllowedUsers.length > 0,
    user: session.user
  });
}

async function handleDashboardConfig(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return sendJson(res, 401, {
      error: "Authentication required"
    });
  }

  try {
    const config = await readDashboardConfig();
    sendJson(res, 200, {
      title: config.title,
      subtitle: config.subtitle || ""
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message
    });
  }
}

async function handleDashboardRefresh(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return sendJson(res, 401, {
      error: "Authentication required"
    });
  }

  if (!isUserAuthConfigReady()) {
    return sendJson(res, 500, {
      error: "Salesforce login configuration is incomplete"
    });
  }

  try {
    const config = await readDashboardConfig();
    const dateWindow = buildDateWindow(config.dateRange);
    const consultasRecords = await fetchAllRecords(session, buildQuery(config.consultas, dateWindow));
    const solicitudesRecords = await fetchAllRecords(session, buildQuery(config.solicitudes, dateWindow));
    const dashboardUser = await enrichDashboardUser(session);

    const consultas = consultasRecords.map((record) => mapRecord(record, config.consultas));
    const solicitudes = solicitudesRecords.map((record) => mapRecord(record, config.solicitudes));

    sendJson(res, 200, buildDashboardPayload(config, dateWindow, consultas, solicitudes, dashboardUser));
  } catch (error) {
    console.error("Dashboard refresh failed", error);
    sendJson(res, 500, {
      error: error.message || "Dashboard refresh failed"
    });
  }
}

function handleAuthLogin(res) {
  if (!isUserAuthConfigReady()) {
    return sendJson(res, 500, {
      error: "Missing Salesforce External Client App configuration"
    });
  }

  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());

  oauthStates.set(state, {
    verifier,
    createdAt: Date.now()
  });

  const authorizeUrl = new URL(`${env.salesforceAuthBaseUrl}/services/oauth2/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", env.salesforceClientId);
  authorizeUrl.searchParams.set("redirect_uri", getRedirectUri());
  authorizeUrl.searchParams.set("scope", "api refresh_token");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  res.writeHead(302, {
    Location: authorizeUrl.toString()
  });
  res.end();
}

async function handleAuthCallback(requestUrl, res) {
  const error = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");
  if (error) {
    return redirectWithMessage(res, `/?authError=${encodeURIComponent(errorDescription || error)}`);
  }

  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const storedState = state ? oauthStates.get(state) : null;

  if (!code || !storedState || Date.now() - storedState.createdAt > OAUTH_STATE_TTL_MS) {
    return redirectWithMessage(res, "/?authError=Invalid%20or%20expired%20login%20state");
  }

  oauthStates.delete(state);

  try {
    const tokenPayload = await exchangeCodeForToken(code, storedState.verifier);
    const identity = await fetchIdentity(tokenPayload);

    if (!isDashboardUserAllowed(identity)) {
      return redirectWithMessage(res, "/?authError=Tu%20usuario%20no%20esta%20habilitado%20para%20este%20dashboard");
    }

    const session = createSession({
      user: {
        id: identity.user_id,
        username: identity.username,
        displayName: identity.display_name || identity.name || identity.username,
        email: identity.email || "",
        organizationId: identity.organization_id,
        dataAccessMode: "salesforce_user"
      },
      salesforceAuth: buildSalesforceAuth(tokenPayload)
    });

    setSessionCookie(res, session.id);
    redirectWithMessage(res, "/");
  } catch (callbackError) {
    console.error("OAuth callback failed", callbackError);
    redirectWithMessage(res, `/?authError=${encodeURIComponent(callbackError.message || "Login failed")}`);
  }
}

async function fetchIdentity(tokenPayload) {
  if (tokenPayload.id) {
    return fetchJson(tokenPayload.id, {
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`
      }
    });
  }

  return fetchJson(`${env.salesforceAuthBaseUrl}/services/oauth2/userinfo`, {
    headers: {
      Authorization: `Bearer ${tokenPayload.access_token}`
    }
  });
}

function handleLogout(req, res) {
  const cookieHeader = req.headers.cookie || "";
  const sessionId = parseCookies(cookieHeader).sid;
  if (sessionId) {
    sessions.delete(sessionId);
  }

  res.writeHead(204, {
    "Set-Cookie": buildExpiredCookie()
  });
  res.end();
}

function createSession(payload) {
  const id = randomToken(32);
  const session = {
    id,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    ...payload
  };
  sessions.set(id, session);
  return session;
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const sessionId = cookies.sid;
  if (!sessionId) {
    return null;
  }

  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }

  return session;
}

function setSessionCookie(res, sessionId) {
  res.setHeader("Set-Cookie", buildSessionCookie(sessionId));
}

function buildSessionCookie(sessionId) {
  const attributes = [
    `sid=${sessionId}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];

  if (env.appBaseUrl.startsWith("https://")) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

function buildExpiredCookie() {
  const attributes = [
    "sid=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];

  if (env.appBaseUrl.startsWith("https://")) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

function parseCookies(cookieHeader) {
  return cookieHeader.split(";").reduce((accumulator, entry) => {
    const trimmed = entry.trim();
    if (!trimmed) {
      return accumulator;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return accumulator;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    accumulator[key] = decodeURIComponent(value);
    return accumulator;
  }, {});
}

async function readDashboardConfig() {
  const raw = await fsp.readFile(env.dashboardConfigPath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed.consultas || !parsed.solicitudes) {
    throw new Error("Dashboard config must define consultas and solicitudes");
  }

  return parsed;
}

function buildQuery(objectConfig, dateWindow) {
  const fields = uniqueValues(objectConfig.fields);
  const filters = [...(objectConfig.filters || []), buildDateFilter(objectConfig, dateWindow)];
  const whereClause = filters.map(buildFilterClause).join(" AND ");
  const orderBy = objectConfig.dateField ? ` ORDER BY ${objectConfig.dateField} DESC` : "";

  return `SELECT ${fields.join(", ")} FROM ${objectConfig.apiName} WHERE ${whereClause}${orderBy}`;
}

function buildDateFilter(objectConfig, dateWindow) {
  return {
    field: objectConfig.dateField,
    operator: "between",
    start: objectConfig.dateKind === "datetime" ? dateWindow.startDateTime : dateWindow.startDate,
    end: objectConfig.dateKind === "datetime" ? dateWindow.endDateTime : dateWindow.endDate
  };
}

function buildFilterClause(filter) {
  if (filter.operator === "eq") {
    return `${filter.field} = '${escapeSoqlString(filter.value)}'`;
  }

  if (filter.operator === "in") {
    const values = filter.values.map((value) => `'${escapeSoqlString(value)}'`).join(", ");
    return `${filter.field} IN (${values})`;
  }

  if (filter.operator === "between") {
    return `${filter.field} >= ${filter.start} AND ${filter.field} <= ${filter.end}`;
  }

  throw new Error(`Unsupported filter operator: ${filter.operator}`);
}

function escapeSoqlString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function fetchAllRecords(session, soql) {
  const records = [];
  let auth = await getSessionSalesforceAuth(session);
  let nextUrl = `${auth.instanceUrl}/services/data/v${env.salesforceApiVersion}/query?q=${encodeURIComponent(soql)}`;
  let attempts = 0;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`
      }
    });

    if (response.status === 401 && attempts === 0) {
      auth = await getSessionSalesforceAuth(session, true);
      attempts += 1;
      continue;
    }

    if (!response.ok) {
      const failure = await response.text();
      throw new Error(`Salesforce query failed (${response.status}): ${failure}`);
    }

    const payload = await response.json();
    records.push(...(payload.records || []));
    nextUrl = payload.done ? null : `${auth.instanceUrl}${payload.nextRecordsUrl}`;
  }

  return records;
}

function buildSalesforceAuth(tokenPayload, fallbackInstanceUrl = env.salesforceAuthBaseUrl) {
  return {
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token || null,
    instanceUrl: normalizeUrl(tokenPayload.instance_url || fallbackInstanceUrl),
    expiresAt: Date.now() + inferTokenLifetimeMs(tokenPayload)
  };
}

function inferTokenLifetimeMs(tokenPayload) {
  const seconds = Number(tokenPayload.expires_in || 0);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(seconds - 60, 60) * 1000;
  }

  return 90 * 60 * 1000;
}

async function getSessionSalesforceAuth(session, forceRefresh = false) {
  if (!session.salesforceAuth?.accessToken) {
    throw new Error("La sesion de Salesforce no esta disponible. Vuelve a iniciar sesion.");
  }

  const shouldRefresh =
    forceRefresh ||
    !session.salesforceAuth.expiresAt ||
    session.salesforceAuth.expiresAt <= Date.now() + 15 * 1000;

  if (!shouldRefresh) {
    return session.salesforceAuth;
  }

  if (!session.salesforceAuth.refreshToken) {
    throw new Error("La sesion de Salesforce expiro. Vuelve a iniciar sesion.");
  }

  const refreshed = await refreshUserToken(session.salesforceAuth.refreshToken);
  session.salesforceAuth = {
    ...buildSalesforceAuth(refreshed, session.salesforceAuth.instanceUrl),
    refreshToken: refreshed.refresh_token || session.salesforceAuth.refreshToken
  };
  sessions.set(session.id, session);
  return session.salesforceAuth;
}

async function refreshUserToken(refreshToken) {
  const tokenUrl = `${env.salesforceAuthBaseUrl}/services/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.salesforceClientId,
    client_secret: env.salesforceClientSecret,
    refresh_token: refreshToken
  });

  return fetchJson(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });
}

async function exchangeCodeForToken(code, verifier) {
  const tokenUrl = `${env.salesforceAuthBaseUrl}/services/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.salesforceClientId,
    client_secret: env.salesforceClientSecret,
    redirect_uri: getRedirectUri(),
    code,
    code_verifier: verifier
  });

  return fetchJson(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch (error) {
    payload = {
      raw: text
    };
  }

  if (!response.ok) {
    const message = payload.error_description || payload.error || payload.raw || `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function mapRecord(record, objectConfig) {
  const owner = getNestedValue(record, objectConfig.ownerField) || "Sin owner";
  const programId = getNestedValue(record, objectConfig.programIdField) || "";
  const programName = getNestedValue(record, objectConfig.programNameField) || "Sin programa";
  const dateValue = getNestedValue(record, objectConfig.dateField) || "";

  return {
    id: record.Id,
    owner,
    programId,
    programName,
    dateValue,
    raw: flattenRecord(record, objectConfig.fields)
  };
}

async function enrichDashboardUser(session) {
  const dashboardUser = { ...session.user };

  try {
    const userRecord = await fetchCurrentUserRecord(session, session.user.id);
    dashboardUser.displayName = userRecord.Name || dashboardUser.displayName;
    dashboardUser.username = userRecord.Username || dashboardUser.username;
    dashboardUser.email = userRecord.Email || dashboardUser.email;
    dashboardUser.objetivoPercent = normalizePercentValue(userRecord.Objetivo__c);
  } catch (error) {
    dashboardUser.objetivoPercent = null;
  }

  session.user = dashboardUser;
  sessions.set(session.id, session);
  return dashboardUser;
}

async function fetchCurrentUserRecord(session, userId) {
  const records = await fetchAllRecords(
    session,
    `SELECT Id, Name, Username, Email, Objetivo__c FROM User WHERE Id = '${escapeSoqlString(userId)}' LIMIT 1`
  );

  return records[0] || {};
}

function normalizePercentValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const normalized = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
  return Number(normalized.toFixed(2));
}

function buildComplianceStatus(value) {
  if (value === null) {
    return {
      icon: "—",
      tone: "neutral"
    };
  }

  if (value < 30) {
    return {
      icon: "🔴",
      tone: "danger"
    };
  }

  if (value > 70) {
    return {
      icon: "🟢",
      tone: "success"
    };
  }

  return {
    icon: "🟡",
    tone: "warning"
  };
}

function buildDashboardPayload(config, dateWindow, consultas, solicitudes, user) {
  const byOwner = buildSeries(consultas, solicitudes, (row) => ({
    key: row.owner,
    label: row.owner
  }));
  const byProgram = buildSeries(consultas, solicitudes, (row) => ({
    key: row.programId || row.programName,
    label: row.programName
  }));
  const byOwnerProgram = buildSeries(consultas, solicitudes, (row) => ({
    key: `${row.owner}::${row.programId || row.programName}`,
    label: `${row.owner} · ${row.programName}`,
    owner: row.owner,
    programName: row.programName
  }));

  const consultasCount = consultas.length;
  const solicitudesCount = solicitudes.length;
  const conversionRate = computeRate(solicitudesCount, consultasCount);
  const complianceValue = normalizePercentValue(user?.objetivoPercent);
  const complianceStatus = buildComplianceStatus(complianceValue);

  return {
    title: config.title,
    subtitle: config.subtitle,
    generatedAt: new Date().toISOString(),
    dateWindow,
    user: {
      ...user,
      objetivoPercent: complianceValue
    },
    kpis: [
      {
        label: "Consultas",
        value: consultasCount,
        tone: "default"
      },
      {
        label: "Solicitudes",
        value: solicitudesCount,
        tone: "default"
      },
      {
        label: "Tasa de conversion",
        value: conversionRate,
        type: "percent",
        tone: "accent"
      },
      {
        label: "Semaforo de cumplimiento",
        value: complianceValue,
        type: "semaphore",
        icon: complianceStatus.icon,
        tone: complianceStatus.tone
      },
      {
        label: "Owners cubiertos",
        value: byOwner.length,
        tone: "default"
      },
      {
        label: "Programas cubiertos",
        value: byProgram.length,
        tone: "default"
      }
    ],
    charts: {
      byOwner: byOwner.slice(0, 8),
      byProgram: byProgram.slice(0, 8)
    },
    tables: {
      byOwner,
      byProgram,
      byOwnerProgram
    },
    samples: {
      consultas: consultas.slice(0, 8).map((row) => ({
        Fecha: row.dateValue,
        Owner: row.owner,
        Programa: row.programName,
        Origen: row.raw["Origen_de_la_consulta__c"] || "—"
      })),
      solicitudes: solicitudes.slice(0, 8).map((row) => ({
        Fecha: row.dateValue,
        Owner: row.owner,
        Programa: row.programName,
        "Tipo Programa": row.raw["Tipo_de_Programa__c"] || "—"
      }))
    }
  };
}

function buildSeries(consultas, solicitudes, descriptor) {
  const aggregate = new Map();

  for (const row of consultas) {
    const info = descriptor(row);
    const item = aggregate.get(info.key) || createSeriesEntry(info);
    item.consultas += 1;
    aggregate.set(info.key, item);
  }

  for (const row of solicitudes) {
    const info = descriptor(row);
    const item = aggregate.get(info.key) || createSeriesEntry(info);
    item.solicitudes += 1;
    aggregate.set(info.key, item);
  }

  return [...aggregate.values()]
    .map((item) => ({
      ...item,
      tasa: computeRate(item.solicitudes, item.consultas)
    }))
    .sort((left, right) => {
      if (right.consultas !== left.consultas) {
        return right.consultas - left.consultas;
      }
      if (right.solicitudes !== left.solicitudes) {
        return right.solicitudes - left.solicitudes;
      }
      return left.label.localeCompare(right.label, "es");
    });
}

function createSeriesEntry(info) {
  return {
    key: info.key,
    label: info.label,
    owner: info.owner || "",
    programName: info.programName || "",
    consultas: 0,
    solicitudes: 0
  };
}

function computeRate(solicitudes, consultas) {
  if (!consultas) {
    return 0;
  }

  return Number(((solicitudes / consultas) * 100).toFixed(2));
}

function buildDateWindow(dateRangeConfig = {}) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();

  if ((dateRangeConfig.mode || "current_calendar_year") === "current_calendar_year") {
    return {
      label: `${dateRangeConfig.label || "Ano calendario actual"} (${currentYear})`,
      startDate: `${currentYear}-01-01`,
      endDate: `${currentYear}-12-31`,
      startDateTime: `${currentYear}-01-01T00:00:00Z`,
      endDateTime: `${currentYear}-12-31T23:59:59Z`
    };
  }

  throw new Error(`Unsupported date range mode: ${dateRangeConfig.mode}`);
}

function flattenRecord(record, fields) {
  const row = {};
  for (const field of fields) {
    row[field] = getNestedValue(record, field) ?? "";
  }
  return row;
}

function getNestedValue(source, pathExpression) {
  return pathExpression.split(".").reduce((current, segment) => {
    if (current === null || current === undefined) {
      return undefined;
    }
    return current[segment];
  }, source);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function redirectWithMessage(res, location) {
  res.writeHead(302, {
    Location: location
  });
  res.end();
}

function cleanupExpiredEntries() {
  const now = Date.now();

  for (const [sessionId, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(sessionId);
    }
  }

  for (const [state, entry] of oauthStates.entries()) {
    if (now - entry.createdAt > OAUTH_STATE_TTL_MS) {
      oauthStates.delete(state);
    }
  }
}

function isUserAuthConfigReady() {
  return Boolean(
    env.salesforceAuthBaseUrl &&
      env.salesforceClientId &&
      env.salesforceClientSecret &&
      env.salesforceRedirectPath
  );
}

function isDashboardUserAllowed(identity) {
  if (env.dashboardAllowedUsers.length === 0) {
    return true;
  }

  const keys = [
    identity.username || "",
    identity.email || ""
  ].map((value) => value.toLowerCase());

  return keys.some((value) => env.dashboardAllowedUsers.includes(value));
}

function getRedirectUri() {
  return `${env.appBaseUrl}${env.salesforceRedirectPath}`;
}

function randomToken(size) {
  return base64Url(crypto.randomBytes(size));
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function parseCsv(value) {
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}
