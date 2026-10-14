const loginPanel = document.querySelector("#login-panel");
const adminPanel = document.querySelector("#admin-panel");
const loginForm = document.querySelector("#admin-login-form");
const loginError = document.querySelector("#login-error");
const adminError = document.querySelector("#admin-error");
const resultsBody = document.querySelector("#results-body");
const detailDialog = document.querySelector("#detail-dialog");
const filtersForm = document.querySelector("#report-filters");
const exportButton = document.querySelector("#export-button");
let activeFilters = {};
let allResults = [];
function showError(node, message) { node.textContent = message; node.hidden = false; }
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function queryString() {
  const query = new URLSearchParams();
  Object.entries(activeFilters).forEach(([key, value]) => { if (value) query.set(key, value); });
  return query.toString();
}
function updateExport() { const query = queryString(); exportButton.href = "/api/admin/export.xlsx" + (query ? "?" + query : ""); }
function fillTable(selector, rows, values, emptySelector) {
  const body = document.querySelector(selector); body.replaceChildren();
  const labels = [...body.closest("table").querySelectorAll("thead th")].map((header) => header.innerText.trim());
  rows.forEach((item) => {
    const row = document.createElement("tr");
    values(item).forEach((value, index) => {
      const cell = document.createElement("td"); cell.textContent = value; cell.dataset.label = labels[index] || ""; row.append(cell);
    });
    body.append(row);
  });
  document.querySelector(emptySelector).hidden = rows.length > 0;
}
async function loadResults() {
  const query = queryString();
  const response = await fetch("/api/admin/results" + (query ? "?" + query : ""));
  if (response.status === 401) { loginPanel.hidden = false; adminPanel.hidden = true; return; }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || "No fue posible cargar resultados.");
  allResults = payload.results;
  document.querySelector("#attempt-count").textContent = payload.total_attempts.toLocaleString("es-MX");
  document.querySelector("#average-score").textContent = payload.average_score.toLocaleString("es-MX", { maximumFractionDigits: 1 });
  document.querySelector("#passed-count").textContent = payload.passed_count.toLocaleString("es-MX");
  document.querySelector("#refuerzo-count").textContent = payload.needs_refuerzo_count.toLocaleString("es-MX");
  document.querySelector("#pass-rate").textContent = payload.pass_rate.toLocaleString("es-MX", { maximumFractionDigits: 1 });
  document.querySelector("#passing-percent").textContent = payload.passing_percent;
  const period = [activeFilters.date_from && "Desde " + activeFilters.date_from, activeFilters.date_to && "Hasta " + activeFilters.date_to, activeFilters.name && "Nombre: " + activeFilters.name].filter(Boolean).join(" · ");
  document.querySelector("#report-period").textContent = period ? "Filtros aplicados: " + period : "Periodo: todas las evaluaciones registradas";
  fillTable("#sections-body", payload.sections, (x) => [x.section, x.correct, x.total, x.percent + "%"], "#sections-empty");
  fillTable("#questions-body", payload.questions, (x) => [x.question_id, x.section + ": " + x.question, x.attempts, x.correct, x.incorrect, x.percent_correct + "%", x.most_common_wrong || "—"], "#questions-empty");
  loginPanel.hidden = true; adminPanel.hidden = false; renderResults(); updateExport();
}
function renderResults() {
  fillTable("#results-body", allResults, (item) => [item.participant_name, formatDate(item.submitted_at), item.score + " / " + item.total + " (" + item.percent + "%)", item.passed ? "Aprobado" : "Requiere refuerzo", ""], "#empty-results");
  [...resultsBody.rows].forEach((row, index) => {
    row.cells[3].className = allResults[index].passed ? "status-passed" : "status-needs-work";
    const button = document.createElement("button"); button.type = "button"; button.className = "button table-action"; button.textContent = "Ver respuestas";
    button.addEventListener("click", () => showDetail(allResults[index].id)); row.cells[4].replaceChildren(button);
  });
}
async function showDetail(id) {
  try {
    const response = await fetch("/api/admin/results/" + id); const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "No fue posible abrir el detalle.");
    document.querySelector("#detail-title").textContent = result.participant_name;
    document.querySelector("#detail-meta").textContent = formatDate(result.submitted_at) + " · " + result.score + " de " + result.total + " (" + result.percent + "%) · " + (result.passed ? "Aprobado" : "Requiere refuerzo");
    const answers = document.querySelector("#detail-answers"); answers.replaceChildren();
    result.answers.forEach((item, index) => {
      const article = document.createElement("article"); article.className = "answer-detail " + (item.is_correct ? "is-correct" : "is-wrong");
      const section = document.createElement("p"); section.textContent = item.section;
      const title = document.createElement("h3"); title.textContent = (index + 1) + ". " + item.question;
      const selected = document.createElement("p"); selected.textContent = "Respuesta: " + item.selected;
      const status = document.createElement("p"); status.className = "answer-status"; status.textContent = item.is_correct ? "Correcta" : "Incorrecta · Respuesta correcta: " + item.correct;
      article.append(section, title, selected, status); answers.append(article);
    });
    detailDialog.showModal();
  } catch (error) { showError(adminError, error.message); }
}
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault(); loginError.hidden = true;
  try {
    const response = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: new FormData(loginForm).get("password") }) });
    const payload = await response.json(); if (!response.ok) throw new Error(payload.detail || "No fue posible iniciar sesión.");
    loginForm.reset(); await loadResults();
  } catch (error) { showError(loginError, error.message); }
});
filtersForm.addEventListener("submit", async (event) => {
  event.preventDefault(); adminError.hidden = true;
  activeFilters = { date_from: document.querySelector("#date-from").value, date_to: document.querySelector("#date-to").value, name: document.querySelector("#name-filter").value.trim() };
  updateExport(); try { await loadResults(); } catch (error) { showError(adminError, error.message); }
});
document.querySelector("#clear-filters").addEventListener("click", async () => { filtersForm.reset(); activeFilters = {}; try { await loadResults(); } catch (error) { showError(adminError, error.message); } });
document.querySelector("#logout-button").addEventListener("click", async () => { await fetch("/api/admin/logout", { method: "POST" }); adminPanel.hidden = true; loginPanel.hidden = false; });
document.querySelector("#close-dialog").addEventListener("click", () => detailDialog.close());
detailDialog.addEventListener("click", (event) => { if (event.target === detailDialog) detailDialog.close(); });
loadResults().catch((error) => showError(adminError, error.message));
