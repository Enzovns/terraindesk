const STORAGE_KEY = "terraindeskWorkspaceV1";
const toast = document.querySelector("#app-toast");
let toastTimer;

const automations = [
  ["quoteFollowUp", "Quote follow-up after 48 hours", "Send a calm reminder when a quote has not been accepted."],
  ["crewReminder", "Crew reminder the night before", "Send tomorrow's route and materials checklist to crew leads."],
  ["photoRequest", "Pre-visit photo request", "Ask clients for site photos before the first visit."],
  ["reviewRequest", "Review request after completion", "Ask for a Google review after the job is signed off."],
  ["invoiceReminder", "Invoice reminder after due date", "Send an overdue payment reminder automatically."],
  ["marginAlert", "Margin alert under 25%", "Notify the owner before a low-margin quote is sent."]
];

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function money(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function seedState() {
  return {
    company: {
      name: "Green Ridge Landscapes",
      abn: "53 004 085 616",
      hourlyRate: 85,
      gst: "GST included"
    },
    leads: [
      { id: "lead_1", name: "Amelia Hart", email: "amelia@example.com", phone: "+61 412 845 102", suburb: "Fremantle", service: "Garden cleanup", urgency: "This week", status: "New" },
      { id: "lead_2", name: "Marcus Venn", email: "marcus@example.com", phone: "+61 421 330 994", suburb: "Subiaco", service: "Maintenance contract", urgency: "Next 2 weeks", status: "Visit booked" },
      { id: "lead_3", name: "Priya Nair", email: "priya@example.com", phone: "+61 433 760 221", suburb: "Cottesloe", service: "Irrigation repair", urgency: "This week", status: "Quoted" }
    ],
    quotes: [
      { id: "quote_1", leadId: "lead_3", service: "Irrigation repair and pressure test", amount: 1840, margin: 32, status: "Sent", createdAt: "2026-05-03" }
    ],
    jobs: [
      { id: "job_1", leadId: "lead_2", quoteId: "", service: "Weekly commercial maintenance", amount: 960, crew: "North crew", day: "Mon", status: "Scheduled", checklist: ["Mow frontage", "Trim hedges", "Blow paths"] }
    ],
    invoices: [
      { id: "INV-1007", leadId: "lead_2", amount: 960, due: "2026-05-08", status: "Unpaid" }
    ],
    automations: Object.fromEntries(automations.map(([key]) => [key, true]))
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    const initial = seedState();
    saveState(initial);
    return initial;
  }
  return JSON.parse(saved);
}

function saveState(nextState = state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
}

let state = loadState();

function leadById(id) {
  return state.leads.find((lead) => lead.id === id) || { name: "Unknown client", suburb: "Unknown" };
}

function renderMetrics() {
  const revenue = state.invoices.filter((invoice) => invoice.status === "Paid").reduce((sum, invoice) => sum + invoice.amount, 0);
  const waitingQuotes = state.quotes.filter((quote) => quote.status === "Sent").length;
  const scheduledJobs = state.jobs.filter((job) => job.status !== "Complete").length;
  const overdue = state.invoices.filter((invoice) => invoice.status === "Overdue").length;
  document.querySelector("#metric-revenue").textContent = money(revenue);
  document.querySelector("#metric-quotes").textContent = waitingQuotes;
  document.querySelector("#metric-jobs").textContent = scheduledJobs;
  document.querySelector("#metric-overdue").textContent = overdue;
}

function renderActions() {
  const actions = [
    ...state.leads.filter((lead) => lead.status === "New").map((lead) => [`Call ${lead.name}`, `${lead.service} in ${lead.suburb}`, "Create quote"]),
    ...state.quotes.filter((quote) => quote.status === "Sent").map((quote) => [`Follow up quote for ${leadById(quote.leadId).name}`, `${money(quote.amount)} waiting approval`, "Mark accepted"]),
    ...state.invoices.filter((invoice) => invoice.status !== "Paid").map((invoice) => [`Invoice ${invoice.id}`, `${money(invoice.amount)} due ${invoice.due}`, "Remind"])
  ].slice(0, 6);

  document.querySelector("#action-list").innerHTML = actions.map(([title, detail, action]) => `
    <div class="action-item">
      <div><strong>${title}</strong><p>${detail}</p></div>
      <button class="mini-btn">${action}</button>
    </div>
  `).join("") || `<div class="action-item"><strong>Nothing urgent</strong><p>Your operation is clear for now.</p></div>`;
}

function renderLeads() {
  document.querySelector("#leads-table").innerHTML = state.leads.map((lead) => `
    <tr>
      <td><strong>${lead.name}</strong><br><span>${lead.email}</span></td>
      <td>${lead.suburb}</td>
      <td>${lead.service}</td>
      <td><span class="pill ${lead.urgency === "This week" ? "danger-pill" : ""}">${lead.urgency}</span></td>
      <td><span class="pill">${lead.status}</span></td>
      <td><button class="mini-btn" data-build-quote="${lead.id}">Quote</button></td>
    </tr>
  `).join("");
  document.querySelector("#quote-lead").innerHTML = state.leads.map((lead) => `<option value="${lead.id}">${lead.name} · ${lead.suburb}</option>`).join("");
}

function renderQuotes() {
  document.querySelector("#quotes-list").innerHTML = state.quotes.map((quote) => {
    const lead = leadById(quote.leadId);
    return `
      <article class="card">
        <span>${lead.name} · ${lead.suburb}</span>
        <h3>${quote.service}</h3>
        <strong>${money(quote.amount)}</strong>
        <p>Margin ${quote.margin}% · ${quote.status}</p>
        <div class="card-actions">
          ${quote.status === "Sent" ? `<button class="mini-btn" data-accept-quote="${quote.id}">Accept quote</button>` : ""}
          <button class="mini-btn" data-email-quote="${quote.id}">Email quote</button>
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
        const lead = leadById(job.leadId);
        return `
          <article class="job-card">
            <strong>${job.service}</strong>
            <p>${lead.name} · ${lead.suburb}<br>${job.crew} · ${job.day}</p>
            <div class="card-actions">
              ${job.status === "Scheduled" ? `<button class="mini-btn" data-start-job="${job.id}">Start</button>` : ""}
              ${job.status === "In progress" ? `<button class="mini-btn" data-complete-job="${job.id}">Complete</button>` : ""}
              ${job.status === "Complete" ? `<button class="mini-btn" data-invoice-job="${job.id}">Invoice</button>` : ""}
            </div>
          </article>
        `;
      }).join("")}
    </section>
  `).join("");
}

function renderSchedule() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  document.querySelector("#schedule-grid").innerHTML = days.map((day) => `
    <section class="schedule-day">
      <h3>${day}</h3>
      ${state.jobs.filter((job) => job.day === day).map((job) => `<div class="job-card"><strong>${job.service}</strong><p>${leadById(job.leadId).suburb}<br>${job.crew}</p></div>`).join("")}
    </section>
  `).join("");
}

function renderCrew() {
  document.querySelector("#crew-jobs").innerHTML = state.jobs.filter((job) => job.status !== "Complete").map((job) => `
    <article class="crew-job">
      <span>${job.day} · ${job.crew}</span>
      <h3>${job.service}</h3>
      <p>${leadById(job.leadId).name} · ${leadById(job.leadId).suburb}</p>
      ${job.checklist.map((item) => `<label><input type="checkbox"> ${item}</label>`).join("")}
      <button class="primary-btn" data-complete-job="${job.id}">Finish job</button>
    </article>
  `).join("") || `<p>No active route.</p>`;
}

function renderInvoices() {
  document.querySelector("#invoices-table").innerHTML = state.invoices.map((invoice) => `
    <tr>
      <td><strong>${invoice.id}</strong></td>
      <td>${leadById(invoice.leadId).name}</td>
      <td>${money(invoice.amount)}</td>
      <td>${invoice.due}</td>
      <td><span class="pill ${invoice.status === "Paid" ? "success-pill" : invoice.status === "Overdue" ? "danger-pill" : ""}">${invoice.status}</span></td>
      <td>${invoice.status !== "Paid" ? `<button class="mini-btn" data-pay-invoice="${invoice.id}">Mark paid</button>` : ""}</td>
    </tr>
  `).join("");
}

function renderAutomations() {
  document.querySelector("#automation-list").innerHTML = automations.map(([key, title, description]) => `
    <article class="automation-rule">
      <div><strong>${title}</strong><p>${description}</p></div>
      <button class="switch ${state.automations[key] ? "active" : ""}" data-automation="${key}" aria-label="${title}"></button>
    </article>
  `).join("");
}

function renderAll() {
  renderMetrics();
  renderActions();
  renderLeads();
  renderQuotes();
  renderJobs();
  renderSchedule();
  renderCrew();
  renderInvoices();
  renderAutomations();
}

function switchView(view) {
  document.querySelectorAll(".app-nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  document.querySelectorAll(".view").forEach((section) => section.classList.remove("active"));
  document.querySelector(`#${view}-view`).classList.add("active");
  document.querySelector("#view-title").textContent = {
    dashboard: "Operations cockpit",
    leads: "Lead pipeline",
    quotes: "Quote builder",
    jobs: "Job board",
    schedule: "Crew schedule",
    crew: "Crew mobile",
    invoices: "Invoices",
    automations: "Automations",
    settings: "Settings"
  }[view];
}

document.querySelectorAll(".app-nav button").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelectorAll("[data-action='new-lead']").forEach((button) => {
  button.addEventListener("click", () => document.querySelector("#lead-modal").showModal());
});

document.querySelector("[data-close-lead]").addEventListener("click", () => document.querySelector("#lead-modal").close());

document.querySelector("#lead-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  state.leads.unshift({ id: uid("lead"), ...payload, status: "New" });
  saveState();
  event.currentTarget.reset();
  document.querySelector("#lead-modal").close();
  renderAll();
  showToast("Lead created.");
});

document.querySelector("#quote-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  const base = Number(payload.hours) * Number(payload.rate) + Number(payload.materials);
  const amount = Math.round(base * (1 + Number(payload.markup) / 100) * 1.1);
  state.quotes.unshift({
    id: uid("quote"),
    leadId: payload.leadId,
    service: payload.service,
    amount,
    margin: Number(payload.markup),
    status: "Sent",
    createdAt: new Date().toISOString().slice(0, 10)
  });
  const lead = state.leads.find((item) => item.id === payload.leadId);
  if (lead) lead.status = "Quoted";
  saveState();
  renderAll();
  showToast(`Quote created for ${money(amount)} including GST.`);
});

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;

  if (target.dataset.buildQuote) {
    switchView("quotes");
    document.querySelector("#quote-lead").value = target.dataset.buildQuote;
  }

  if (target.dataset.acceptQuote) {
    const quote = state.quotes.find((item) => item.id === target.dataset.acceptQuote);
    if (!quote) return;
    quote.status = "Accepted";
    state.jobs.unshift({
      id: uid("job"),
      leadId: quote.leadId,
      quoteId: quote.id,
      service: quote.service,
      amount: quote.amount,
      crew: "North crew",
      day: "Tue",
      status: "Scheduled",
      checklist: ["Confirm access", "Load materials", "Before photos", "Client sign-off"]
    });
    saveState();
    renderAll();
    showToast("Quote accepted and job scheduled.");
  }

  if (target.dataset.startJob) {
    const job = state.jobs.find((item) => item.id === target.dataset.startJob);
    if (job) job.status = "In progress";
    saveState();
    renderAll();
    showToast("Job started.");
  }

  if (target.dataset.completeJob) {
    const job = state.jobs.find((item) => item.id === target.dataset.completeJob);
    if (job) job.status = "Complete";
    saveState();
    renderAll();
    showToast("Job completed. Ready to invoice.");
  }

  if (target.dataset.invoiceJob) {
    const job = state.jobs.find((item) => item.id === target.dataset.invoiceJob);
    if (!job) return;
    state.invoices.unshift({
      id: `INV-${1008 + state.invoices.length}`,
      leadId: job.leadId,
      amount: job.amount,
      due: "2026-05-17",
      status: "Unpaid"
    });
    saveState();
    renderAll();
    showToast("Invoice generated.");
  }

  if (target.dataset.payInvoice) {
    const invoice = state.invoices.find((item) => item.id === target.dataset.payInvoice);
    if (invoice) invoice.status = "Paid";
    saveState();
    renderAll();
    showToast("Invoice marked paid.");
  }

  if (target.dataset.automation) {
    state.automations[target.dataset.automation] = !state.automations[target.dataset.automation];
    saveState();
    renderAll();
  }

  if (target.dataset.emailQuote) {
    showToast("Quote email queued. Connect Resend template next.");
  }
});

document.querySelector("[data-seed]").addEventListener("click", () => {
  state = seedState();
  saveState();
  renderAll();
  showToast("Demo workspace reset.");
});

document.querySelector("#company-form").addEventListener("submit", (event) => {
  event.preventDefault();
  state.company = Object.fromEntries(new FormData(event.currentTarget));
  saveState();
  showToast("Company settings saved.");
});

renderAll();
