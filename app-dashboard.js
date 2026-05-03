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
  const [leadsResult, quotesResult, jobsResult, invoicesResult, automationResult] = await Promise.all([
    supabaseClient.from("leads").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("quotes").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("jobs").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("invoices").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("automation_settings").select("*").eq("company_id", profile.company_id).limit(1)
  ]);

  for (const result of [leadsResult, quotesResult, jobsResult, invoicesResult, automationResult]) {
    if (result.error) throw result.error;
  }

  state = {
    leads: leadsResult.data || [],
    quotes: quotesResult.data || [],
    jobs: jobsResult.data || [],
    invoices: invoicesResult.data || [],
    automations: automationResult.data?.[0]?.settings || Object.fromEntries(automations.map(([key]) => [key, true]))
  };
}

async function refresh() {
  await loadWorkspace();
  renderAll();
}

function renderMetrics() {
  const revenue = state.invoices.filter((invoice) => invoice.status === "Paid").reduce((sum, invoice) => sum + Number(invoice.amount), 0);
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
    return `
      <article class="card">
        <span>${escapeHtml(lead.name)} - ${escapeHtml(lead.suburb || "")}</span>
        <h3>${escapeHtml(quote.service)}</h3>
        <strong>${money(quote.amount)}</strong>
        <p>Margin ${escapeHtml(quote.margin || 0)}% - ${escapeHtml(quote.status)}</p>
        <div class="card-actions">
          ${quote.status === "Sent" ? `<button class="mini-btn" data-accept-quote="${quote.id}">Accept quote</button>` : ""}
          <button class="mini-btn" data-email-quote="${quote.id}">Email quote</button>
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
            <p>${escapeHtml(lead.name)} - ${escapeHtml(lead.suburb || "")}<br>${escapeHtml(job.crew || "North crew")} - ${escapeHtml(job.day || "Tue")}</p>
            <div class="card-actions">
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
      ${state.jobs.filter((job) => job.day === day).map((job) => `<div class="job-card"><strong>${escapeHtml(job.service)}</strong><p>${escapeHtml(leadById(job.lead_id).suburb || "")}<br>${escapeHtml(job.crew || "")}</p></div>`).join("") || `<p class="empty-state">Open capacity.</p>`}
    </section>
  `).join("");
}

function renderCrew() {
  document.querySelector("#crew-jobs").innerHTML = state.jobs.filter((job) => job.status !== "Complete").map((job) => `
    <article class="crew-job">
      <span>${escapeHtml(job.day || "Tue")} - ${escapeHtml(job.crew || "North crew")}</span>
      <h3>${escapeHtml(job.service)}</h3>
      <p>${escapeHtml(leadById(job.lead_id).name)} - ${escapeHtml(leadById(job.lead_id).suburb || "")}</p>
      ${(job.checklist || []).map((item) => `<label><input type="checkbox"> ${escapeHtml(item)}</label>`).join("")}
      <button class="primary-btn" data-complete-job="${job.id}">Finish job</button>
    </article>
  `).join("") || `<p>No active route.</p>`;
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
        ${invoice.status !== "Paid" ? `<button class="mini-btn" data-remind-invoice="${invoice.id}">Remind</button><button class="mini-btn" data-pay-invoice="${invoice.id}">Mark paid</button>` : ""}
      </td>
    </tr>
  `).join("") || `<tr><td colspan="6">No invoices yet.</td></tr>`;
}

function renderAutomations() {
  document.querySelector("#automation-list").innerHTML = automations.map(([key, title, description]) => `
    <article class="automation-rule">
      <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></div>
      <button class="switch ${state.automations[key] ? "active" : ""}" data-automation="${key}" aria-label="${escapeHtml(title)}"></button>
    </article>
  `).join("");
}

function renderCompany() {
  document.querySelector(".app-topbar .eyebrow").textContent = company?.name || "TerrainDesk workspace";
  document.querySelector("#company-form [name='name']").value = company?.name || "";
  document.querySelector("#company-form [name='abn']").value = company?.abn || "";
  const bookingInput = document.querySelector("#booking-link");
  if (bookingInput && company?.id) {
    bookingInput.value = `${window.location.origin}/book.html?company=${company.id}`;
  }
}

function renderAll() {
  renderCompany();
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

document.querySelectorAll("[data-action='new-lead']").forEach((button) => {
  button.addEventListener("click", () => document.querySelector("#lead-modal").showModal());
});

document.querySelector("[data-close-lead]").addEventListener("click", () => document.querySelector("#lead-modal").close());

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
    const amount = await createQuote(Object.fromEntries(new FormData(event.currentTarget)));
    await refresh();
    showToast(`Quote created for ${money(amount)} including GST.`);
  } catch (error) {
    showToast(error.message);
  }
});

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

    if (target.dataset.acceptQuote) {
      const quote = state.quotes.find((item) => item.id === target.dataset.acceptQuote);
      if (!quote) return;
      await supabaseClient.from("quotes").update({ status: "Accepted" }).eq("id", quote.id);
      await supabaseClient.from("jobs").insert({
        company_id: profile.company_id,
        lead_id: quote.lead_id,
        quote_id: quote.id,
        service: quote.service,
        amount: quote.amount,
        crew: "North crew",
        day: "Tue",
        status: "Scheduled",
        checklist: ["Confirm access", "Load materials", "Before photos", "Client sign-off"]
      });
      await refresh();
      showToast("Quote accepted and job scheduled.");
    }

    if (target.dataset.startJob) {
      await supabaseClient.from("jobs").update({ status: "In progress" }).eq("id", target.dataset.startJob);
      await refresh();
      showToast("Job started.");
    }

    if (target.dataset.blockJob) {
      await supabaseClient.from("jobs").update({ status: "Blocked" }).eq("id", target.dataset.blockJob);
      await refresh();
      showToast("Job blocked.");
    }

    if (target.dataset.completeJob) {
      await supabaseClient.from("jobs").update({ status: "Complete" }).eq("id", target.dataset.completeJob);
      await refresh();
      showToast("Job completed. Ready to invoice.");
    }

    if (target.dataset.invoiceJob) {
      const job = state.jobs.find((item) => item.id === target.dataset.invoiceJob);
      if (!job) return;
      await supabaseClient.from("invoices").insert({
        company_id: profile.company_id,
        lead_id: job.lead_id,
        amount: job.amount,
        due: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        status: "Unpaid"
      });
      await refresh();
      showToast("Invoice generated.");
    }

    if (target.dataset.payInvoice) {
      await supabaseClient.from("invoices").update({ status: "Paid" }).eq("id", target.dataset.payInvoice);
      await refresh();
      showToast("Invoice marked paid.");
    }

    if (target.dataset.emailQuote) {
      const quote = state.quotes.find((item) => item.id === target.dataset.emailQuote);
      if (!quote) return;
      await sendCustomerMessage({
        type: "quote",
        leadId: quote.lead_id,
        service: quote.service,
        amount: quote.amount
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

document.querySelector("[data-seed]").addEventListener("click", async () => {
  if (!profile) return;
  try {
    await createLead({ name: "Amelia Hart", email: "amelia@example.com", phone: "+61 412 845 102", suburb: "Fremantle", service: "Garden cleanup", urgency: "This week" });
    await createLead({ name: "Marcus Venn", email: "marcus@example.com", phone: "+61 421 330 994", suburb: "Subiaco", service: "Maintenance contract", urgency: "Next 2 weeks" });
    await refresh();
    showToast("Demo leads added.");
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
