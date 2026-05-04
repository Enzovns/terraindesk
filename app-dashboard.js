const toast = document.querySelector("#app-toast");
let toastTimer;
let supabaseClient;
let session;
let profile;
let company;
let state = {
  leads: [],
  quotes: [],
  jobs: [],
  invoices: [],
  automations: {}
};

const automations = [
  ["quoteFollowUp", "Quote follow-up after 48 hours", "Send a calm reminder when a quote has not been accepted."],
  ["crewReminder", "Crew reminder the night before", "Send tomorrow's route and materials checklist to crew leads."],
  ["photoRequest", "Pre-visit photo request", "Ask clients for site photos before the first visit."],
  ["reviewRequest", "Review request after completion", "Ask for a Google review after the job is signed off."],
  ["invoiceReminder", "Invoice reminder after due date", "Send an overdue payment reminder automatically."],
  ["marginAlert", "Margin alert under 25%", "Notify the owner before a low-margin quote is sent."]
];

const planCatalog = {
  Essential: {
    price: "A$149/mo",
    included: ["CRM", "Quotes", "Scheduling", "Work orders", "Invoices", "Xero CSV", "Google Calendar export"],
    locked: ["Automations", "Crew mobile", "Route optimization", "Client portal", "Margin reports", "Recurring contracts"]
  },
  Operations: {
    price: "A$329/mo",
    included: ["Everything in Essential", "Automations", "Crew mobile", "Route optimization", "Client portal", "Materials", "Contracts", "Margin reports"],
    locked: ["Advanced permissions", "Multiple depots", "Migration support"]
  },
  "Multi-crew": {
    price: "Custom",
    included: ["Everything in Operations", "Advanced permissions", "Multiple depots", "Accounting exports", "Migration support"],
    locked: []
  }
};

function money(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function setLocked(locked) {
  document.body.classList.toggle("locked", locked);
}

function leadById(id) {
  return state.leads.find((lead) => lead.id === id) || { name: "Unknown client", suburb: "Unknown" };
}

function employeesList() {
  const employees = state.automations.employees;
  return Array.isArray(employees) && employees.length ? employees : ["Owner", "North employee", "South employee"];
}

function defaultServiceTemplates() {
  return [
    { service: "Lawn mow and edges", hours: 1.5, rate: 90, materials: 0, markup: 20 },
    { service: "Garden cleanup and green waste removal", hours: 6, rate: 85, materials: 180, markup: 25 },
    { service: "Mulch supply and install", hours: 8, rate: 85, materials: 520, markup: 28 },
    { service: "Irrigation inspection and repair", hours: 3, rate: 95, materials: 160, markup: 25 }
  ];
}

function serviceTemplates() {
  const templates = state.automations.serviceTemplates;
  return Array.isArray(templates) && templates.length ? templates : defaultServiceTemplates();
}

function currentPlan() {
  return planCatalog[company?.plan] ? company.plan : "Operations";
}

function featureLocked(feature) {
  return planCatalog[currentPlan()].locked.includes(feature);
}

function defaultMaterials() {
  return [
    { item: "Premium mulch", unit: "m3", cost: 120, stock: 18, reorder: 6 },
    { item: "Sir Walter turf", unit: "m2", cost: 14, stock: 240, reorder: 80 },
    { item: "Drip irrigation line", unit: "roll", cost: 96, stock: 5, reorder: 3 },
    { item: "Native plants mix", unit: "tray", cost: 72, stock: 9, reorder: 4 }
  ];
}

function materialsList() {
  const materials = state.automations.materials;
  return Array.isArray(materials) && materials.length ? materials : defaultMaterials();
}

function defaultContracts() {
  return [
    { client: "Oak Ridge Estate", service: "Lawn and garden care", frequency: "Fortnightly", amount: 920, next: "Tue" },
    { client: "Cottesloe Villas", service: "Irrigation and hedge care", frequency: "Monthly", amount: 640, next: "Fri" }
  ];
}

function contractsList() {
  const contracts = state.automations.contracts;
  return Array.isArray(contracts) && contracts.length ? contracts : defaultContracts();
}

function depotsList() {
  const depots = state.automations.depots;
  return Array.isArray(depots) && depots.length ? depots : ["Main depot"];
}

function permissionsList() {
  const permissions = state.automations.permissions;
  return Array.isArray(permissions) && permissions.length ? permissions : ["Owner: all access", "Manager: sales, jobs, invoices", "Employee: crew mobile, schedule"];
}

function onboardingData() {
  return state.automations.onboarding || {};
}

function jobMeta() {
  return state.automations.jobMeta || {};
}

function metaForJob(jobId) {
  return jobMeta()[jobId] || { note: "", proof: [] };
}

async function getConfig() {
  const response = await fetch("/api/config");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Supabase config is missing.");
  return result;
}

async function sendCustomerMessage(payload) {
  const response = await fetch("/api/customer-message", {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Message could not be sent.");
  return result;
}

async function workspaceAction(payload) {
  const response = await fetch("/api/workspace-action", {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Action failed.");
  return result;
}

async function initSupabase() {
  const config = await getConfig();
  supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  const { data } = await supabaseClient.auth.getSession();
  session = data.session;

  supabaseClient.auth.onAuthStateChange(async (_event, nextSession) => {
    session = nextSession;
    if (!session) {
      setLocked(true);
      return;
    }
    await bootWorkspace();
  });

  if (!session) {
    setLocked(true);
    return;
  }
  await bootWorkspace();
}

async function bootWorkspace() {
  setLocked(false);
  await ensureProfile();
  await loadWorkspace();
  renderAll();
  applyRoleAccess();
}

async function ensureProfile() {
  let { data: profileRows, error } = await supabaseClient
    .from("profiles")
    .select("id, company_id, email, role")
    .limit(1);

  if (error) throw error;

  if (!profileRows.length) {
    const response = await fetch("/api/bootstrap-company", {
      method: "POST",
      headers: { authorization: `Bearer ${session.access_token}` }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not provision company.");
    profileRows = [result.profile];
  }

  profile = profileRows[0];

  const { data: companies, error: companyError } = await supabaseClient
    .from("companies")
    .select("*")
    .eq("id", profile.company_id)
    .limit(1);

  if (companyError) throw companyError;
  company = companies[0];
}

async function loadWorkspace() {
  const response = await fetch("/api/workspace-data", {
    headers: { authorization: `Bearer ${session.access_token}` }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load workspace.");
  state = {
    leads: result.leads || [],
    quotes: result.quotes || [],
    jobs: result.jobs || [],
    invoices: result.invoices || [],
    automations: result.automations || Object.fromEntries(automations.map(([key]) => [key, true]))
  };
}

async function refresh() {
  await loadWorkspace();
  renderAll();
}

function renderMetrics() {
  const revenue = state.invoices.filter((invoice) => invoice.status === "Paid").reduce((sum, invoice) => sum + Number(invoice.amount), 0);
  const waitingQuotes = state.quotes.filter((quote) => quote.status === "Sent").length;
  const scheduledJobs = state.jobs.filter((job) => !["Complete", "Proposed"].includes(job.status)).length;
  const overdue = state.invoices.filter((invoice) => invoice.status === "Overdue").length;
  document.querySelector("#metric-revenue").textContent = money(revenue);
  document.querySelector("#metric-quotes").textContent = waitingQuotes;
  document.querySelector("#metric-jobs").textContent = scheduledJobs;
  document.querySelector("#metric-overdue").textContent = overdue;
}

function renderPlan() {
  const plan = currentPlan();
  const details = planCatalog[plan];
  document.querySelector("#plan-panel").innerHTML = `
    <div>
      <p class="eyebrow">Current plan</p>
      <h2>${escapeHtml(plan)} <span class="plan-price">${escapeHtml(details.price)}</span></h2>
      <p class="muted-copy">Included now: ${details.included.map(escapeHtml).join(", ")}.</p>
    </div>
    ${details.locked.length ? `<div class="locked-list">${details.locked.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : `<strong class="success-text">All platform modules unlocked</strong>`}
  `;
}

function renderOnboarding() {
  const data = onboardingData();
  const bookingReady = Boolean(company?.id);
  const employeesReady = employeesList().length > 0;
  const templatesReady = serviceTemplates().length > 0;
  const materialsReady = materialsList().length > 0;
  const quoteReady = state.quotes.length > 0;
  const invoiceReady = state.invoices.length > 0;
  const items = [
    ["Company details", Boolean(company?.name && company?.abn), "Add company name and ABN in Settings."],
    ["Public booking link", bookingReady, "Copy the client portal link to the landscaper's website and Google profile."],
    ["Employees", employeesReady, "Add the team so jobs can be assigned from quote creation."],
    ["Service templates", templatesReady, "Save common jobs to quote faster and keep pricing consistent."],
    ["Materials price book", materialsReady, "Add stock and reorder levels before the first active jobs."],
    ["First quote sent", quoteReady, "Create and email a quote to test the customer approval flow."],
    ["Invoice flow tested", invoiceReady, "Complete a job, generate an invoice, and print the invoice PDF."]
  ];
  document.querySelector("#onboarding-list").innerHTML = items.map(([title, done, detail]) => `
    <label class="onboarding-item ${done ? "done" : ""}">
      <input type="checkbox" ${done ? "checked" : ""} disabled>
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span>
    </label>
  `).join("");
  const form = document.querySelector("#onboarding-form");
  if (form) {
    form.serviceArea.value = data.serviceArea || "";
    form.businessPhone.value = data.businessPhone || "";
    form.workHours.value = data.workHours || "";
    form.paymentTerms.value = data.paymentTerms || "Due 7 days after invoice";
    form.messageTone.value = data.messageTone || "Professional";
  }
}

function renderActions() {
  const actions = [
    ...state.leads.filter((lead) => lead.status === "New").map((lead) => ({
      title: `Call ${lead.name}`,
      detail: `${lead.service} in ${lead.suburb}`,
      action: "Create quote",
      attrs: `data-build-quote="${lead.id}"`
    })),
    ...state.quotes.filter((quote) => quote.status === "Sent").map((quote) => ({
      title: `Follow up quote for ${leadById(quote.lead_id).name}`,
      detail: `${money(quote.amount)} waiting approval`,
      action: "Email quote",
      attrs: `data-email-quote="${quote.id}"`
    })),
    ...state.quotes.filter((quote) => quote.status === "Revision requested").map((quote) => ({
      title: `Revise quote for ${leadById(quote.lead_id).name}`,
      detail: `${money(quote.amount)} needs price or timing changes`,
      action: "Open quote",
      attrs: `data-build-quote="${quote.lead_id}"`
    })),
    ...state.invoices.filter((invoice) => invoice.status !== "Paid").map((invoice) => ({
      title: `Invoice ${String(invoice.id).slice(0, 8)}`,
      detail: `${money(invoice.amount)} due ${invoice.due || "soon"}`,
      action: "Remind",
      attrs: `data-remind-invoice="${invoice.id}"`
    }))
  ].slice(0, 6);

  document.querySelector("#action-list").innerHTML = actions.map(({ title, detail, action, attrs }) => `
    <div class="action-item">
      <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>
      <button class="mini-btn" ${attrs}>${escapeHtml(action)}</button>
    </div>
  `).join("") || `<div class="action-item"><strong>Nothing urgent</strong><p>Your operation is clear for now.</p></div>`;
}

function renderLeads() {
  document.querySelector("#leads-table").innerHTML = state.leads.map((lead) => `
    <tr>
      <td><strong>${escapeHtml(lead.name)}</strong><br><span>${escapeHtml(lead.email || "")}</span></td>
      <td>${escapeHtml(lead.suburb || "")}</td>
      <td>${escapeHtml(lead.service || "")}</td>
      <td><span class="pill ${lead.urgency === "This week" ? "danger-pill" : ""}">${escapeHtml(lead.urgency || "Flexible")}</span></td>
      <td><span class="pill">${escapeHtml(lead.status || "New")}</span></td>
      <td class="row-actions">
        <button class="mini-btn" data-contact-lead="${lead.id}">Contacted</button>
        <button class="mini-btn" data-build-quote="${lead.id}">Quote</button>
        <button class="mini-btn danger-action" data-delete-lead="${lead.id}">Delete</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="6">No leads yet.</td></tr>`;
  document.querySelector("#quote-lead").innerHTML = state.leads.map((lead) => `<option value="${lead.id}">${escapeHtml(lead.name)} - ${escapeHtml(lead.suburb || "No suburb")}</option>`).join("");
}

function renderQuotes() {
  document.querySelector("#quotes-list").innerHTML = state.quotes.map((quote) => {
    const lead = leadById(quote.lead_id);
    const canSchedule = quote.status === "Accepted";
    const proposed = state.jobs.find((job) => job.quote_id === quote.id && ["Proposed", "Scheduled"].includes(job.status));
    return `
      <article class="card">
        <span>${escapeHtml(lead.name)} - ${escapeHtml(lead.suburb || "")}</span>
        <h3>${escapeHtml(quote.service)}</h3>
        <strong>${money(quote.amount)}</strong>
        <p>${proposed ? `Proposed ${escapeHtml(proposed.day || "Mon")} - ${escapeHtml(proposed.crew || "Unassigned")}` : "No appointment proposed"} - ${escapeHtml(quote.status)}</p>
        <div class="card-actions">
          <button class="mini-btn" data-email-quote="${quote.id}">Email quote</button>
          ${canSchedule ? `<button class="mini-btn" data-schedule-quote="${quote.id}">Adjust job</button>` : ""}
          <button class="mini-btn danger-action" data-delete-quote="${quote.id}">Delete</button>
        </div>
      </article>
    `;
  }).join("") || `<p>No quotes yet.</p>`;
}

function renderJobs() {
  const columns = ["Scheduled", "In progress", "Complete", "Blocked"];
  document.querySelector("#jobs-board").innerHTML = columns.map((column) => `
    <section class="kanban-column">
      <h3>${column}</h3>
      ${state.jobs.filter((job) => job.status === column).map((job) => {
        const lead = leadById(job.lead_id);
        return `
          <article class="job-card">
            <strong>${escapeHtml(job.service)}</strong>
            <p>${escapeHtml(lead.name)} - ${escapeHtml(lead.suburb || "")}<br>${escapeHtml(job.crew || "Unassigned")} - ${escapeHtml(job.day || "Mon")}</p>
            <div class="card-actions">
              <button class="mini-btn" data-view-job="${job.id}">Timeline</button>
              ${job.status === "Scheduled" ? `<button class="mini-btn" data-start-job="${job.id}">Start</button>` : ""}
              ${job.status === "In progress" ? `<button class="mini-btn" data-complete-job="${job.id}">Complete</button>` : ""}
              ${job.status === "Complete" ? `<button class="mini-btn" data-invoice-job="${job.id}">Invoice</button>` : ""}
              ${job.status !== "Blocked" && job.status !== "Complete" ? `<button class="mini-btn" data-block-job="${job.id}">Block</button>` : ""}
            </div>
          </article>
        `;
      }).join("") || `<p class="empty-state">No jobs.</p>`}
    </section>
  `).join("");
}

function renderSchedule() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  document.querySelector("#schedule-grid").innerHTML = days.map((day) => `
    <section class="schedule-day">
      <h3>${day}</h3>
      ${state.jobs.filter((job) => job.day === day && job.status !== "Proposed").map((job) => `<div class="job-card"><strong>${escapeHtml(job.service)}</strong><p>${escapeHtml(leadById(job.lead_id).suburb || "")}<br>${escapeHtml(job.crew || "")}</p></div>`).join("") || `<p class="empty-state">Open capacity.</p>`}
    </section>
  `).join("");
}

function renderRoutes() {
  const scheduled = state.jobs.filter((job) => !["Complete", "Proposed", "Blocked"].includes(job.status));
  const grouped = ["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => ({
    day,
    jobs: scheduled.filter((job) => job.day === day),
    km: scheduled.filter((job) => job.day === day).length * 14 + 8
  }));
  document.querySelector("#routes-grid").innerHTML = grouped.map((group) => `
    <section class="route-day">
      <div class="route-head"><strong>${group.day}</strong><span>${group.jobs.length} jobs - ${group.jobs.length ? group.km : 0} km est.</span></div>
      ${featureLocked("Route optimization") ? `<p class="locked-note">Upgrade to Operations for route optimization.</p>` : ""}
      ${group.jobs.map((job, index) => `<article class="route-stop"><b>${index + 1}</b><div><strong>${escapeHtml(job.service)}</strong><p>${escapeHtml(leadById(job.lead_id).suburb || "")} - ${escapeHtml(job.crew || "Unassigned")}</p></div></article>`).join("") || `<p class="empty-state">No route planned.</p>`}
    </section>
  `).join("");
}

function renderCrew() {
  document.querySelector("#crew-jobs").innerHTML = state.jobs.filter((job) => !["Complete", "Proposed", "Blocked"].includes(job.status)).map((job) => `
    <article class="crew-job">
      <div class="crew-job-head">
        <span>${escapeHtml(job.day || "Mon")} - ${escapeHtml(job.crew || "Unassigned")}</span>
        <strong>${escapeHtml(job.status)}</strong>
      </div>
      <h3>${escapeHtml(job.service)}</h3>
      <p>${escapeHtml(leadById(job.lead_id).name)} - ${escapeHtml(leadById(job.lead_id).suburb || "")}</p>
      ${metaForJob(job.id).note ? `<p class="crew-note">${escapeHtml(metaForJob(job.id).note)}</p>` : ""}
      <div class="crew-checklist">
        ${(job.checklist || []).map((item) => `<label><input type="checkbox"> <span>${escapeHtml(item)}</span></label>`).join("")}
      </div>
      <div class="proof-list">
        ${metaForJob(job.id).proof.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
      <div class="card-actions">
        ${job.status === "Scheduled" ? `<button class="primary-btn" data-start-job="${job.id}">Start route</button>` : ""}
        <button class="primary-btn" data-complete-job="${job.id}">Finish job</button>
      </div>
    </article>
  `).join("") || `<p>No active route.</p>`;
}

function renderMaterials() {
  const materialsInput = document.querySelector("#materials-form [name='materials']");
  if (materialsInput) {
    materialsInput.value = materialsList().map((item) => `${item.item} | ${item.unit} | ${item.cost} | ${item.stock} | ${item.reorder}`).join("\n");
  }
  document.querySelector("#materials-table").innerHTML = materialsList().map((item) => {
    const low = Number(item.stock) <= Number(item.reorder);
    return `
      <tr>
        <td><strong>${escapeHtml(item.item)}</strong><br><span>${escapeHtml(item.unit)}</span></td>
        <td>${money(item.cost)}</td>
        <td>${escapeHtml(item.stock)}</td>
        <td><span class="pill ${low ? "danger-pill" : "success-pill"}">${low ? "Reorder" : "In stock"}</span></td>
      </tr>
    `;
  }).join("");
}

function renderContracts() {
  const contractsInput = document.querySelector("#contracts-form [name='contracts']");
  if (contractsInput) {
    contractsInput.value = contractsList().map((item) => `${item.client} | ${item.service} | ${item.frequency} | ${item.amount} | ${item.next}`).join("\n");
  }
  document.querySelector("#contracts-list").innerHTML = contractsList().map((contract) => `
    <article class="card">
      <span>${escapeHtml(contract.frequency)}</span>
      <h3>${escapeHtml(contract.client)}</h3>
      <strong>${money(contract.amount)} / month</strong>
      <p>${escapeHtml(contract.service)} - next visit ${escapeHtml(contract.next || "TBC")}</p>
      ${featureLocked("Recurring contracts") ? `<p class="locked-note">Upgrade to Operations to manage recurring contracts.</p>` : ""}
    </article>
  `).join("");
}

function renderInvoices() {
  document.querySelector("#invoices-table").innerHTML = state.invoices.map((invoice) => `
    <tr>
      <td><strong>${String(invoice.id).slice(0, 8)}</strong></td>
      <td>${escapeHtml(leadById(invoice.lead_id).name)}</td>
      <td>${money(invoice.amount)}</td>
      <td>${escapeHtml(invoice.due || "")}</td>
      <td><span class="pill ${invoice.status === "Paid" ? "success-pill" : invoice.status === "Overdue" ? "danger-pill" : ""}">${escapeHtml(invoice.status)}</span></td>
      <td class="row-actions">
        <button class="mini-btn" data-email-invoice="${invoice.id}">Send</button>
        <button class="mini-btn" data-print-invoice="${invoice.id}">PDF</button>
        ${invoice.status !== "Paid" ? `<button class="mini-btn" data-remind-invoice="${invoice.id}">Remind</button><button class="mini-btn" data-pay-invoice="${invoice.id}">Mark paid</button>` : ""}
      </td>
    </tr>
  `).join("") || `<tr><td colspan="6">No invoices yet.</td></tr>`;
}

function renderReports() {
  const quoted = state.quotes.reduce((sum, quote) => sum + Number(quote.amount || 0), 0);
  const won = state.quotes.filter((quote) => ["Accepted", "Scheduled"].includes(quote.status)).reduce((sum, quote) => sum + Number(quote.amount || 0), 0);
  const invoiced = state.invoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  const paid = state.invoices.filter((invoice) => invoice.status === "Paid").reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  const estimatedMargin = quoted ? Math.round(((quoted * 0.32) / quoted) * 100) : 0;
  document.querySelector("#reports-grid").innerHTML = `
    ${featureLocked("Margin reports") ? `<section class="panel"><h2>Upgrade required</h2><p class="muted-copy">Margin reports are included in Operations and Multi-crew.</p></section>` : ""}
    <article><span>Total quoted</span><strong>${money(quoted)}</strong></article>
    <article><span>Won pipeline</span><strong>${money(won)}</strong></article>
    <article><span>Invoiced</span><strong>${money(invoiced)}</strong></article>
    <article><span>Paid</span><strong>${money(paid)}</strong></article>
    <article><span>Estimated gross margin</span><strong>${estimatedMargin}%</strong></article>
    <article><span>Active contracts</span><strong>${contractsList().length}</strong></article>
  `;
}

function renderPortal() {
  const link = company?.id ? `${window.location.origin}/b?c=${company.id}` : "";
  const input = document.querySelector("#portal-booking-link");
  if (input) input.value = link;
}

function renderAutomations() {
  document.querySelector("#automation-list").innerHTML = automations.map(([key, title, description]) => `
    <article class="automation-rule">
      <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></div>
      <button class="switch ${state.automations[key] ? "active" : ""}" data-automation="${key}" aria-label="${escapeHtml(title)}" ${featureLocked("Automations") ? "disabled" : ""}></button>
    </article>
  `).join("") + (featureLocked("Automations") ? `<p class="locked-note">Automations are included from the Operations plan.</p>` : "");
}

function renderCompany() {
  document.querySelector(".app-topbar .eyebrow").textContent = company?.name || "TerrainDesk workspace";
  document.querySelector("#company-form [name='name']").value = company?.name || "";
  document.querySelector("#company-form [name='abn']").value = company?.abn || "";
  const bookingInput = document.querySelector("#booking-link");
  if (bookingInput && company?.id) {
    bookingInput.value = `${window.location.origin}/b?c=${company.id}`;
  }
  const employeesInput = document.querySelector("#employees-form [name='employees']");
  if (employeesInput) employeesInput.value = employeesList().join("\n");
  const templatesInput = document.querySelector("#templates-form [name='templates']");
  if (templatesInput) {
    templatesInput.value = serviceTemplates().map((item) => `${item.service} | ${item.hours} | ${item.rate} | ${item.materials} | ${item.markup}`).join("\n");
  }
  const depotsInput = document.querySelector("#multi-crew-form [name='depots']");
  if (depotsInput) depotsInput.value = depotsList().join("\n");
  const permissionsInput = document.querySelector("#multi-crew-form [name='permissions']");
  if (permissionsInput) permissionsInput.value = permissionsList().join("\n");
  renderEmployeeChoices();
  renderServiceTemplates();
}

function renderEmployeeChoices() {
  const options = employeesList().map((employee) => `
    <label class="choice-option"><input type="checkbox" name="employees" value="${escapeHtml(employee)}"> <span>${escapeHtml(employee)}</span></label>
  `).join("");
  const quoteEmployees = document.querySelector("#quote-employees");
  const scheduleEmployees = document.querySelector("#schedule-employees");
  if (quoteEmployees) quoteEmployees.innerHTML = options;
  if (scheduleEmployees) scheduleEmployees.innerHTML = options;
}

function formPayload(form) {
  const payload = Object.fromEntries(new FormData(form));
  const names = new Set(Array.from(form.querySelectorAll("input[type='checkbox']")).map((input) => input.name));
  names.forEach((name) => {
    payload[name] = Array.from(form.querySelectorAll(`input[type='checkbox'][name='${name}']:checked`)).map((input) => input.value).join(", ");
  });
  return payload;
}

function renderServiceTemplates() {
  const select = document.querySelector("#service-template");
  if (!select) return;
  select.innerHTML = `<option value="">Custom quote</option>${serviceTemplates().map((template, index) => `<option value="${index}">${escapeHtml(template.service)}</option>`).join("")}`;
}

function parseTemplates(value) {
  return String(value || "").split(/\r?\n/).map((line) => {
    const [service, hours, rate, materials, markup] = line.split("|").map((part) => part.trim());
    if (!service) return null;
    return {
      service,
      hours: Number(hours || 1),
      rate: Number(rate || company?.hourly_rate || 85),
      materials: Number(materials || 0),
      markup: Number(markup || 25)
    };
  }).filter(Boolean);
}

function parseMaterials(value) {
  return String(value || "").split(/\r?\n/).map((line) => {
    const [item, unit, cost, stock, reorder] = line.split("|").map((part) => part.trim());
    if (!item) return null;
    return { item, unit: unit || "unit", cost: Number(cost || 0), stock: Number(stock || 0), reorder: Number(reorder || 0) };
  }).filter(Boolean);
}

function parseContracts(value) {
  return String(value || "").split(/\r?\n/).map((line) => {
    const [client, service, frequency, amount, next] = line.split("|").map((part) => part.trim());
    if (!client) return null;
    return { client, service: service || "Maintenance", frequency: frequency || "Monthly", amount: Number(amount || 0), next: next || "TBC" };
  }).filter(Boolean);
}

function renderAll() {
  renderCompany();
  renderPlan();
  renderOnboarding();
  renderMetrics();
  renderActions();
  renderLeads();
  renderQuotes();
  renderJobs();
  renderSchedule();
  renderRoutes();
  renderCrew();
  renderMaterials();
  renderContracts();
  renderInvoices();
  renderReports();
  renderPortal();
  renderAutomations();
}

function applyRoleAccess() {
  if (profile?.role !== "crew") return;
  document.querySelectorAll(".app-nav button").forEach((button) => {
    const allowed = ["crew", "schedule"].includes(button.dataset.view);
    button.hidden = !allowed;
  });
  document.querySelector(".admin-link").hidden = true;
  document.querySelector("[data-action='new-lead']").hidden = true;
  switchView("crew");
}

function switchView(view) {
  document.querySelectorAll(".app-nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  document.querySelectorAll(".view").forEach((section) => section.classList.remove("active"));
  document.querySelector(`#${view}-view`).classList.add("active");
  document.querySelector("#view-title").textContent = {
    dashboard: "Operations cockpit",
    onboarding: "Onboarding",
    leads: "Lead pipeline",
    quotes: "Quote builder",
    jobs: "Job board",
    schedule: "Crew schedule",
    routes: "Route planning",
    crew: "Crew mobile",
    materials: "Materials and stock",
    contracts: "Recurring contracts",
    invoices: "Invoices",
    reports: "Reports",
    portal: "Client portal",
    automations: "Automations",
    settings: "Settings"
  }[view];
}

async function createLead(payload) {
  return workspaceAction({ action: "createLead", ...payload });
}

async function createQuote(payload) {
  if (!payload.leadId) throw new Error("Create a lead first.");
  const result = await workspaceAction({ action: "createQuote", ...payload });
  return result.amount;
}

document.querySelectorAll(".app-nav button").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelectorAll("[data-action='new-quote']").forEach((button) => {
  button.addEventListener("click", () => switchView("quotes"));
});

document.querySelector("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  const submitter = event.submitter?.dataset.authMode || "signin";
  try {
    const result = submitter === "signup"
      ? await supabaseClient.auth.signUp({ email: payload.email, password: payload.password })
      : await supabaseClient.auth.signInWithPassword({ email: payload.email, password: payload.password });
    if (result.error) throw result.error;
    showToast(submitter === "signup" ? "Account created. Check your inbox and spam folder for the confirmation email." : "Signed in.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#signup-button").addEventListener("click", () => {
  const submit = document.querySelector("#auth-form button[type='submit']");
  submit.dataset.authMode = "signup";
  submit.click();
  submit.dataset.authMode = "signin";
});

document.querySelector("#resend-confirmation").addEventListener("click", async () => {
  const email = document.querySelector("#auth-form [name='email']").value;
  if (!email) {
    showToast("Enter your email first, then click resend.");
    return;
  }

  try {
    const { error } = await supabaseClient.auth.resend({ type: "signup", email });
    if (error) throw error;
    showToast("Confirmation email requested again. Check inbox and spam.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#sign-out").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  setLocked(true);
});

document.querySelector("#copy-booking-link").addEventListener("click", async () => {
  const input = document.querySelector("#booking-link");
  if (!input.value) return;
  await navigator.clipboard.writeText(input.value);
  showToast("Booking link copied.");
});

document.querySelector("#employees-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = formPayload(event.currentTarget);
    const result = await workspaceAction({ action: "saveEmployees", ...payload });
    state.automations.employees = result.employees;
    renderCompany();
    showToast("Employees saved.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#templates-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const templates = parseTemplates(new FormData(event.currentTarget).get("templates"));
    const result = await workspaceAction({ action: "saveServiceTemplates", templates });
    state.automations.serviceTemplates = result.templates;
    renderCompany();
    showToast("Service templates saved.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#materials-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const materials = parseMaterials(new FormData(event.currentTarget).get("materials"));
    const result = await workspaceAction({ action: "saveWorkspaceSettings", materials });
    state.automations = result.settings;
    renderAll();
    showToast("Materials saved.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#contracts-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const contracts = parseContracts(new FormData(event.currentTarget).get("contracts"));
    const result = await workspaceAction({ action: "saveWorkspaceSettings", contracts });
    state.automations = result.settings;
    renderAll();
    showToast("Contracts saved.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#multi-crew-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = new FormData(event.currentTarget);
    const depots = String(form.get("depots") || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const permissions = String(form.get("permissions") || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const result = await workspaceAction({ action: "saveWorkspaceSettings", depots, permissions });
    state.automations = result.settings;
    renderAll();
    showToast("Team controls saved.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#service-template").addEventListener("change", (event) => {
  const template = serviceTemplates()[Number(event.currentTarget.value)];
  if (!template) return;
  const form = document.querySelector("#quote-form");
  form.service.value = template.service;
  form.hours.value = template.hours;
  form.rate.value = template.rate;
  form.materials.value = template.materials;
  form.markup.value = template.markup;
});

document.querySelector("#copy-portal-link").addEventListener("click", async () => {
  const input = document.querySelector("#portal-booking-link");
  if (!input.value) return;
  await navigator.clipboard.writeText(input.value);
  showToast("Client portal link copied.");
});

document.querySelector("#export-calendar").addEventListener("click", () => {
  const dayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const events = state.jobs.map((job) => {
    const lead = leadById(job.lead_id);
    const date = nextWeekdayStamp(dayIndex[job.day] ?? 1);
    return [
      "BEGIN:VEVENT",
      `UID:${job.id}@terraindesk`,
      `DTSTAMP:${date}T080000Z`,
      `DTSTART:${date}T080000Z`,
      `DTEND:${date}T100000Z`,
      `SUMMARY:${job.service}`,
      `DESCRIPTION:${lead.name} - ${lead.suburb || ""} - ${job.crew || ""}`,
      "END:VEVENT"
    ].join("\r\n");
  }).join("\r\n");
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//TerrainDesk//Schedule//EN\r\n${events}\r\nEND:VCALENDAR`;
  downloadText("terraindesk-schedule.ics", ics, "text/calendar");
});

document.querySelector("#export-routes").addEventListener("click", () => {
  const rows = [["Day", "Order", "Client", "Suburb", "Service", "Employees"]];
  ["Mon", "Tue", "Wed", "Thu", "Fri"].forEach((day) => {
    state.jobs.filter((job) => job.day === day && !["Complete", "Proposed", "Blocked"].includes(job.status)).forEach((job, index) => {
      const lead = leadById(job.lead_id);
      rows.push([day, index + 1, lead.name, lead.suburb || "", job.service, job.crew || ""]);
    });
  });
  downloadCsv("terraindesk-routes.csv", rows);
});

document.querySelector("#export-xero").addEventListener("click", () => {
  const rows = [
    ["ContactName", "EmailAddress", "InvoiceNumber", "Reference", "DueDate", "Description", "Quantity", "UnitAmount", "AccountCode", "TaxType"],
    ...state.invoices.map((invoice) => {
      const lead = leadById(invoice.lead_id);
      return [lead.name, lead.email || "", String(invoice.id).slice(0, 8), "TerrainDesk", invoice.due || "", "Landscaping services", "1", invoice.amount || 0, "200", "OUTPUT"];
    })
  ];
  downloadCsv("xero-invoices.csv", rows);
});

document.querySelector("#export-quickbooks").addEventListener("click", () => {
  const rows = [
    ["Customer", "Email", "InvoiceNo", "InvoiceDate", "DueDate", "Product", "Description", "Amount", "TaxCode"],
    ...state.invoices.map((invoice) => {
      const lead = leadById(invoice.lead_id);
      return [lead.name, lead.email || "", String(invoice.id).slice(0, 8), new Date().toISOString().slice(0, 10), invoice.due || "", "Landscaping services", "TerrainDesk job invoice", invoice.amount || 0, "GST"];
    })
  ];
  downloadCsv("quickbooks-invoices.csv", rows);
});

document.querySelector("#export-materials").addEventListener("click", () => {
  downloadCsv("terraindesk-materials.csv", [["Item", "Unit", "Cost", "Stock", "Reorder"], ...materialsList().map((item) => [item.item, item.unit, item.cost, item.stock, item.reorder])]);
});

document.querySelector("#export-report").addEventListener("click", () => {
  downloadCsv("terraindesk-report.csv", [
    ["Metric", "Value"],
    ["Leads", state.leads.length],
    ["Quotes", state.quotes.length],
    ["Jobs", state.jobs.length],
    ["Invoices", state.invoices.length],
    ["Contracts", contractsList().length]
  ]);
});

document.querySelector("#export-zapier").addEventListener("click", () => {
  downloadText("terraindesk-zapier-export.json", JSON.stringify({
    exportedAt: new Date().toISOString(),
    company,
    leads: state.leads,
    quotes: state.quotes,
    jobs: state.jobs,
    invoices: state.invoices
  }, null, 2), "application/json");
});

document.querySelector("#export-drive").addEventListener("click", () => {
  downloadText("terraindesk-proof-archive-manifest.json", JSON.stringify({
    exportedAt: new Date().toISOString(),
    folder: `${company?.name || "TerrainDesk"} / Job proofs`,
    jobs: state.jobs.map((job) => ({
      jobId: job.id,
      client: leadById(job.lead_id).name,
      service: job.service,
      checklist: job.checklist || [],
      suggestedFiles: ["before-photos", "after-photos", "client-signoff"]
    }))
  }, null, 2), "application/json");
});

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(filename, rows) {
  downloadText(filename, rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n"), "text/csv");
}

function nextWeekdayStamp(targetDay) {
  const date = new Date();
  const diff = (targetDay - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + diff);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

document.querySelectorAll("[data-action='new-lead']").forEach((button) => {
  button.addEventListener("click", () => document.querySelector("#lead-modal").showModal());
});

document.querySelector("[data-close-lead]").addEventListener("click", () => document.querySelector("#lead-modal").close());
document.querySelector("[data-close-schedule]").addEventListener("click", () => document.querySelector("#schedule-modal").close());
document.querySelector("[data-close-job]").addEventListener("click", () => document.querySelector("#job-modal").close());

document.querySelector("#onboarding-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const onboarding = Object.fromEntries(new FormData(event.currentTarget));
    const result = await workspaceAction({ action: "saveWorkspaceSettings", onboarding });
    state.automations = result.settings;
    renderAll();
    showToast("Onboarding saved.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#copy-onboarding-summary").addEventListener("click", async () => {
  const data = onboardingData();
  const summary = [
    `Company: ${company?.name || ""}`,
    `Plan: ${currentPlan()}`,
    `Service area: ${data.serviceArea || ""}`,
    `Phone: ${data.businessPhone || ""}`,
    `Work hours: ${data.workHours || ""}`,
    `Payment terms: ${data.paymentTerms || ""}`,
    `Booking link: ${company?.id ? `${window.location.origin}/b?c=${company.id}` : ""}`
  ].join("\n");
  await navigator.clipboard.writeText(summary);
  showToast("Onboarding summary copied.");
});

document.querySelector("#job-detail-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    const jobId = form.jobId.value;
    const nextMeta = {
      ...jobMeta(),
      [jobId]: {
        note: form.note.value.trim(),
        proof: form.proof.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        updatedAt: new Date().toISOString()
      }
    };
    const result = await workspaceAction({ action: "saveWorkspaceSettings", jobMeta: nextMeta });
    state.automations = result.settings;
    document.querySelector("#job-modal").close();
    renderAll();
    showToast("Job timeline saved.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#lead-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await createLead(Object.fromEntries(new FormData(event.currentTarget)));
    event.currentTarget.reset();
    document.querySelector("#lead-modal").close();
    await refresh();
    showToast("Lead created.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#quote-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const amount = await createQuote(formPayload(event.currentTarget));
    await refresh();
    showToast(`Quote created for ${money(amount)} including GST.`);
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#schedule-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await workspaceAction({ action: "scheduleQuote", ...formPayload(form) });
    form.reset();
    document.querySelector("#schedule-modal").close();
    await refresh();
    showToast("Job scheduled.");
  } catch (error) {
    showToast(error.message);
  }
});

function timelineForJob(job) {
  const lead = leadById(job.lead_id);
  const quote = state.quotes.find((item) => item.id === job.quote_id);
  const invoice = state.invoices.find((item) => item.lead_id === job.lead_id && Number(item.amount) === Number(job.amount || quote?.amount || 0));
  return [
    ["Lead captured", `${lead.name} requested ${lead.service || job.service}.`],
    ["Quote created", quote ? `${money(quote.amount)} - ${quote.status}` : "No quote linked."],
    ["Appointment proposed", `${job.day || "TBC"} - ${job.crew || "Unassigned"}`],
    ["Job status", job.status || "Scheduled"],
    ["Proof", metaForJob(job.id).proof.length ? `${metaForJob(job.id).proof.length} proof items saved.` : "No proof items yet."],
    ["Invoice", invoice ? `${money(invoice.amount)} - ${invoice.status}` : "Invoice not generated yet."]
  ];
}

function openJobDetail(jobId) {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) return;
  const meta = metaForJob(job.id);
  const form = document.querySelector("#job-detail-form");
  form.jobId.value = job.id;
  form.note.value = meta.note || "";
  form.proof.value = (meta.proof || []).join("\n");
  document.querySelector("#job-detail-title").textContent = `${job.service} - ${leadById(job.lead_id).name}`;
  document.querySelector("#job-timeline").innerHTML = timelineForJob(job).map(([title, detail]) => `
    <article class="timeline-item">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(detail)}</p>
    </article>
  `).join("");
  document.querySelector("#job-modal").showModal();
}

function invoiceHtml(invoice) {
  const lead = leadById(invoice.lead_id);
  const terms = onboardingData().paymentTerms || "Due 7 days after invoice";
  return `<!doctype html>
    <html><head><title>Invoice ${String(invoice.id).slice(0, 8)}</title>
    <style>
      body{font-family:Arial,sans-serif;margin:40px;color:#17201b}
      .top{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #17201b;padding-bottom:24px}
      h1{font-size:44px;margin:0}.muted{color:#647067}.total{font-size:34px;font-weight:800}
      table{width:100%;border-collapse:collapse;margin-top:34px}td,th{padding:14px;border-bottom:1px solid #ddd;text-align:left}
      .foot{margin-top:36px;padding:18px;background:#f5f2ea;border-radius:12px}
      @media print{button{display:none}}
    </style></head><body>
      <button onclick="window.print()">Print / Save PDF</button>
      <section class="top">
        <div><h1>Invoice</h1><p class="muted">${escapeHtml(company?.name || "TerrainDesk customer")}</p><p>ABN: ${escapeHtml(company?.abn || "")}</p></div>
        <div><strong>#${escapeHtml(String(invoice.id).slice(0, 8))}</strong><p>Due ${escapeHtml(invoice.due || "")}</p><p>Status: ${escapeHtml(invoice.status)}</p></div>
      </section>
      <p><strong>Bill to:</strong><br>${escapeHtml(lead.name)}<br>${escapeHtml(lead.email || "")}<br>${escapeHtml(lead.suburb || "")}</p>
      <table><thead><tr><th>Description</th><th>Qty</th><th>Amount</th></tr></thead><tbody>
        <tr><td>Landscaping services</td><td>1</td><td>${escapeHtml(money(invoice.amount))}</td></tr>
      </tbody></table>
      <p class="total">Total ${escapeHtml(money(invoice.amount))}</p>
      <div class="foot"><strong>Terms</strong><p>${escapeHtml(terms)}</p></div>
    </body></html>`;
}

function printInvoice(invoiceId) {
  const invoice = state.invoices.find((item) => item.id === invoiceId);
  if (!invoice) return;
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) {
    showToast("Popup blocked. Allow popups to print invoices.");
    return;
  }
  win.document.write(invoiceHtml(invoice));
  win.document.close();
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target || !profile) return;

  try {
    if (target.dataset.buildQuote) {
      switchView("quotes");
      document.querySelector("#quote-lead").value = target.dataset.buildQuote;
    }

    if (target.dataset.contactLead) {
      await workspaceAction({ action: "updateLead", leadId: target.dataset.contactLead, status: "Contacted" });
      await refresh();
      showToast("Lead marked contacted.");
    }

    if (target.dataset.deleteLead) {
      if (!window.confirm("Delete this lead and related quotes, jobs and invoices?")) return;
      await workspaceAction({ action: "deleteLead", leadId: target.dataset.deleteLead });
      await refresh();
      showToast("Lead deleted.");
    }

    if (target.dataset.deleteQuote) {
      if (!window.confirm("Delete this quote and any job created from it?")) return;
      await workspaceAction({ action: "deleteQuote", quoteId: target.dataset.deleteQuote });
      await refresh();
      showToast("Quote deleted.");
    }

    if (target.dataset.scheduleQuote) {
      const scheduleQuote = state.quotes.find((item) => item.id === target.dataset.scheduleQuote);
      if (!scheduleQuote) return;
      document.querySelector("#schedule-form [name='quoteId']").value = scheduleQuote.id;
      document.querySelector("#schedule-modal").showModal();
    }

    if (target.dataset.viewJob) {
      openJobDetail(target.dataset.viewJob);
    }

    if (target.dataset.startJob) {
      await workspaceAction({ action: "updateJob", jobId: target.dataset.startJob, status: "In progress" });
      await refresh();
      showToast("Job started.");
    }

    if (target.dataset.blockJob) {
      await workspaceAction({ action: "updateJob", jobId: target.dataset.blockJob, status: "Blocked" });
      await refresh();
      showToast("Job blocked.");
    }

    if (target.dataset.completeJob) {
      await workspaceAction({ action: "updateJob", jobId: target.dataset.completeJob, status: "Complete" });
      await refresh();
      showToast("Job completed. Ready to invoice.");
    }

    if (target.dataset.invoiceJob) {
      await workspaceAction({ action: "createInvoice", jobId: target.dataset.invoiceJob });
      await refresh();
      showToast("Invoice generated.");
    }

    if (target.dataset.payInvoice) {
      await workspaceAction({ action: "updateInvoice", invoiceId: target.dataset.payInvoice, status: "Paid" });
      await refresh();
      showToast("Invoice marked paid.");
    }

    if (target.dataset.printInvoice) {
      printInvoice(target.dataset.printInvoice);
    }

    if (target.dataset.emailQuote) {
      const quote = state.quotes.find((item) => item.id === target.dataset.emailQuote);
      if (!quote) return;
      const proposed = state.jobs.find((job) => job.quote_id === quote.id && ["Proposed", "Scheduled"].includes(job.status));
      await sendCustomerMessage({
        type: "quote",
        quoteId: quote.id,
        leadId: quote.lead_id,
        service: quote.service,
        amount: quote.amount,
        day: proposed?.day
      });
      await supabaseClient.from("quotes").update({ status: "Sent" }).eq("id", quote.id);
      showToast("Quote email sent.");
    }

    if (target.dataset.emailInvoice || target.dataset.remindInvoice) {
      const invoice = state.invoices.find((item) => item.id === (target.dataset.emailInvoice || target.dataset.remindInvoice));
      if (!invoice) return;
      await sendCustomerMessage({
        type: target.dataset.remindInvoice ? "reminder" : "invoice",
        leadId: invoice.lead_id,
        amount: invoice.amount,
        due: invoice.due
      });
      showToast(target.dataset.remindInvoice ? "Invoice reminder sent." : "Invoice email sent.");
    }

    if (target.dataset.automation) {
      state.automations[target.dataset.automation] = !state.automations[target.dataset.automation];
      const { error } = await supabaseClient.from("automation_settings").upsert({
        company_id: profile.company_id,
        settings: state.automations,
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
      renderAutomations();
    }
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#company-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const response = await fetch("/api/update-company", {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not update company.");
    await ensureProfile();
    renderCompany();
    showToast("Company settings saved.");
  } catch (error) {
    showToast(error.message);
  }
});

setLocked(true);
initSupabase().catch((error) => showToast(error.message));
