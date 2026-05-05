const state = {
  session: null,
  config: null,
  dashboard: null,
  source: null,
  filters: {
    owner: "all",
    program: "all"
  }
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
  ownerFilter: document.querySelector("#owner-filter"),
  programFilter: document.querySelector("#program-filter"),
  dashboardContent: document.querySelector("#dashboard-content"),
  kpiGrid: document.querySelector("#kpi-grid"),
  ownerChart: document.querySelector("#owner-chart"),
  programChart: document.querySelector("#program-chart"),
  ownerTable: document.querySelector("#owner-table"),
  programTable: document.querySelector("#program-table"),
  programComparisonTable: document.querySelector("#program-comparison-table"),
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

elements.ownerFilter.addEventListener("change", async (event) => {
  state.filters.owner = event.target.value;
  recomputeDashboard();
});

elements.programFilter.addEventListener("change", async (event) => {
  state.filters.program = event.target.value;
  recomputeDashboard();
});

elements.logoutButton.addEventListener("click", async () => {
  await fetch("/auth/logout", {
    method: "POST"
  });

  state.session = null;
  state.config = null;
  state.dashboard = null;
  state.source = null;
  state.filters = {
    owner: "all",
    program: "all"
  };
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

    state.source = payload.source;
    elements.lastUpdated.textContent = formatTimestamp(payload.source?.generatedAt || payload.generatedAt);
    renderMessage("");
    recomputeDashboard();
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
  elements.ownerFilter.disabled = !authenticated;
  elements.programFilter.disabled = !authenticated;

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
  renderTable(elements.ownerTable, ["label", "semaforo", "consultas", "solicitudes", "tasa"], state.dashboard.tables.byOwner, {
    label: "Asesor",
    semaforo: "Semaforo",
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
    elements.programComparisonTable,
    state.dashboard.tables.programComparison.columns,
    state.dashboard.tables.programComparison.rows,
    state.dashboard.tables.programComparison.labels,
    {
      numericColumns: state.dashboard.tables.programComparison.numericColumns
    }
  );
  renderTable(elements.consultasSample, ["Fecha", "Owner", "Programa", "Origen"], state.dashboard.samples.consultas);
  renderTable(elements.solicitudesSample, ["Fecha", "Owner", "Programa", "Tipo Programa"], state.dashboard.samples.solicitudes);
}

function recomputeDashboard() {
  if (!state.source) {
    state.dashboard = null;
    renderDashboard();
    return;
  }

  const ownerDirectory = createOwnerDirectoryMap(state.source.ownerDirectory || []);
  const filterOptions = state.source.filterOptions || buildFilterOptionsClient(state.source.consultas, state.source.solicitudes, ownerDirectory);
  const appliedFilters = resolveDashboardFiltersClient(state.filters, filterOptions);
  const filteredConsultas = applyDashboardFiltersClient(state.source.consultas, appliedFilters);
  const filteredSolicitudes = applyDashboardFiltersClient(state.source.solicitudes, appliedFilters);
  const filteredSolicitudesHistory = applyDashboardFiltersClient(state.source.solicitudesHistory, appliedFilters);

  state.filters = appliedFilters;
  state.dashboard = buildDashboardView(
    state.source.dateWindow,
    filteredConsultas,
    filteredSolicitudes,
    filteredSolicitudesHistory,
    state.source.user,
    ownerDirectory,
    filterOptions,
    appliedFilters
  );

  renderFilterControls(filterOptions, appliedFilters);
  renderDashboard();
}

function clearDashboardContainers() {
  [
    elements.kpiGrid,
    elements.ownerChart,
    elements.programChart,
    elements.ownerTable,
    elements.programTable,
    elements.programComparisonTable,
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

function renderFilterControls(filterOptions = {}, activeFilters = {}) {
  syncSelectOptions(elements.ownerFilter, filterOptions.owners || [{ value: "all", label: "Todos" }], activeFilters.owner || "all");
  syncSelectOptions(elements.programFilter, filterOptions.programs || [{ value: "all", label: "Todos" }], activeFilters.program || "all");
}

function syncSelectOptions(select, options, selectedValue) {
  select.innerHTML = "";

  options.forEach((option) => {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.append(node);
  });

  select.value = options.some((option) => option.value === selectedValue) ? selectedValue : "all";
}

function buildKpiToneClass(metric) {
  if (!metric?.tone || metric.tone === "default") {
    return "";
  }

  return ` ${metric.tone}`;
}

function createOwnerDirectoryMap(entries) {
  return new Map(
    entries.map((entry) => [
      entry.id,
      entry
    ])
  );
}

function buildFilterOptionsClient(consultas, solicitudes, ownerDirectory) {
  const owners = new Map();
  const programs = new Map();

  for (const row of [...consultas, ...solicitudes]) {
    const ownerKey = row.ownerId || row.owner;
    if (ownerKey && !owners.has(ownerKey)) {
      owners.set(ownerKey, {
        value: ownerKey,
        label: ownerDirectory.get(row.ownerId)?.name || row.owner
      });
    }

    const programKey = row.programId || row.programName;
    if (programKey && !programs.has(programKey)) {
      programs.set(programKey, {
        value: programKey,
        label: row.programName
      });
    }
  }

  return {
    owners: [{ value: "all", label: "Todos" }, ...sortFilterOptionsClient([...owners.values()])],
    programs: [{ value: "all", label: "Todos" }, ...sortFilterOptionsClient([...programs.values()])]
  };
}

function sortFilterOptionsClient(options) {
  return options.sort((left, right) => left.label.localeCompare(right.label, "es"));
}

function resolveDashboardFiltersClient(selectedFilters, filterOptions) {
  const ownerAllowed = filterOptions.owners.some((option) => option.value === selectedFilters.owner);
  const programAllowed = filterOptions.programs.some((option) => option.value === selectedFilters.program);

  return {
    owner: ownerAllowed ? selectedFilters.owner : "all",
    program: programAllowed ? selectedFilters.program : "all"
  };
}

function applyDashboardFiltersClient(rows, filters) {
  return rows.filter((row) => {
    const ownerKey = row.ownerId || row.owner;
    const programKey = row.programId || row.programName;
    const ownerMatches = filters.owner === "all" || ownerKey === filters.owner;
    const programMatches = filters.program === "all" || programKey === filters.program;
    return ownerMatches && programMatches;
  });
}

function buildDashboardView(dateWindow, consultas, solicitudes, solicitudesHistory, user, ownerDirectory, filterOptions, activeFilters) {
  const byOwner = buildSeriesClient(consultas, solicitudes, (row) => ({
    key: row.ownerId || row.owner,
    label: row.owner,
    owner: row.owner,
    ownerId: row.ownerId
  }));
  const byProgram = buildSeriesClient(consultas, solicitudes, (row) => ({
    key: row.programId || row.programName,
    label: row.programName,
    programName: row.programName,
    programId: row.programId
  }));

  const consultasCount = consultas.length;
  const solicitudesCount = solicitudes.length;
  const conversionRate = computeRateClient(solicitudesCount, consultasCount);
  const ownersWithCompliance = byOwner.map((row) => attachOwnerComplianceClient(row, ownerDirectory));
  const complianceValue = averageComplianceClient(ownersWithCompliance);
  const complianceStatus = buildComplianceStatusClient(complianceValue);
  const programComparison = buildProgramComparisonClient(solicitudesHistory, dateWindow.currentYear);

  return {
    generatedAt: state.source.generatedAt,
    dateWindow,
    user: {
      ...user,
      objetivoPercent: complianceValue
    },
    activeFilters,
    filterOptions,
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
      byOwner: ownersWithCompliance.slice(0, 8),
      byProgram: byProgram.slice(0, 8)
    },
    tables: {
      byOwner: ownersWithCompliance,
      byProgram,
      programComparison
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

function buildSeriesClient(consultas, solicitudes, descriptor) {
  const aggregate = new Map();

  for (const row of consultas) {
    const info = descriptor(row);
    const item = aggregate.get(info.key) || createSeriesEntryClient(info);
    item.consultas += 1;
    aggregate.set(info.key, item);
  }

  for (const row of solicitudes) {
    const info = descriptor(row);
    const item = aggregate.get(info.key) || createSeriesEntryClient(info);
    item.solicitudes += 1;
    aggregate.set(info.key, item);
  }

  return [...aggregate.values()]
    .map((item) => ({
      ...item,
      tasa: computeRateClient(item.solicitudes, item.consultas)
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

function createSeriesEntryClient(info) {
  return {
    key: info.key,
    label: info.label,
    owner: info.owner || "",
    ownerId: info.ownerId || "",
    programName: info.programName || "",
    programId: info.programId || "",
    consultas: 0,
    solicitudes: 0
  };
}

function attachOwnerComplianceClient(row, ownerDirectory) {
  const ownerMeta = ownerDirectory.get(row.ownerId || "");
  const objetivoPercent = ownerMeta?.objetivoPercent ?? null;
  const semaphore = ownerMeta?.semaphore || buildComplianceStatusClient(objetivoPercent);

  return {
    ...row,
    objetivoPercent,
    semaforo: buildSemaphoreLabelClient(semaphore, objetivoPercent)
  };
}

function buildSemaphoreLabelClient(semaphore, objetivoPercent) {
  if (objetivoPercent === null) {
    return semaphore.icon || "—";
  }

  return `${semaphore.icon} ${formatPercent(objetivoPercent)}`;
}

function averageComplianceClient(rows) {
  const values = rows
    .map((row) => row.objetivoPercent)
    .filter((value) => value !== null && value !== undefined);

  if (!values.length) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(2));
}

function buildComplianceStatusClient(value) {
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

function buildProgramComparisonClient(rows, currentYear) {
  const years = [currentYear - 3, currentYear - 2, currentYear - 1, currentYear];
  const aggregate = new Map();

  rows.forEach((row) => {
    const year = extractYearClient(row.dateValue);
    if (!year || !years.includes(year)) {
      return;
    }

    const key = row.programId || row.programName;
    const item = aggregate.get(key) || {
      key,
      programName: row.programName,
      counts: {}
    };
    item.counts[year] = (item.counts[year] || 0) + 1;
    aggregate.set(key, item);
  });

  const [year1, year2, year3, year4] = years;
  const rowsFormatted = [...aggregate.values()]
    .map((item) => {
      const count1 = item.counts[year1] || 0;
      const count2 = item.counts[year2] || 0;
      const count3 = item.counts[year3] || 0;
      const count4 = item.counts[year4] || 0;

      return {
        programName: item.programName,
        [String(year1)]: count1 || "",
        [String(year2)]: count2 || "",
        [`${year2}Delta`]: formatProgramDeltaClient(count1, count2, false),
        [String(year3)]: count3 || "",
        [`${year3}Delta`]: formatProgramDeltaClient(count2, count3, false),
        [`solicitudes${year4}`]: count4 || "",
        [`${year4}Delta`]: formatProgramDeltaClient(count3, count4, true)
      };
    })
    .sort((left, right) => {
      const rightCurrent = Number(right[`solicitudes${year4}`] || 0);
      const leftCurrent = Number(left[`solicitudes${year4}`] || 0);
      if (rightCurrent !== leftCurrent) {
        return rightCurrent - leftCurrent;
      }

      const rightPrevious = Number(right[String(year3)] || 0);
      const leftPrevious = Number(left[String(year3)] || 0);
      if (rightPrevious !== leftPrevious) {
        return rightPrevious - leftPrevious;
      }

      return left.programName.localeCompare(right.programName, "es");
    });

  return {
    columns: [
      "programName",
      String(year1),
      String(year2),
      `${year2}Delta`,
      String(year3),
      `${year3}Delta`,
      `solicitudes${year4}`,
      `${year4}Delta`
    ],
    labels: {
      programName: "Programa",
      [String(year1)]: String(year1),
      [String(year2)]: String(year2),
      [`${year2}Delta`]: `${year2} vs ${year1}`,
      [String(year3)]: String(year3),
      [`${year3}Delta`]: `${year3} vs ${year2}`,
      [`solicitudes${year4}`]: `Solicitudes ${year4}`,
      [`${year4}Delta`]: `${year4} vs ${year3}`
    },
    numericColumns: [
      String(year1),
      String(year2),
      String(year3),
      `solicitudes${year4}`
    ],
    rows: rowsFormatted
  };
}

function extractYearClient(value) {
  const match = String(value || "").match(/^(\d{4})-/);
  return match ? Number(match[1]) : 0;
}

function formatProgramDeltaClient(previousCount, currentCount, isCurrentYearComparison) {
  if (!previousCount && !currentCount) {
    return "—";
  }

  if (!previousCount && currentCount) {
    return isCurrentYearComparison ? "Primera edicion" : "No dictado previamente";
  }

  if (previousCount && !currentCount) {
    return "-100,00%";
  }

  return formatPercent(((currentCount - previousCount) / previousCount) * 100);
}

function computeRateClient(solicitudes, consultas) {
  if (!consultas) {
    return 0;
  }

  return Number(((solicitudes / consultas) * 100).toFixed(2));
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

function renderTable(container, columns, rows, labels = {}, options = {}) {
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
      td.textContent = formatValueForColumn(column, row[column], options);
      tr.append(td);
    });
    tbody.append(tr);
  });

  table.append(thead, tbody);
  container.append(table);
}

function formatValueForColumn(column, value, options = {}) {
  if (column === "tasa") {
    return formatPercent(value);
  }

  if (column === "consultas" || column === "solicitudes" || options.numericColumns?.includes(column)) {
    return formatNumber(value);
  }

  if (typeof value === "string" && looksLikeIsoDate(value)) {
    return formatTimestamp(value);
  }

  if (value === null || value === undefined || value === "") {
    return "—";
  }

  return value;
}

function renderMessage(message) {
  elements.globalMessage.textContent = message;
  elements.globalMessage.hidden = !message;
}

function toggleLoading(isLoading) {
  elements.refreshButton.disabled = isLoading || !state.session?.authenticated;
  elements.ownerFilter.disabled = isLoading || !state.session?.authenticated;
  elements.programFilter.disabled = isLoading || !state.session?.authenticated;
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
