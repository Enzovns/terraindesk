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
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
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
    ...state.leads.filter((lead) => lead.status === "New").map((lead) => [`Call ${lead.name}`, `${lead.service} in ${lead.suburb}`, "Create quote"]),
    ...state.quotes.filter((quote) => quote.status === "Sent").map((quote) => [`Follow up quote for ${leadById(quote.lead_id).name}`, `${money(quote.amount)} waiting approval`, "Mark accepted"]),
    ...state.invoices.filter((invoice) => invoice.status !== "Paid").map((invoice) => [`Invoice ${String(invoice.id).slice(0, 8)}`, `${money(invoice.amount)} due ${invoice.due || "soon"}`, "Remind"])
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
      <td><strong>${lead.name}</strong><br><span>${lead.email || ""}</span></td>
      <td>${lead.suburb || ""}</td>
      <td>${lead.service || ""}</td>
      <td><span class="pill ${lead.urgency === "This week" ? "danger-pill" : ""}">${lead.urgency || "Flexible"}</span></td>
      <td><span class="pill">${lead.status || "New"}</span></td>
      <td><button class="mini-btn" data-build-quote="${lead.id}">Quote</button></td>
    </tr>
  `).join("");
  document.querySelector("#quote-lead").innerHTML = state.leads.map((lead) => `<option value="${lead.id}">${lead.name} · ${lead.suburb || "No suburb"}</option>`).join("");
}

function renderQuotes() {
  document.querySelector("#quotes-list").innerHTML = state.quotes.map((quote) => {
    const lead = leadById(quote.lead_id);
    return `
      <article class="card">
        <span>${lead.name} · ${lead.suburb || ""}</span>
        <h3>${quote.service}</h3>
        <strong>${money(quote.amount)}</strong>
        <p>Margin ${quote.margin || 0}% · ${quote.status}</p>
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
        const lead = leadById(job.lead_id);
        return `
          <article class="job-card">
            <strong>${job.service}</strong>
            <p>${lead.name} · ${lead.suburb || ""}<br>${job.crew || "North crew"} · ${job.day || "Tue"}</p>
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
      ${state.jobs.filter((job) => job.day === day).map((job) => `<div class="job-card"><strong>${job.service}</strong><p>${leadById(job.lead_id).suburb || ""}<br>${job.crew || ""}</p></div>`).join("")}
    </section>
  `).join("");
}

function renderCrew() {
  document.querySelector("#crew-jobs").innerHTML = state.jobs.filter((job) => job.status !== "Complete").map((job) => `
    <article class="crew-job">
      <span>${job.day || "Tue"} · ${job.crew || "North crew"}</span>
      <h3>${job.service}</h3>
      <p>${leadById(job.lead_id).name} · ${leadById(job.lead_id).suburb || ""}</p>
      ${(job.checklist || []).map((item) => `<label><input type="checkbox"> ${item}</label>`).join("")}
      <button class="primary-btn" data-complete-job="${job.id}">Finish job</button>
    </article>
  `).join("") || `<p>No active route.</p>`;
}

function renderInvoices() {
  document.querySelector("#invoices-table").innerHTML = state.invoices.map((invoice) => `
    <tr>
      <td><strong>${String(invoice.id).slice(0, 8)}</strong></td>
      <td>${leadById(invoice.lead_id).name}</td>
      <td>${money(invoice.amount)}</td>
      <td>${invoice.due || ""}</td>
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

function renderCompany() {
  document.querySelector(".app-topbar .eyebrow").textContent = company?.name || "TerrainDesk workspace";
  document.querySelector("#company-form [name='name']").value = company?.name || "";
  document.querySelector("#company-form [name='abn']").value = company?.abn || "";
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
  const { error } = await supabaseClient.from("leads").insert({
    company_id: profile.company_id,
    ...payload,
    status: "New"
  });
  if (error) throw error;
}

async function createQuote(payload) {
  const base = Number(payload.hours) * Number(payload.rate) + Number(payload.materials);
  const amount = Math.round(base * (1 + Number(payload.markup) / 100) * 1.1);
  const { error } = await supabaseClient.from("quotes").insert({
    company_id: profile.company_id,
    lead_id: payload.leadId,
    service: payload.service,
    amount,
    margin: Number(payload.markup),
    status: "Sent"
  });
  if (error) throw error;
  await supabaseClient.from("leads").update({ status: "Quoted" }).eq("id", payload.leadId);
  return amount;
}

document.querySelectorAll(".app-nav button").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
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
    showToast(submitter === "signup" ? "Account created. Check your email if confirmation is enabled." : "Signed in.");
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

document.querySelector("#sign-out").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  setLocked(true);
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
    showToast("Lead created in Supabase.");
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

    if (target.dataset.emailQuote) {
      showToast("Quote email queued. Resend template comes next.");
    }
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("[data-seed]").addEventListener("click", async () => {
  if (!profile) return;
  try {
    await createLead({ name: "Amelia Hart", email: "amelia@example.com", phone: "+61 412 845 102", suburb: "Fremantle", service: "Garden cleanup", urgency: "This week", status: "New" });
    await createLead({ name: "Marcus Venn", email: "marcus@example.com", phone: "+61 421 330 994", suburb: "Subiaco", service: "Maintenance contract", urgency: "Next 2 weeks", status: "New" });
    await refresh();
    showToast("Demo leads added to Supabase.");
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
