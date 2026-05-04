const toast = document.querySelector("#app-toast");
let toastTimer;
let adminKey = sessionStorage.getItem("terraindeskAdminKey") || "";
let state = {
  companies: [],
  profiles: [],
  leads: [],
  quotes: [],
  jobs: [],
  invoices: []
};

const planPrices = {
  Essential: 149,
  Operations: 329,
  "Multi-crew": 799
};

const statusLabels = {
  active: "Active",
  onboarding: "Onboarding",
  trialing: "Onboarding",
  past_due: "At risk",
  canceled: "At risk"
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
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-admin-key": adminKey,
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function ownerFor(companyId) {
  return state.profiles.find((profile) => profile.company_id === companyId);
}

function statusFor(company) {
  return statusLabels[company.subscription_status] || company.subscription_status || "Onboarding";
}

function stageFor(company) {
  const hasOwner = Boolean(ownerFor(company.id));
  if (company.subscription_status === "active") return "Active";
  if (company.subscription_status === "past_due" || company.subscription_status === "canceled") return "Needs attention";
  if (hasOwner) return "Workspace linked";
  return "Paid";
}

function renderMetrics() {
  const activeCompanies = state.companies.filter((company) => company.subscription_status === "active");
  const active = activeCompanies.length;
  const onboarding = state.companies.filter((company) => stageFor(company) !== "Active" && stageFor(company) !== "Needs attention").length;
  const risk = state.companies.filter((company) => stageFor(company) === "Needs attention").length;
  const mrr = activeCompanies.reduce((sum, company) => sum + (planPrices[company.plan] || 0), 0);
  document.querySelector("#admin-mrr").textContent = money(mrr);
  document.querySelector("#admin-active").textContent = active;
  document.querySelector("#admin-onboarding-count").textContent = onboarding;
  document.querySelector("#admin-risk").textContent = risk;
}

function renderFounderQueue() {
  const queue = state.companies.slice(0, 8);
  document.querySelector("#founder-queue").innerHTML = queue.length ? queue.map((company) => {
    const owner = ownerFor(company.id);
    const email = owner?.email || "";
    return `
      <div class="action-item">
        <div><strong>${escapeHtml(company.name)}</strong><p>${escapeHtml(stageFor(company))} - ${escapeHtml(company.plan || "No plan")} - ${escapeHtml(email || "No owner yet")}</p></div>
        <button class="mini-btn" data-send-link="${escapeHtml(email)}" ${email ? "" : "disabled"}>Send link</button>
      </div>
    `;
  }).join("") : `<p class="empty-state">No customers yet.</p>`;
}

function renderCustomers() {
  document.querySelector("#customers-table").innerHTML = state.companies.length ? state.companies.map((company) => {
    const owner = ownerFor(company.id);
    const status = statusFor(company);
    const pillClass = status === "Active" ? "success-pill" : status === "At risk" ? "danger-pill" : "";
    return `
      <tr>
        <td><strong>${escapeHtml(company.name)}</strong></td>
        <td>${escapeHtml(company.plan || "-")}</td>
        <td><span class="pill ${pillClass}">${status}</span></td>
        <td>${escapeHtml(owner?.email || "-")}</td>
        <td>${money(planPrices[company.plan])}</td>
        <td class="row-actions">
          <button class="mini-btn" data-activate="${company.id}">Mark active</button>
          <button class="mini-btn" data-send-link="${escapeHtml(owner?.email || "")}" ${owner?.email ? "" : "disabled"}>Send link</button>
        </td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="6">No customers yet.</td></tr>`;
}

function renderOnboarding() {
  const stages = ["Paid", "Workspace linked", "Active", "Needs attention"];
  document.querySelector("#onboarding-board").innerHTML = stages.map((stage) => `
    <section class="kanban-column">
      <h3>${stage}</h3>
      ${state.companies.filter((company) => stageFor(company) === stage).map((company) => {
        const owner = ownerFor(company.id);
        return `
          <article class="job-card">
            <strong>${escapeHtml(company.name)}</strong>
            <p>${escapeHtml(company.plan || "No plan")}<br>${escapeHtml(owner?.email || "No owner linked")}</p>
            <button class="mini-btn" data-activate="${company.id}">Mark active</button>
          </article>
        `;
      }).join("") || `<p class="empty-state">Nothing here.</p>`}
    </section>
  `).join("");
}

function renderRevenue() {
  document.querySelector("#revenue-list").innerHTML = state.companies.length ? state.companies.map((company) => `
    <div class="action-item">
      <div><strong>${escapeHtml(company.name)}</strong><p>${escapeHtml(company.plan || "No plan")} subscription - ${escapeHtml(statusFor(company))}</p></div>
      <strong>${money(planPrices[company.plan])}</strong>
    </div>
  `).join("") : `<p class="empty-state">No subscription revenue yet.</p>`;
}

function renderPlanMix() {
  const counts = state.companies.reduce((acc, company) => {
    if (company.plan) acc[company.plan] = (acc[company.plan] || 0) + 1;
    return acc;
  }, {});
  const topPlan = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "No customers yet";
  document.querySelector("#plan-mix").innerHTML = `
    <span>Most common</span>
    <strong>${escapeHtml(topPlan)}</strong>
    <p>${state.companies.length ? "Use this to keep demos and onboarding focused on the plan that is selling." : "Customers will appear here after checkout or manual creation."}</p>
  `;
}

function renderAll() {
  renderMetrics();
  renderFounderQueue();
  renderCustomers();
  renderOnboarding();
  renderRevenue();
  renderPlanMix();
}

function switchView(view) {
  document.querySelectorAll(".app-nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  document.querySelectorAll(".view").forEach((section) => section.classList.remove("active"));
  document.querySelector(`#${view}-view`).classList.add("active");
  document.querySelector("#view-title").textContent = {
    "admin-dashboard": "Admin overview",
    "admin-customers": "Customers",
    "admin-onboarding": "Onboarding",
    "admin-revenue": "Revenue"
  }[view];
}

async function loadAdminData() {
  const payload = await api("/api/admin-customers");
  state = payload;
  renderAll();
}

async function unlockAdmin(key) {
  adminKey = key.trim();
  sessionStorage.setItem("terraindeskAdminKey", adminKey);
  await loadAdminData();
  document.body.classList.remove("locked");
}

document.querySelector("#admin-key-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = new FormData(event.currentTarget).get("key");
  try {
    await unlockAdmin(key);
    showToast("Admin unlocked.");
  } catch (error) {
    sessionStorage.removeItem("terraindeskAdminKey");
    showToast(error.message);
  }
});

document.querySelectorAll(".app-nav button").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelector("#add-customer").addEventListener("click", () => document.querySelector("#customer-modal").showModal());
document.querySelector("[data-close-customer]").addEventListener("click", () => document.querySelector("#customer-modal").close());
document.querySelector("#refresh-admin").addEventListener("click", async () => {
  try {
    await loadAdminData();
    showToast("Admin refreshed.");
  } catch (error) {
    showToast(error.message);
  }
});
document.querySelector("#lock-admin").addEventListener("click", () => {
  sessionStorage.removeItem("terraindeskAdminKey");
  adminKey = "";
  document.body.classList.add("locked");
});

document.querySelector("#customer-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  try {
    await api("/api/admin-create-customer", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    form.reset();
    document.querySelector("#customer-modal").close();
    await loadAdminData();
    showToast("Customer created and workspace link sent.");
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;

  if (target.dataset.activate) {
    try {
      await api("/api/admin-update-customer", {
        method: "POST",
        body: JSON.stringify({ companyId: target.dataset.activate, subscription_status: "active" })
      });
      await loadAdminData();
      showToast("Customer marked active.");
    } catch (error) {
      showToast(error.message);
    }
  }

  if (target.dataset.sendLink) {
    try {
      await api("/api/send-workspace-link", {
        method: "POST",
        body: JSON.stringify({ email: target.dataset.sendLink })
      });
      showToast("Workspace link sent.");
    } catch (error) {
      showToast(error.message);
    }
  }
});

if (adminKey) {
  unlockAdmin(adminKey).catch(() => {
    sessionStorage.removeItem("terraindeskAdminKey");
    document.body.classList.add("locked");
  });
}
