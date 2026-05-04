const params = new URLSearchParams(window.location.search);
const quoteId = params.get("quote");
const statusEl = document.querySelector("#portal-status");
let portalState;

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

async function loadPortal() {
  if (!quoteId) throw new Error("Missing portal access link.");
  const response = await fetch(`/api/public-portal?quote=${encodeURIComponent(quoteId)}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load portal.");
  portalState = result;
  renderPortal();
}

function renderPortal() {
  document.querySelector("#portal-company").textContent = portalState.company.name || "Client portal";
  document.querySelector("#portal-title").textContent = `Welcome, ${portalState.lead.name || "there"}`;
  document.querySelector("#portal-copy").textContent = "Review your quotes, upcoming work and invoice status in one place.";
  document.querySelector("#portal-quotes").innerHTML = portalState.quotes.map((quote) => `
    <div class="portal-row">
      <strong>${escapeHtml(quote.service)}</strong>
      <span>${money(quote.amount)} - ${escapeHtml(quote.status)}</span>
      <a href="quote.html?quote=${encodeURIComponent(quote.id)}">Review quote</a>
    </div>
  `).join("") || `<p>No quotes yet.</p>`;
  document.querySelector("#portal-jobs").innerHTML = portalState.jobs.map((job) => `
    <div class="portal-row">
      <strong>${escapeHtml(job.service)}</strong>
      <span>${escapeHtml(job.day || "TBC")} - ${escapeHtml(job.status || "Scheduled")}</span>
      <small>${escapeHtml(job.crew || "Crew to be assigned")}</small>
    </div>
  `).join("") || `<p>No appointments yet.</p>`;
  document.querySelector("#portal-invoices").innerHTML = portalState.invoices.map((invoice) => `
    <div class="portal-row">
      <strong>${money(invoice.amount)}</strong>
      <span>Due ${escapeHtml(invoice.due || "soon")} - ${escapeHtml(invoice.status)}</span>
    </div>
  `).join("") || `<p>No invoices yet.</p>`;
}

async function portalAction(payload) {
  statusEl.textContent = "Sending...";
  const response = await fetch("/api/public-portal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteId, ...payload })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  statusEl.textContent = "Sent. The office has been notified.";
  return result;
}

document.querySelector("#portal-work-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await portalAction({ action: "requestWork", ...Object.fromEntries(new FormData(event.currentTarget)) });
    event.currentTarget.reset();
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

document.querySelector("#portal-message-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await portalAction({ action: "message", ...Object.fromEntries(new FormData(event.currentTarget)) });
    event.currentTarget.reset();
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

loadPortal().catch((error) => {
  document.querySelector("#portal-title").textContent = "Portal unavailable";
  document.querySelector("#portal-copy").textContent = error.message;
});
