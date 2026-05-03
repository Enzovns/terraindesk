const ADMIN_KEY = "terraindeskAdminV1";
const toast = document.querySelector("#app-toast");
let toastTimer;

const planPrices = {
  Essential: 149,
  Operations: 329,
  "Multi-crew": 799
};

function money(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function uid() {
  return `cust_${Math.random().toString(36).slice(2, 9)}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function seedAdmin() {
  return {
    customers: [
      { id: "cust_1", company: "Green Ridge Landscapes", email: "owner@greenridge.com", plan: "Operations", status: "Onboarding", stage: "Workflow map" },
      { id: "cust_2", company: "Coastal Grounds Co", email: "ops@coastalgrounds.com.au", plan: "Essential", status: "Active", stage: "Pilot launch" },
      { id: "cust_3", company: "Northbank Outdoor", email: "hello@northbank.com.au", plan: "Multi-crew", status: "At risk", stage: "Data import" }
    ]
  };
}

function loadAdmin() {
  const saved = localStorage.getItem(ADMIN_KEY);
  if (!saved) {
    const initial = seedAdmin();
    localStorage.setItem(ADMIN_KEY, JSON.stringify(initial));
    return initial;
  }
  return JSON.parse(saved);
}

let state = loadAdmin();

function saveAdmin() {
  localStorage.setItem(ADMIN_KEY, JSON.stringify(state));
}

function renderMetrics() {
  const active = state.customers.filter((customer) => customer.status === "Active").length;
  const onboarding = state.customers.filter((customer) => customer.status === "Onboarding").length;
  const risk = state.customers.filter((customer) => customer.status === "At risk").length;
  const mrr = state.customers.reduce((sum, customer) => sum + planPrices[customer.plan], 0);
  document.querySelector("#admin-mrr").textContent = money(mrr);
  document.querySelector("#admin-active").textContent = active;
  document.querySelector("#admin-onboarding-count").textContent = onboarding;
  document.querySelector("#admin-risk").textContent = risk;
}

function renderFounderQueue() {
  document.querySelector("#founder-queue").innerHTML = state.customers.map((customer) => `
    <div class="action-item">
      <div><strong>${customer.company}</strong><p>${customer.stage} · ${customer.plan} · ${customer.status}</p></div>
      <button class="mini-btn" data-email="${customer.id}">Email</button>
    </div>
  `).join("");
}

function renderCustomers() {
  document.querySelector("#customers-table").innerHTML = state.customers.map((customer) => `
    <tr>
      <td><strong>${customer.company}</strong></td>
      <td>${customer.plan}</td>
      <td><span class="pill ${customer.status === "Active" ? "success-pill" : customer.status === "At risk" ? "danger-pill" : ""}">${customer.status}</span></td>
      <td>${customer.email}</td>
      <td>${money(planPrices[customer.plan])}</td>
      <td><button class="mini-btn" data-activate="${customer.id}">Mark active</button></td>
    </tr>
  `).join("");
}

function renderOnboarding() {
  const stages = ["Workflow map", "Data import", "Pilot launch", "Active"];
  document.querySelector("#onboarding-board").innerHTML = stages.map((stage) => `
    <section class="kanban-column">
      <h3>${stage}</h3>
      ${state.customers.filter((customer) => customer.stage === stage).map((customer) => `
        <article class="job-card">
          <strong>${customer.company}</strong>
          <p>${customer.plan}<br>${customer.email}</p>
          <button class="mini-btn" data-next-stage="${customer.id}">Move next</button>
        </article>
      `).join("")}
    </section>
  `).join("");
}

function renderRevenue() {
  document.querySelector("#revenue-list").innerHTML = state.customers.map((customer) => `
    <div class="action-item">
      <div><strong>${customer.company}</strong><p>${customer.plan} subscription</p></div>
      <strong>${money(planPrices[customer.plan])}</strong>
    </div>
  `).join("");
}

function renderAll() {
  renderMetrics();
  renderFounderQueue();
  renderCustomers();
  renderOnboarding();
  renderRevenue();
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

document.querySelectorAll(".app-nav button").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelector("#add-customer").addEventListener("click", () => document.querySelector("#customer-modal").showModal());
document.querySelector("[data-close-customer]").addEventListener("click", () => document.querySelector("#customer-modal").close());

document.querySelector("#customer-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  state.customers.unshift({ id: uid(), ...payload, stage: "Workflow map" });
  saveAdmin();
  event.currentTarget.reset();
  document.querySelector("#customer-modal").close();
  renderAll();
  showToast("Customer added.");
});

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;

  if (target.dataset.activate) {
    const customer = state.customers.find((item) => item.id === target.dataset.activate);
    if (customer) {
      customer.status = "Active";
      customer.stage = "Active";
    }
    saveAdmin();
    renderAll();
    showToast("Customer marked active.");
  }

  if (target.dataset.nextStage) {
    const stages = ["Workflow map", "Data import", "Pilot launch", "Active"];
    const customer = state.customers.find((item) => item.id === target.dataset.nextStage);
    if (!customer) return;
    const index = stages.indexOf(customer.stage);
    customer.stage = stages[Math.min(index + 1, stages.length - 1)];
    if (customer.stage === "Active") customer.status = "Active";
    saveAdmin();
    renderAll();
    showToast(`${customer.company} moved to ${customer.stage}.`);
  }

  if (target.dataset.email) {
    const customer = state.customers.find((item) => item.id === target.dataset.email);
    if (customer) {
      window.location.href = `mailto:${customer.email}?subject=TerrainDesk onboarding update&body=Hey, quick update on your TerrainDesk workspace...`;
    }
  }
});

renderAll();
