const state = {
  session: null,
  config: null,
  dashboard: null
};

const elements = {
  dashboardTitle: document.querySelector("#dashboard-title"),
  dashboardSubtitle: document.querySelector("#dashboard-subtitle"),
  sessionStatus: document.querySelector("#session-status"),
  sessionUser: document.querySelector("#session-user"),
  lastUpdated: document.querySelector("#last-updated"),
  globalMessage: document.querySelector("#global-message"),
  loginButton: document.querySelector("#login-button"),
  refreshButton: document.querySelector("#refresh-button"),
  logoutButton: document.querySelector("#logout-button"),
  dashboardContent: document.querySelector("#dashboard-content"),
  kpiGrid: document.querySelector("#kpi-grid"),
  ownerChart: document.querySelector("#owner-chart"),
  programChart: document.querySelector("#program-chart"),
  ownerTable: document.querySelector("#owner-table"),
  programTable: document.querySelector("#program-table"),
  ownerProgramTable: document.querySelector("#owner-program-table"),
  consultasSample: document.querySelector("#consultas-sample"),
  solicitudesSample: document.querySelector("#solicitudes-sample")
};

bootstrap().catch((error) => {
  renderMessage(`No se pudo iniciar el panel: ${error.message}`);
});

elements.loginButton.addEventListener("click", () => {
  window.location.href = "/auth/login";
});

elements.refreshButton.addEventListener("click", async () => {
  await refreshDashboard();
});

elements.logoutButton.addEventListener("click", async () => {
  await fetch("/auth/logout", {
    method: "POST"
  });

  state.session = null;
  state.config = null;
  state.dashboard = null;
  updateSessionUi();
  renderDashboard();
});

async function bootstrap() {
  const url = new URL(window.location.href);
  const authError = url.searchParams.get("authError");
  if (authError) {
    renderMessage(decodeURIComponent(authError));
    url.searchParams.delete("authError");
    window.history.replaceState({}, "", url.toString());
  }

  await loadSession();
  updateSessionUi();

  if (state.session?.authenticated) {
    await loadConfig();
    await refreshDashboard();
  }
}

async function loadSession() {
  const response = await fetch("/api/session");
  state.session = await response.json();
}

async function loadConfig() {
  const response = await fetch("/api/dashboard/config");
  if (!response.ok) {
    const payload = await response.json();
    throw new Error(payload.error || "No se pudo leer la configuracion");
  }

  state.config = await response.json();
  elements.dashboardTitle.textContent = state.config.title;
  elements.dashboardSubtitle.textContent = state.config.subtitle;
  elements.dashboardSubtitle.hidden = !state.config.subtitle;
}

async function refreshDashboard() {
  toggleLoading(true);

  try {
    const response = await fetch("/api/dashboard/refresh");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "No se pudo actualizar");
    }

    state.dashboard = payload;
    elements.lastUpdated.textContent = formatTimestamp(payload.generatedAt);
    renderMessage("");
    renderDashboard();
  } catch (error) {
    renderMessage(error.message);
  } finally {
    toggleLoading(false);
  }
}

function updateSessionUi() {
  const authenticated = Boolean(state.session?.authenticated);
  const authReady = Boolean(state.session?.authConfigReady);

  elements.loginButton.hidden = authenticated;
  elements.logoutButton.hidden = !authenticated;
  elements.refreshButton.disabled = !authenticated;

  if (!authReady) {
    elements.sessionStatus.textContent = "Falta configurar login";
    elements.sessionUser.textContent = "Completa las variables OAuth y el callback del My Domain.";
    elements.refreshButton.disabled = true;
    return;
  }

  if (!authenticated) {
    elements.sessionStatus.textContent = "Sesion cerrada";
    elements.sessionUser.textContent = "Ingresa con Salesforce para ver tu panel.";
    return;
  }

  elements.sessionStatus.textContent = "Sesion activa";
  elements.sessionUser.textContent = `${state.session.user.displayName} · ${state.session.user.username}`;
}

function renderDashboard() {
  const hasData = Boolean(state.dashboard);
  elements.dashboardContent.hidden = !hasData;

  if (!hasData) {
    clearDashboardContainers();
    return;
  }

  renderKpis();
  renderBarList(elements.ownerChart, state.dashboard.charts.byOwner);
  renderBarList(elements.programChart, state.dashboard.charts.byProgram);
  renderTable(elements.ownerTable, ["label", "consultas", "solicitudes", "tasa"], state.dashboard.tables.byOwner, {
    label: "Asesor",
    consultas: "Consultas",
    solicitudes: "Solicitudes",
    tasa: "Tasa"
  });
  renderTable(elements.programTable, ["label", "consultas", "solicitudes", "tasa"], state.dashboard.tables.byProgram, {
    label: "Programa",
    consultas: "Consultas",
    solicitudes: "Solicitudes",
    tasa: "Tasa"
  });
  renderTable(
    elements.ownerProgramTable,
    ["owner", "programName", "consultas", "solicitudes", "tasa"],
    state.dashboard.tables.byOwnerProgram,
    {
      owner: "Asesor",
      programName: "Programa",
      consultas: "Consultas",
      solicitudes: "Solicitudes",
      tasa: "Tasa"
    }
  );
  renderTable(elements.consultasSample, ["Fecha", "Owner", "Programa", "Origen"], state.dashboard.samples.consultas);
  renderTable(elements.solicitudesSample, ["Fecha", "Owner", "Programa", "Tipo Programa"], state.dashboard.samples.solicitudes);
}

function clearDashboardContainers() {
  [
    elements.kpiGrid,
    elements.ownerChart,
    elements.programChart,
    elements.ownerTable,
    elements.programTable,
    elements.ownerProgramTable,
    elements.consultasSample,
    elements.solicitudesSample
  ].forEach((element) => {
    element.innerHTML = "";
  });
}

function renderKpis() {
  elements.kpiGrid.innerHTML = "";
  state.dashboard.kpis.forEach((metric) => {
    const card = document.createElement("article");
    card.className = `kpi-card${buildKpiToneClass(metric)}`;

    const label = document.createElement("p");
    label.className = "kpi-label";
    label.textContent = metric.label;

    const value = document.createElement("p");
    value.className = "kpi-value";
    value.textContent = formatMetricValue(metric);

    card.append(label, value);
    elements.kpiGrid.append(card);
  });
}

function buildKpiToneClass(metric) {
  if (!metric?.tone || metric.tone === "default") {
    return "";
  }

  return ` ${metric.tone}`;
}

function formatMetricValue(metric) {
  if (metric.type === "percent") {
    return formatPercent(metric.value);
  }

  if (metric.type === "semaphore") {
    if (metric.value === null || metric.value === undefined) {
      return metric.icon || "—";
    }

    return `${metric.icon} ${formatPercent(metric.value)}`;
  }

  return formatNumber(metric.value);
}

function renderBarList(container, rows) {
  container.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Sin registros para este corte.";
    container.append(empty);
    return;
  }

  rows.forEach((row) => {
    const item = document.createElement("article");
    item.className = "bar-item";

    const line = document.createElement("div");
    line.className = "bar-line";

    const label = document.createElement("strong");
    label.textContent = row.label;

    const metrics = document.createElement("span");
    metrics.textContent = `${formatPercent(row.tasa)} · ${formatNumber(row.solicitudes)} / ${formatNumber(row.consultas)}`;

    const track = document.createElement("div");
    track.className = "bar-track";

    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${Math.min(row.tasa, 100)}%`;

    line.append(label, metrics);
    track.append(fill);
    item.append(line, track);
    container.append(item);
  });
}

function renderTable(container, columns, rows, labels = {}) {
  container.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Sin registros para mostrar.";
    container.append(empty);
    return;
  }

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  const headerRow = document.createElement("tr");

  columns.forEach((column) => {
    const th = document.createElement("th");
    th.textContent = labels[column] || column;
    headerRow.append(th);
  });

  thead.append(headerRow);

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((column) => {
      const td = document.createElement("td");
      td.textContent = formatValueForColumn(column, row[column]);
      tr.append(td);
    });
    tbody.append(tr);
  });

  table.append(thead, tbody);
  container.append(table);
}

function formatValueForColumn(column, value) {
  if (column === "tasa") {
    return formatPercent(value);
  }

  if (column === "consultas" || column === "solicitudes") {
    return formatNumber(value);
  }

  if (typeof value === "string" && looksLikeIsoDate(value)) {
    return formatTimestamp(value);
  }

  return value || "—";
}

function renderMessage(message) {
  elements.globalMessage.textContent = message;
  elements.globalMessage.hidden = !message;
}

function toggleLoading(isLoading) {
  elements.refreshButton.disabled = isLoading || !state.session?.authenticated;
  elements.refreshButton.textContent = isLoading ? "Actualizando..." : "Actualizar ahora";
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-AR").format(value || 0);
}

function formatPercent(value) {
  return `${new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0)}%`;
}

function formatTimestamp(value) {
  const hasTime = looksLikeIsoDate(value) && value.includes("T");
  const date = hasTime ? new Date(value) : new Date(`${value}T12:00:00`);
  const options = hasTime
    ? {
        dateStyle: "medium",
        timeStyle: "short"
      }
    : {
        dateStyle: "medium"
      };

  return new Intl.DateTimeFormat("es-AR", options).format(date);
}

function looksLikeIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}/.test(value);
}
